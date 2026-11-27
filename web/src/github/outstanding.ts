import { copilotVerdict, latestCopilotReview } from "../logic/copilot.ts";
import { createLimiter } from "../logic/limiter.ts";
import { emptyOutstandingWork, type OutstandingWork, tallyThreads } from "../logic/unresolved.ts";
import { type GitHubClient, type GraphqlResult, graphql } from "./client.ts";
import { outstandingWorkFragment, reviewThreadsPageQuery } from "./documents.ts";
import type {
    OutstandingWorkFragment as OutstandingWorkData,
    ReviewThreadsPageQuery,
    ReviewThreadsPageQueryVariables,
} from "./gql/graphql.ts";
import { type PrRef, splitRepo } from "./repos.ts";

const BATCH_SIZE = 10;
const THREAD_PAGE_CAP = 5;
const CONCURRENCY = 3;

export interface OutstandingOptions {
    /** Counts the viewer's own threads and the replies in them, and reads the viewer's reviews. */
    login?: string | null;
    /** Called with the number of PRs read so far. */
    onProgress?: (done: number) => void;
}

/**
 * A query reading `OutstandingWork` for several PRs at once, one alias and three variables per PR,
 * plus `$viewer` and `$withViewer` for the viewer's own reviews.
 */
export function batchQuery(count: number): string {
    const variables: string[] = ["$viewer: String", "$withViewer: Boolean!"];
    const aliases: string[] = [];
    for (let n = 0; n < count; n++) {
        variables.push(`$owner${n}: String!, $name${n}: String!, $number${n}: Int!`);
        aliases.push(
            `pr${n}: repository(owner: $owner${n}, name: $name${n}) { pullRequest(number: $number${n}) { ...OutstandingWork } }`,
        );
    }
    return `query OutstandingWorkBatch(${variables.join(", ")}) {\n${aliases.join("\n")}\n}\n${outstandingWorkFragment}`;
}

type BatchData = Record<string, { pullRequest: OutstandingWorkData | null } | null>;

/**
 * What each PR still owes: unresolved review threads, Copilot's latest verdict and merge-queue
 * membership, none of which REST exposes. PRs are read ten to a query; more than a page of threads
 * on one PR is rare, so those are paged on their own, up to 500 threads. A PR missing from the
 * result (a repository the token cannot see) is missing from the map.
 */
export async function fetchOutstandingWork(
    client: GitHubClient,
    prs: readonly PrRef[],
    { login, onProgress }: OutstandingOptions = {},
): Promise<Map<string, OutstandingWork>> {
    const work = new Map<string, OutstandingWork>();
    const limit = createLimiter(CONCURRENCY);
    const entry = (key: string) => {
        let found = work.get(key);
        if (!found) {
            found = emptyOutstandingWork();
            work.set(key, found);
        }
        return found;
    };

    const batches: PrRef[][] = [];
    for (let i = 0; i < prs.length; i += BATCH_SIZE) batches.push(prs.slice(i, i + BATCH_SIZE));

    let done = 0;
    await Promise.all(
        batches.map(async (batch) => {
            const variables: Record<string, string | number | boolean | null> = {
                viewer: login ?? null,
                withViewer: !!login,
            };
            batch.forEach((pr, n) => {
                const { owner, repo } = splitRepo(pr.repoFullName);
                variables[`owner${n}`] = owner;
                variables[`name${n}`] = repo;
                variables[`number${n}`] = pr.number;
            });
            const result = await limit(() =>
                graphql<BatchData, typeof variables>(client, batchQuery(batch.length), variables),
            );
            if (result.errors.length) console.warn("Partial GraphQL errors reading review state:", result.errors);

            const overflowed: { pr: PrRef; cursor: string }[] = [];
            batch.forEach((pr, n) => {
                const pullRequest = result.data[`pr${n}`]?.pullRequest;
                if (!pullRequest) return;
                const key = `${pr.repoFullName}#${pr.number}`;
                const found = entry(key);
                tallyThreads(found, pullRequest.reviewThreads.nodes ?? [], login);
                const { hasNextPage, endCursor } = pullRequest.reviewThreads.pageInfo;
                if (hasNextPage && endCursor) overflowed.push({ pr, cursor: endCursor });
                found.copilot = copilotVerdict(latestCopilotReview(pullRequest.reviews?.nodes ?? []));
                found.mergeQueue = pullRequest.mergeQueueEntry ?? null;
                found.isDraft = pullRequest.isDraft;
                found.headSha = pullRequest.headRefOid;
                found.verdicts = (pullRequest.latestOpinionatedReviews?.nodes ?? []).flatMap((review) =>
                    review ? [{ state: review.state, user: review.author }] : [],
                );
                if (pullRequest.viewerReviews) {
                    found.viewerReviews = (pullRequest.viewerReviews.nodes ?? []).flatMap((review) =>
                        review
                            ? [
                                  {
                                      state: review.state,
                                      user: review.author,
                                      commit_id: review.commit?.oid ?? null,
                                      submitted_at: review.submittedAt ?? null,
                                  },
                              ]
                            : [],
                    );
                }
            });

            await Promise.all(
                overflowed.map(async ({ pr, cursor }) => {
                    const { owner, repo } = splitRepo(pr.repoFullName);
                    let after: string | null = cursor;
                    for (let page = 1; page < THREAD_PAGE_CAP && after; page++) {
                        const variables: ReviewThreadsPageQueryVariables = {
                            owner,
                            name: repo,
                            number: pr.number,
                            after,
                        };
                        const result: GraphqlResult<ReviewThreadsPageQuery> = await limit(() =>
                            graphql(client, reviewThreadsPageQuery, variables),
                        );
                        const threads = result.data.repository?.pullRequest?.reviewThreads;
                        if (!threads) break;
                        tallyThreads(entry(`${pr.repoFullName}#${pr.number}`), threads.nodes ?? [], login);
                        after = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
                    }
                }),
            );

            done += batch.length;
            onProgress?.(done);
        }),
    );

    return work;
}

import type { Endpoints } from "@octokit/types";
import { type FeatureKey, featureKey } from "../logic/feature.ts";
import type { ChangeFingerprint } from "../logic/fingerprint.ts";
import { createLimiter } from "../logic/limiter.ts";
import { RefreshProgress } from "../logic/progress.ts";
import { type MyReviewStanding, myReviewStanding, type ReviewDecision, reviewDecision } from "../logic/reviews.ts";
import { type AutoMerge, buildStackIndex, type StackNode } from "../logic/stacks.ts";
import { tabSearches } from "../logic/tabs.ts";
import { type MergeQueueEntry, type UnresolvedSummary, unresolvedSummary } from "../logic/unresolved.ts";
import { readChangeFingerprint } from "./changeCheck.ts";
import type { GitHubClient } from "./client.ts";
import { fetchOutstandingWork } from "./outstanding.ts";
import { type PrRef, repoOfSearchHit, splitRepo } from "./repos.ts";
import { fetchOpenPrByHead } from "./stack.ts";
import { type FindPrByHead, fetchStackParents } from "./stackParents.ts";

export type SearchHit = Endpoints["GET /search/issues"]["response"]["data"]["items"][number];

// Requests in flight at once, next to the GraphQL pools' 3 each: far under GitHub's secondary
// limit of 100 concurrent requests.
const PR_REQUEST_CONCURRENCY = 12;

interface ListedFields {
    repoFullName: string;
    isDraft: boolean;
}

/** One of the viewer's own open PRs. */
export type MyPr = SearchHit &
    ListedFields &
    UnresolvedSummary & {
        reviewState: ReviewDecision;
        autoMerge: AutoMerge | null;
        conflicting: boolean;
        requestedReviewers: string[];
        stackNode: StackNode | null;
        feature: FeatureKey | null;
        mergeQueue: MergeQueueEntry | null;
    };

/** A PR waiting for the viewer's review. */
export type WaitingPr = SearchHit &
    ListedFields &
    MyReviewStanding &
    UnresolvedSummary & {
        /** False when the viewer's threads could not be read. */
        threadsLoaded: boolean;
        myOpenThreads: number;
        myReplies: number;
    };

/** An open PR the viewer reviewed and is not asked to review again. */
export type ReviewedPr = SearchHit & ListedFields & MyReviewStanding;

export interface DashboardData {
    mine: MyPr[];
    waiting: WaitingPr[];
    reviewed: ReviewedPr[];
    /** Every open PR seen while building stacks, colleagues' included. */
    repoNodes: StackNode[];
    /** The change check read as the refresh started, when one was asked for. */
    fingerprint: string | null;
}

export interface LoadOptions {
    /** Gets the status line as each phase moves. */
    onProgress?: (message: string) => void;
    /** Reads a change-check baseline alongside the refresh. */
    fingerprint?: ChangeFingerprint;
}

export async function fetchViewerLogin(client: GitHubClient): Promise<string> {
    const { data } = await client.request("GET /user");
    return data.login;
}

/** Every open PR a search finds, newest update first (GitHub caps a search at 1,000 hits). */
export function searchPullRequests(
    client: GitHubClient,
    query: string,
    onPage?: (found: number) => void,
): Promise<SearchHit[]> {
    let found = 0;
    return client.paginate(
        "GET /search/issues",
        { q: query, per_page: 100, sort: "updated", order: "desc" },
        (response) => {
            found += response.data.length;
            onPage?.(found);
            return response.data;
        },
    );
}

const refOf = (hit: SearchHit): PrRef => ({ repoFullName: repoOfSearchHit(hit), number: hit.number });
const keyOf = (pr: PrRef) => `${pr.repoFullName}#${pr.number}`;

/**
 * Everything the three tabs show. The searches run first; then the REST calls (PR details, reviews,
 * the colleague PRs a stack sits on) and the GraphQL reads of unresolved threads run at once, each
 * through its own small pool. A PR whose details fail drops out of its stack; one whose threads
 * fail shows no unresolved count; a failed search fails the load.
 */
export async function loadDashboard(
    client: GitHubClient,
    login: string,
    { onProgress, fingerprint }: LoadOptions = {},
): Promise<DashboardData> {
    const report = onProgress ?? (() => {});
    const baseline = fingerprint
        ? readChangeFingerprint(client, login, fingerprint).catch((error: unknown) => {
              console.warn("Live change check failed:", error);
              return null;
          })
        : Promise.resolve(null);

    const searches = tabSearches(login);
    const searching = (found: number) => report(`Searching pull requests…${found ? ` ${found}` : ""}`);
    searching(0);
    const [mineHits, requestedHits, reviewedHits] = await Promise.all([
        searchPullRequests(client, searches.mine, searching),
        searchPullRequests(client, searches.requested, searching),
        searchPullRequests(client, searches.reviewed, searching),
    ]);
    const repoNames = [...new Set(mineHits.map(repoOfSearchHit))];

    const progress = new RefreshProgress(
        [
            ["repos", "repositories", repoNames.length],
            ["reviews", "reviews", mineHits.length],
            ["comments", "comments", mineHits.length],
        ],
        report,
    );

    // Unresolved counts need only repo and number, so they run alongside the repository scan.
    const outstandingPromise = fetchOutstandingWork(client, mineHits.map(refOf), {
        onProgress: (done) => progress.set("comments", done),
    }).catch((error: unknown) => {
        console.warn("Failed to read unresolved review state:", error);
        progress.set("comments", mineHits.length);
        return new Map();
    });
    const requestedWorkPromise = fetchOutstandingWork(client, requestedHits.map(refOf), { login }).catch(
        (error: unknown) => {
            console.warn("Failed to read review threads on requested PRs:", error);
            return null;
        },
    );

    const limit = createLimiter(PR_REQUEST_CONCURRENCY);
    const orNull = <T>(label: string, task: () => Promise<T>): Promise<T | null> =>
        limit(task).catch((error: unknown) => {
            console.warn(`Failed to fetch ${label}:`, error);
            return null;
        });
    const pullDetail = (pr: PrRef) =>
        orNull(`details for ${keyOf(pr)}`, async () => {
            const { owner, repo } = splitRepo(pr.repoFullName);
            return (
                await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
                    owner,
                    repo,
                    pull_number: pr.number,
                })
            ).data;
        });
    // Null when any page fails, so a partial history never yields a verdict.
    const allReviews = (pr: PrRef) =>
        orNull(`reviews for ${keyOf(pr)}`, () => {
            const { owner, repo } = splitRepo(pr.repoFullName);
            return client.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
                owner,
                repo,
                pull_number: pr.number,
                per_page: 100,
            });
        });
    const findByHead: FindPrByHead = (repoFullName, label) =>
        orNull(`the PR with head ${label} in ${repoFullName}`, () => fetchOpenPrByHead(client, repoFullName, label));

    const withMyReview = async (hit: SearchHit) => {
        const ref = refOf(hit);
        const [detail, reviews] = await Promise.all([pullDetail(ref), allReviews(ref)]);
        return {
            ...hit,
            repoFullName: ref.repoFullName,
            isDraft: detail ? !!detail.draft : !!hit.draft,
            ...myReviewStanding(reviews, login, detail?.head.sha ?? null),
        };
    };
    const reviewedPromise = Promise.all(reviewedHits.map(withMyReview));
    // A review request can outlive the viewer's review (re-requested, or kept by automation), so
    // the waiting list shows where that review stands too.
    const requestedPromise = Promise.all(requestedHits.map(withMyReview));

    // A search hit lacks branches, reviewers and auto-merge, so every PR of the viewer's needs its
    // own details call.
    const details = new Map(mineHits.map((hit) => [keyOf(refOf(hit)), pullDetail(refOf(hit))]));

    // Each repo's stacks are the viewer's PRs there plus the colleague PRs they sit on. A repo
    // resolves on its own, so its PRs move on without waiting for the slowest one.
    const stackIndexes = new Map(
        repoNames.map((repo) => [
            repo,
            (async () => {
                try {
                    const own = (
                        await Promise.all(
                            mineHits
                                .filter((hit) => repoOfSearchHit(hit) === repo)
                                .map((hit) => details.get(keyOf(refOf(hit)))),
                        )
                    ).filter((detail): detail is NonNullable<typeof detail> => !!detail);
                    const parents = await fetchStackParents(repo, own, findByHead);
                    return buildStackIndex([...own, ...parents], repo);
                } catch (error) {
                    console.warn(`Failed to build the stack index for ${repo}:`, error);
                    return new Map<number, StackNode>();
                } finally {
                    progress.advance("repos");
                }
            })(),
        ]),
    );

    const enriched = await Promise.all(
        mineHits.map(async (hit) => {
            const ref = refOf(hit);
            const reviewsPromise = allReviews(ref);
            const node = (await stackIndexes.get(ref.repoFullName))?.get(hit.number) ?? null;
            const reviewState = reviewDecision(await reviewsPromise);
            progress.advance("reviews");
            return {
                ...hit,
                repoFullName: ref.repoFullName,
                reviewState,
                isDraft: node ? node.draft : !!hit.draft,
                autoMerge: node?.autoMerge ?? null,
                conflicting: node?.conflicting ?? false,
                requestedReviewers: node?.requestedReviewers ?? [],
                stackNode: node,
                feature: node?.feature ?? featureKey(hit.title, node?.headRef ?? "", hit.body ?? ""),
            };
        }),
    );

    const indexes = await Promise.all(repoNames.map((repo) => stackIndexes.get(repo)));
    const repoNodes = indexes.flatMap((index) => (index ? [...index.values()] : []));

    const outstanding = await outstandingPromise;
    const mine: MyPr[] = enriched.map((pr) => {
        const work = outstanding.get(keyOf(pr));
        return { ...pr, ...unresolvedSummary(work), mergeQueue: work?.mergeQueue ?? null };
    });

    const requestedWork = await requestedWorkPromise;
    const waiting: WaitingPr[] = (await requestedPromise).map((pr) => {
        const work = requestedWork?.get(keyOf(pr));
        return {
            ...pr,
            threadsLoaded: !!requestedWork,
            myOpenThreads: work?.mine ?? 0,
            myReplies: work?.replies ?? 0,
            ...unresolvedSummary(work),
        };
    });

    return { mine, waiting, reviewed: await reviewedPromise, repoNodes, fingerprint: await baseline };
}

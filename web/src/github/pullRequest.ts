import type { PrRoute } from "../logic/prRoute.ts";
import { type GitHubClient, graphql } from "./client.ts";
import type {
    PullCommitFieldsFragment,
    PullRequestDetailQuery,
    ReviewThreadDetailPageFragment,
    TimelinePageFragment,
} from "./gql/graphql.ts";
import {
    pullRequestCommitsQuery,
    pullRequestDetailQuery,
    reviewThreadDetailPageQuery,
    timelinePageQuery,
} from "./pullRequestDocuments.ts";

// Ten pages of 100: past that a PR's history is better read on GitHub than held in a page.
const PAGE_CAP = 10;

type PullRequestData = NonNullable<NonNullable<PullRequestDetailQuery["repository"]>["pullRequest"]>;

export type PullRequestFields = Omit<PullRequestData, "timelineItems" | "reviewThreads">;
export type TimelineNode = NonNullable<NonNullable<TimelinePageFragment["nodes"]>[number]>;
export type ReviewThread = NonNullable<NonNullable<ReviewThreadDetailPageFragment["nodes"]>[number]>;
export type PullCommit = PullCommitFieldsFragment;

export interface PullRequestDetail {
    pr: PullRequestFields;
    timeline: TimelineNode[];
    threads: ReviewThread[];
    /** False when the timeline or the threads ran past what the page reads. */
    complete: boolean;
}

export interface PullRequestCommits {
    commits: PullCommit[];
    totalCount: number;
}

/** The repository or the PR does not exist, or the sign-in cannot see it. */
export class PullRequestNotFound extends Error {
    override name = "PullRequestNotFound";

    constructor(pr: PrRoute) {
        super(`${pr.owner}/${pr.repo}#${pr.number} was not found, or this sign-in cannot see it.`);
    }
}

interface Page<N> {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes?: readonly (N | null)[] | null;
}

const present = <N>(nodes: readonly (N | null)[] | null | undefined): N[] =>
    (nodes ?? []).filter((node): node is N => node !== null);

/** The nodes of `first` and of the pages after it, up to the cap; `complete` is false when it was hit. */
async function collectPages<N>(
    first: Page<N>,
    next: (after: string) => Promise<Page<N> | null | undefined>,
): Promise<{ nodes: N[]; complete: boolean }> {
    const nodes = present(first.nodes);
    let page: Page<N> = first;
    for (let read = 1; page.pageInfo.hasNextPage && page.pageInfo.endCursor; read++) {
        if (read === PAGE_CAP) return { nodes, complete: false };
        const fetched = await next(page.pageInfo.endCursor);
        if (!fetched) return { nodes, complete: false };
        nodes.push(...present(fetched.nodes));
        page = fetched;
    }
    return { nodes, complete: true };
}

const variablesOf = (pr: PrRoute) => ({ owner: pr.owner, name: pr.repo, number: pr.number });

/** The PR with its whole conversation: the timeline and every review thread. */
export async function loadPullRequest(client: GitHubClient, route: PrRoute): Promise<PullRequestDetail> {
    const variables = variablesOf(route);
    const { data } = await graphql(client, pullRequestDetailQuery, variables);
    const found = data.repository?.pullRequest;
    if (!found) throw new PullRequestNotFound(route);
    const { timelineItems, reviewThreads, ...pr } = found;
    const [timeline, threads] = await Promise.all([
        collectPages(timelineItems, async (after) => {
            const page = await graphql(client, timelinePageQuery, { ...variables, after });
            return page.data.repository?.pullRequest?.timelineItems;
        }),
        collectPages(reviewThreads, async (after) => {
            const page = await graphql(client, reviewThreadDetailPageQuery, { ...variables, after });
            return page.data.repository?.pullRequest?.reviewThreads;
        }),
    ]);
    return {
        pr,
        timeline: timeline.nodes,
        threads: threads.nodes,
        complete: timeline.complete && threads.complete,
    };
}

export async function loadPullRequestCommits(client: GitHubClient, route: PrRoute): Promise<PullRequestCommits> {
    const variables = variablesOf(route);
    const read = async (after: string | null) => {
        const { data } = await graphql(client, pullRequestCommitsQuery, { ...variables, after });
        return data.repository?.pullRequest?.commits;
    };
    const first = await read(null);
    if (!first) throw new PullRequestNotFound(route);
    const { nodes } = await collectPages(first, read);
    return { commits: nodes.map((node) => node.commit), totalCount: first.totalCount };
}

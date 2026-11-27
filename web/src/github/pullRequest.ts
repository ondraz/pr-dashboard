import type { Endpoints } from "@octokit/types";
import { prFingerprint } from "../logic/fingerprint.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { type GitHubClient, graphql } from "./client.ts";
import type {
    FileViewedState,
    PullCommitFieldsFragment,
    PullRequestDetailQuery,
    ReviewThreadDetailPageFragment,
    TimelinePageFragment,
} from "./gql/graphql.ts";
import {
    pullRequestCommitsQuery,
    pullRequestDetailQuery,
    pullRequestProbeQuery,
    pullRequestViewedFilesQuery,
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
    /**
     * Timeline entries GitHub left out with an error. A token without Contents read access gets the
     * PR's commits that way, so the Conversation tab reads them over REST instead.
     */
    withheld: number;
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

/**
 * The nodes of `first` and of the pages after it, up to the cap; `complete` is false when it was hit.
 * `dropped` counts the nodes GitHub answered with null, which it does for what the sign-in may not read.
 */
async function collectPages<N>(
    first: Page<N>,
    next: (after: string) => Promise<Page<N> | null | undefined>,
): Promise<{ nodes: N[]; complete: boolean; dropped: number }> {
    const nodes: N[] = [];
    let dropped = 0;
    const take = (page: Page<N>) => {
        for (const node of page.nodes ?? []) {
            if (node === null) dropped++;
            else nodes.push(node);
        }
    };
    take(first);
    let page: Page<N> = first;
    for (let read = 1; page.pageInfo.hasNextPage && page.pageInfo.endCursor; read++) {
        if (read === PAGE_CAP) return { nodes, complete: false, dropped };
        const fetched = await next(page.pageInfo.endCursor);
        if (!fetched) return { nodes, complete: false, dropped };
        take(fetched);
        page = fetched;
    }
    return { nodes, complete: true, dropped };
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
        withheld: timeline.dropped,
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
    const { nodes, dropped } = await collectPages(first, read);
    // GraphQL hides commits from a token without Contents read access; REST needs only Pull requests read.
    if (dropped) return loadPullRequestCommitsByRest(client, route, first.totalCount);
    return { commits: nodes.map((node) => node.commit), totalCount: first.totalCount };
}

type RestPullCommit = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"]["response"]["data"][number];

/** A commit from REST in the shape GraphQL gives it. */
export function restPullCommit(commit: RestPullCommit): PullCommit {
    return {
        oid: commit.sha,
        abbreviatedOid: commit.sha.slice(0, 7),
        messageHeadline: commit.commit.message.split("\n", 1)[0] ?? "",
        committedDate: commit.commit.committer?.date ?? commit.commit.author?.date ?? "",
        url: commit.html_url,
        author: {
            name: commit.commit.author?.name ?? null,
            avatarUrl: commit.author?.avatar_url ?? "",
            user: commit.author ? { login: commit.author.login } : null,
        },
    };
}

/** The PR's commits over REST, which GitHub stops at 250. */
async function loadPullRequestCommitsByRest(
    client: GitHubClient,
    route: PrRoute,
    totalCount: number,
): Promise<PullRequestCommits> {
    const commits = await client.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/commits", {
        owner: route.owner,
        repo: route.repo,
        pull_number: route.number,
        per_page: 100,
    });
    return { commits: commits.map(restPullCommit), totalCount };
}

/** The open PR's live check: one point of the GraphQL budget per read. */
export async function readPullRequestFingerprint(client: GitHubClient, route: PrRoute): Promise<string> {
    const { data } = await graphql(client, pullRequestProbeQuery, variablesOf(route));
    const pr = data.repository?.pullRequest;
    if (!pr) throw new PullRequestNotFound(route);
    return prFingerprint(pr);
}

/** The viewer's viewed state of each changed file; past the pages read, a file counts as not viewed. */
export async function loadViewedFiles(client: GitHubClient, route: PrRoute): Promise<Map<string, FileViewedState>> {
    const variables = variablesOf(route);
    const read = async (after: string | null) => {
        const { data } = await graphql(client, pullRequestViewedFilesQuery, { ...variables, after });
        return data.repository?.pullRequest?.files;
    };
    const first = await read(null);
    if (!first) throw new PullRequestNotFound(route);
    const { nodes } = await collectPages(first, read);
    return new Map(nodes.map((file) => [file.path, file.viewerViewedState]));
}

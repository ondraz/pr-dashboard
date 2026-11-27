import { type CheckEntry, normalizeCheck } from "../logic/checks.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { type GitHubClient, GraphqlError, graphql } from "./client.ts";
import { graphql as gql } from "./gql/index.ts";

/**
 * The check runs and commit statuses on one commit, as the PR's checks rollup counts them. The commit
 * is named by its id, so every page reads the same commit even when the branch moves meanwhile.
 */
export const commitChecksQuery = gql(`
    query CommitChecks($owner: String!, $name: String!, $oid: GitObjectID!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
            object(oid: $oid) {
                ... on Commit {
                    statusCheckRollup {
                        state
                        contexts(first: 50, after: $after) {
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                            nodes {
                                __typename
                                ... on CheckRun {
                                    id
                                    databaseId
                                    name
                                    status
                                    conclusion
                                    detailsUrl
                                    url
                                    startedAt
                                    completedAt
                                    title
                                    summary
                                    isRequired(pullRequestNumber: $number)
                                    checkSuite {
                                        app {
                                            name
                                        }
                                        workflowRun {
                                            workflow {
                                                name
                                            }
                                        }
                                    }
                                    annotations(first: 50) {
                                        totalCount
                                        nodes {
                                            annotationLevel
                                            path
                                            location {
                                                start {
                                                    line
                                                }
                                                end {
                                                    line
                                                }
                                            }
                                            title
                                            message
                                            rawDetails
                                            blobUrl
                                        }
                                    }
                                }
                                ... on StatusContext {
                                    id
                                    context
                                    state
                                    description
                                    targetUrl
                                    createdAt
                                    isRequired(pullRequestNumber: $number)
                                    creator {
                                        login
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`);

// Ten pages of 50: a commit with more checks than that is better read on GitHub.
const PAGE_CAP = 10;

export interface CommitChecks {
    oid: string;
    /** The rollup's state, or null when the commit has no checks at all. */
    state: string | null;
    checks: CheckEntry[];
    /** False when the commit has more checks than the pages read, or some of them could not be read. */
    complete: boolean;
}

/**
 * Every check run and status on `oid`, the commit at the head of the PR `route`. A sign-in that may not
 * read checks gets errors and no rollup, which is not the same as a commit without checks.
 */
export async function loadCommitChecks(client: GitHubClient, route: PrRoute, oid: string): Promise<CommitChecks> {
    const variables = { owner: route.owner, name: route.repo, oid, number: route.number };
    let partial = false;
    const read = async (after: string | null) => {
        const { data, errors } = await graphql(client, commitChecksQuery, { ...variables, after });
        const commit = data.repository?.object;
        const rollup = commit && "statusCheckRollup" in commit ? commit.statusCheckRollup : null;
        if (errors.length && !rollup) throw new GraphqlError(errors);
        if (errors.length) partial = true;
        return rollup;
    };
    const checks: CheckEntry[] = [];
    let rollup = await read(null);
    const state = rollup?.state ?? null;
    for (let page = 1; rollup; page++) {
        for (const node of rollup.contexts.nodes ?? []) {
            const entry = node ? normalizeCheck(node) : null;
            if (entry) checks.push(entry);
        }
        const { hasNextPage, endCursor } = rollup.contexts.pageInfo;
        if (!hasNextPage || !endCursor) break;
        if (page === PAGE_CAP) return { oid, state, checks, complete: false };
        rollup = await read(endCursor);
    }
    return { oid, state, checks, complete: !partial };
}

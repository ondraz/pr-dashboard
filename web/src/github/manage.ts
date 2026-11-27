import type { PrRoute } from "../logic/prRoute.ts";
import { type GitHubClient, mutate, graphql as runGraphql, writeError } from "./client.ts";
import type { PullRequestBranchUpdateMethod, PullRequestMergeMethod } from "./gql/graphql.ts";
import { graphql } from "./gql/index.ts";

export const mergeTextQuery = graphql(`
    query PullRequestMergeText($owner: String!, $name: String!, $number: Int!, $method: PullRequestMergeMethod!) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                viewerMergeHeadlineText(mergeType: $method)
                viewerMergeBodyText(mergeType: $method)
            }
        }
    }
`);

export const mergeMutation = graphql(`
    mutation MergePullRequest(
        $pullRequestId: ID!
        $mergeMethod: PullRequestMergeMethod!
        $commitHeadline: String
        $commitBody: String
        $expectedHeadOid: GitObjectID!
    ) {
        mergePullRequest(
            input: {
                pullRequestId: $pullRequestId
                mergeMethod: $mergeMethod
                commitHeadline: $commitHeadline
                commitBody: $commitBody
                expectedHeadOid: $expectedHeadOid
            }
        ) {
            pullRequest {
                id
            }
        }
    }
`);

export const enableAutoMergeMutation = graphql(`
    mutation EnableAutoMerge(
        $pullRequestId: ID!
        $mergeMethod: PullRequestMergeMethod
        $commitHeadline: String
        $commitBody: String
        $expectedHeadOid: GitObjectID!
    ) {
        enablePullRequestAutoMerge(
            input: {
                pullRequestId: $pullRequestId
                mergeMethod: $mergeMethod
                commitHeadline: $commitHeadline
                commitBody: $commitBody
                expectedHeadOid: $expectedHeadOid
            }
        ) {
            pullRequest {
                id
            }
        }
    }
`);

export const disableAutoMergeMutation = graphql(`
    mutation DisableAutoMerge($pullRequestId: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
                id
            }
        }
    }
`);

export const enqueueMutation = graphql(`
    mutation EnqueuePullRequest($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) {
        enqueuePullRequest(input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid }) {
            mergeQueueEntry {
                position
            }
        }
    }
`);

export const dequeueMutation = graphql(`
    mutation DequeuePullRequest($pullRequestId: ID!) {
        dequeuePullRequest(input: { id: $pullRequestId }) {
            mergeQueueEntry {
                id
            }
        }
    }
`);

export const updateBranchMutation = graphql(`
    mutation UpdatePullRequestBranch(
        $pullRequestId: ID!
        $expectedHeadOid: GitObjectID!
        $updateMethod: PullRequestBranchUpdateMethod!
    ) {
        updatePullRequestBranch(
            input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid, updateMethod: $updateMethod }
        ) {
            pullRequest {
                id
            }
        }
    }
`);

export const markReadyMutation = graphql(`
    mutation MarkReadyForReview($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
                id
            }
        }
    }
`);

export const convertToDraftMutation = graphql(`
    mutation ConvertToDraft($pullRequestId: ID!) {
        convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
                id
            }
        }
    }
`);

export const closeMutation = graphql(`
    mutation ClosePullRequest($pullRequestId: ID!) {
        closePullRequest(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
                id
            }
        }
    }
`);

export const updatePullRequestMutation = graphql(`
    mutation UpdatePullRequest($pullRequestId: ID!, $title: String, $body: String) {
        updatePullRequest(input: { pullRequestId: $pullRequestId, title: $title, body: $body }) {
            pullRequest {
                id
            }
        }
    }
`);

export const reopenMutation = graphql(`
    mutation ReopenPullRequest($pullRequestId: ID!) {
        reopenPullRequest(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
                id
            }
        }
    }
`);

export const assignableUsersQuery = graphql(`
    query AssignableUsers($owner: String!, $name: String!, $query: String) {
        repository(owner: $owner, name: $name) {
            assignableUsers(first: 30, query: $query) {
                nodes {
                    id
                    login
                    avatarUrl(size: 40)
                }
            }
        }
    }
`);

export const repositoryLabelsQuery = graphql(`
    query RepositoryLabels($owner: String!, $name: String!, $query: String) {
        repository(owner: $owner, name: $name) {
            labels(first: 50, query: $query, orderBy: { field: NAME, direction: ASC }) {
                nodes {
                    id
                    name
                }
            }
        }
    }
`);

export const addLabelsMutation = graphql(`
    mutation AddLabels($labelableId: ID!, $labelIds: [ID!]!) {
        addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
            clientMutationId
        }
    }
`);

export const removeLabelsMutation = graphql(`
    mutation RemoveLabels($labelableId: ID!, $labelIds: [ID!]!) {
        removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
            clientMutationId
        }
    }
`);

export const addAssigneesMutation = graphql(`
    mutation AddAssignees($assignableId: ID!, $assigneeIds: [ID!]!) {
        addAssigneesToAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
            clientMutationId
        }
    }
`);

export const removeAssigneesMutation = graphql(`
    mutation RemoveAssignees($assignableId: ID!, $assigneeIds: [ID!]!) {
        removeAssigneesFromAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
            clientMutationId
        }
    }
`);

/** The PR a change that lands commits is about, with the head the page shows, so GitHub turns it away if the branch moved since. */
export interface ManagedPr {
    pullRequestId: string;
    headOid: string;
}

/** The commit message the merge commit or squashed commit gets; a rebase takes none. */
export interface MergeMessage {
    headline: string;
    body: string;
}

/** GitHub's own default message for merging the PR by `method`, as its merge box fills it in. */
export async function loadMergeText(
    client: GitHubClient,
    route: PrRoute,
    method: PullRequestMergeMethod,
): Promise<MergeMessage> {
    const { data } = await runGraphql(client, mergeTextQuery, {
        owner: route.owner,
        name: route.repo,
        number: route.number,
        method,
    });
    const pr = data.repository?.pullRequest;
    return { headline: pr?.viewerMergeHeadlineText ?? "", body: pr?.viewerMergeBodyText ?? "" };
}

const messageVariables = (method: PullRequestMergeMethod, message: MergeMessage | null) =>
    method === "REBASE" || !message
        ? { commitHeadline: null, commitBody: null }
        : { commitHeadline: message.headline.trim() || null, commitBody: message.body };

export async function mergePullRequest(
    client: GitHubClient,
    pr: ManagedPr,
    method: PullRequestMergeMethod,
    message: MergeMessage | null,
): Promise<void> {
    await mutate(client, mergeMutation, {
        pullRequestId: pr.pullRequestId,
        mergeMethod: method,
        expectedHeadOid: pr.headOid,
        ...messageVariables(method, message),
    });
}

/**
 * Merges by `method` once checks and reviews pass. With a merge queue on the base branch there is no method: the
 * queue decides how it merges, and the PR joins the queue instead.
 */
export async function enableAutoMerge(
    client: GitHubClient,
    pr: ManagedPr,
    method: PullRequestMergeMethod | null,
    message: MergeMessage | null,
): Promise<void> {
    await mutate(client, enableAutoMergeMutation, {
        pullRequestId: pr.pullRequestId,
        expectedHeadOid: pr.headOid,
        ...(method ? { mergeMethod: method, ...messageVariables(method, message) } : {}),
    });
}

export async function disableAutoMerge(client: GitHubClient, pullRequestId: string): Promise<void> {
    await mutate(client, disableAutoMergeMutation, { pullRequestId });
}

export async function addToMergeQueue(client: GitHubClient, pr: ManagedPr): Promise<void> {
    await mutate(client, enqueueMutation, { pullRequestId: pr.pullRequestId, expectedHeadOid: pr.headOid });
}

export async function removeFromMergeQueue(client: GitHubClient, pullRequestId: string): Promise<void> {
    await mutate(client, dequeueMutation, { pullRequestId });
}

/** Brings the base branch's new commits into the PR's branch, by a merge commit or by rebasing onto them. */
export async function updateBranch(
    client: GitHubClient,
    pr: ManagedPr,
    updateMethod: PullRequestBranchUpdateMethod,
): Promise<void> {
    await mutate(client, updateBranchMutation, {
        pullRequestId: pr.pullRequestId,
        expectedHeadOid: pr.headOid,
        updateMethod,
    });
}

export async function setDraft(client: GitHubClient, pullRequestId: string, draft: boolean): Promise<void> {
    if (draft) await mutate(client, convertToDraftMutation, { pullRequestId });
    else await mutate(client, markReadyMutation, { pullRequestId });
}

export async function setClosed(client: GitHubClient, pullRequestId: string, closed: boolean): Promise<void> {
    if (closed) await mutate(client, closeMutation, { pullRequestId });
    else await mutate(client, reopenMutation, { pullRequestId });
}

/** Changes the PR's title or description; a field left out stays as it is. */
export async function editPullRequest(
    client: GitHubClient,
    pullRequestId: string,
    change: { title?: string; body?: string },
): Promise<void> {
    await mutate(client, updatePullRequestMutation, { pullRequestId, ...change });
}

/** Someone or something the sidebar's pickers offer: a user to assign or ask for a review, or a label. */
export interface PickOption {
    id: string;
    name: string;
    avatarUrl: string | null;
}

/** The repository's users who can be assigned, which are also who can review, matching `query`. */
export async function loadAssignableUsers(client: GitHubClient, route: PrRoute, query: string): Promise<PickOption[]> {
    const { data } = await runGraphql(client, assignableUsersQuery, {
        owner: route.owner,
        name: route.repo,
        query: query.trim() || null,
    });
    return (data.repository?.assignableUsers.nodes ?? [])
        .filter((user) => !!user)
        .map((user) => ({ id: user.id, name: user.login, avatarUrl: user.avatarUrl }));
}

export async function loadLabels(client: GitHubClient, route: PrRoute, query: string): Promise<PickOption[]> {
    const { data } = await runGraphql(client, repositoryLabelsQuery, {
        owner: route.owner,
        name: route.repo,
        query: query.trim() || null,
    });
    return (data.repository?.labels?.nodes ?? [])
        .filter((label) => !!label)
        .map((label) => ({ id: label.id, name: label.name, avatarUrl: null }));
}

export async function setLabel(client: GitHubClient, pullRequestId: string, labelId: string, on: boolean) {
    const variables = { labelableId: pullRequestId, labelIds: [labelId] };
    if (on) await mutate(client, addLabelsMutation, variables);
    else await mutate(client, removeLabelsMutation, variables);
}

export async function setAssignee(client: GitHubClient, pullRequestId: string, userId: string, on: boolean) {
    const variables = { assignableId: pullRequestId, assigneeIds: [userId] };
    if (on) await mutate(client, addAssigneesMutation, variables);
    else await mutate(client, removeAssigneesMutation, variables);
}

/** Withdraws a request for a user's review, or a team's by its slug within the organization. */
export async function removeReviewRequest(
    client: GitHubClient,
    route: PrRoute,
    reviewer: { login: string } | { teamSlug: string },
): Promise<void> {
    try {
        await client.request("DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
            owner: route.owner,
            repo: route.repo,
            pull_number: route.number,
            reviewers: "login" in reviewer ? [reviewer.login] : [],
            ...("teamSlug" in reviewer ? { team_reviewers: [reviewer.teamSlug] } : {}),
        });
    } catch (error) {
        throw writeError(error);
    }
}

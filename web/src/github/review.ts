import type { PrRoute } from "../logic/prRoute.ts";
import type { CommentTarget, ReviewEvent } from "../logic/review.ts";
import { type GitHubClient, mutate, writeError } from "./client.ts";
import type { ReactionContent } from "./gql/graphql.ts";
import { graphql } from "./gql/index.ts";
import { editPullRequest } from "./manage.ts";

export const addPendingReviewMutation = graphql(`
    mutation AddPendingReview($pullRequestId: ID!, $commitOID: GitObjectID) {
        addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID }) {
            pullRequestReview {
                id
            }
        }
    }
`);

export const addReviewThreadMutation = graphql(`
    mutation AddReviewThread(
        $pullRequestReviewId: ID!
        $path: String!
        $body: String!
        $subjectType: PullRequestReviewThreadSubjectType!
        $line: Int
        $side: DiffSide
        $startLine: Int
        $startSide: DiffSide
    ) {
        addPullRequestReviewThread(
            input: {
                pullRequestReviewId: $pullRequestReviewId
                path: $path
                body: $body
                subjectType: $subjectType
                line: $line
                side: $side
                startLine: $startLine
                startSide: $startSide
            }
        ) {
            thread {
                id
            }
        }
    }
`);

export const submitReviewMutation = graphql(`
    mutation SubmitReview($pullRequestReviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
        submitPullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId, event: $event, body: $body }) {
            pullRequestReview {
                id
            }
        }
    }
`);

export const addReviewMutation = graphql(`
    mutation AddReview($pullRequestId: ID!, $commitOID: GitObjectID, $event: PullRequestReviewEvent!, $body: String) {
        addPullRequestReview(
            input: { pullRequestId: $pullRequestId, commitOID: $commitOID, event: $event, body: $body }
        ) {
            pullRequestReview {
                id
            }
        }
    }
`);

export const deleteReviewMutation = graphql(`
    mutation DeleteReview($pullRequestReviewId: ID!) {
        deletePullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId }) {
            pullRequestReview {
                id
            }
        }
    }
`);

export const addCommentMutation = graphql(`
    mutation AddComment($subjectId: ID!, $body: String!) {
        addComment(input: { subjectId: $subjectId, body: $body }) {
            commentEdge {
                node {
                    id
                }
            }
        }
    }
`);

/** The PR a review action is about: its node id and the head commit the page shows. */
export interface ReviewSubject {
    route: PrRoute;
    pullRequestId: string;
    headOid: string;
    /** The viewer's pending review, if one is open. */
    pendingReviewId: string | null;
}

function threadVariables(target: CommentTarget) {
    if (target.subject === "file") return { path: target.path, subjectType: "FILE" as const };
    const ranged = target.startLine !== null && target.startLine !== target.line;
    return {
        path: target.path,
        subjectType: "LINE" as const,
        line: target.line,
        side: target.side,
        startLine: ranged ? target.startLine : null,
        startSide: ranged ? target.side : null,
    };
}

/** The viewer's pending review, opened at the head commit the page shows when there is none yet. */
async function pendingReview(client: GitHubClient, subject: ReviewSubject): Promise<string> {
    if (subject.pendingReviewId) return subject.pendingReviewId;
    const data = await mutate(client, addPendingReviewMutation, {
        pullRequestId: subject.pullRequestId,
        commitOID: subject.headOid,
    });
    const id = data.addPullRequestReview?.pullRequestReview?.id;
    if (!id) throw new Error("GitHub did not open a review");
    return id;
}

/** Adds a comment to the viewer's pending review, which nobody else sees until it is submitted. */
export async function addReviewComment(
    client: GitHubClient,
    subject: ReviewSubject,
    target: CommentTarget,
    body: string,
): Promise<void> {
    const pullRequestReviewId = await pendingReview(client, subject);
    await mutate(client, addReviewThreadMutation, { pullRequestReviewId, body, ...threadVariables(target) });
}

/** Posts one comment on the diff at once, outside any review, as GitHub's "Add single comment" does. */
export async function addSingleComment(
    client: GitHubClient,
    subject: ReviewSubject,
    target: CommentTarget,
    body: string,
): Promise<void> {
    const { route } = subject;
    const where =
        target.subject === "file"
            ? { subject_type: "file" as const }
            : {
                  subject_type: "line" as const,
                  line: target.line,
                  side: target.side,
                  ...(target.startLine !== null && target.startLine !== target.line
                      ? { start_line: target.startLine, start_side: target.side }
                      : {}),
              };
    try {
        await client.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
            owner: route.owner,
            repo: route.repo,
            pull_number: route.number,
            commit_id: subject.headOid,
            path: target.path,
            body,
            ...where,
        });
    } catch (error) {
        throw writeError(error);
    }
}

/** Submits the pending review with its summary, or sends a review of only a summary when none is pending. */
export async function submitReview(
    client: GitHubClient,
    subject: ReviewSubject,
    event: ReviewEvent,
    body: string,
): Promise<void> {
    const text = body.trim() ? body : null;
    if (subject.pendingReviewId) {
        await mutate(client, submitReviewMutation, { pullRequestReviewId: subject.pendingReviewId, event, body: text });
    } else {
        await mutate(client, addReviewMutation, {
            pullRequestId: subject.pullRequestId,
            commitOID: subject.headOid,
            event,
            body: text,
        });
    }
}

/** Throws the pending review away, with every comment in it. */
export async function discardReview(client: GitHubClient, pullRequestReviewId: string): Promise<void> {
    await mutate(client, deleteReviewMutation, { pullRequestReviewId });
}

/** Comments on the PR itself, below its conversation. */
export async function addPrComment(client: GitHubClient, pullRequestId: string, body: string): Promise<void> {
    await mutate(client, addCommentMutation, { subjectId: pullRequestId, body });
}

/** GitHub's own rendering of `text`, with references resolved in the PR's repository. */
export async function renderMarkdown(client: GitHubClient, route: PrRoute, text: string): Promise<string> {
    const { data } = await client.request("POST /markdown", {
        text,
        mode: "gfm",
        context: `${route.owner}/${route.repo}`,
    });
    return typeof data === "string" ? data : String(data);
}

export const addThreadReplyMutation = graphql(`
    mutation AddThreadReply($threadId: ID!, $body: String!, $pullRequestReviewId: ID) {
        addPullRequestReviewThreadReply(
            input: { pullRequestReviewThreadId: $threadId, body: $body, pullRequestReviewId: $pullRequestReviewId }
        ) {
            comment {
                id
            }
        }
    }
`);

export const resolveThreadMutation = graphql(`
    mutation ResolveThread($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
            thread {
                id
            }
        }
    }
`);

export const unresolveThreadMutation = graphql(`
    mutation UnresolveThread($threadId: ID!) {
        unresolveReviewThread(input: { threadId: $threadId }) {
            thread {
                id
            }
        }
    }
`);

export const updateReviewCommentMutation = graphql(`
    mutation UpdateReviewComment($id: ID!, $body: String!) {
        updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
            pullRequestReviewComment {
                id
            }
        }
    }
`);

export const deleteReviewCommentMutation = graphql(`
    mutation DeleteReviewComment($id: ID!) {
        deletePullRequestReviewComment(input: { id: $id }) {
            pullRequestReview {
                id
            }
        }
    }
`);

export const updateIssueCommentMutation = graphql(`
    mutation UpdateIssueComment($id: ID!, $body: String!) {
        updateIssueComment(input: { id: $id, body: $body }) {
            issueComment {
                id
            }
        }
    }
`);

export const deleteIssueCommentMutation = graphql(`
    mutation DeleteIssueComment($id: ID!) {
        deleteIssueComment(input: { id: $id }) {
            clientMutationId
        }
    }
`);

export const updateReviewMutation = graphql(`
    mutation UpdateReview($id: ID!, $body: String!) {
        updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body }) {
            pullRequestReview {
                id
            }
        }
    }
`);

export const addReactionMutation = graphql(`
    mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
        addReaction(input: { subjectId: $subjectId, content: $content }) {
            reaction {
                content
            }
        }
    }
`);

export const removeReactionMutation = graphql(`
    mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
        removeReaction(input: { subjectId: $subjectId, content: $content }) {
            reaction {
                content
            }
        }
    }
`);

export const markFileViewedMutation = graphql(`
    mutation MarkFileViewed($pullRequestId: ID!, $path: String!) {
        markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
            clientMutationId
        }
    }
`);

export const unmarkFileViewedMutation = graphql(`
    mutation UnmarkFileViewed($pullRequestId: ID!, $path: String!) {
        unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
            clientMutationId
        }
    }
`);

export const dismissReviewMutation = graphql(`
    mutation DismissReview($id: ID!, $message: String!) {
        dismissPullRequestReview(input: { pullRequestReviewId: $id, message: $message }) {
            pullRequestReview {
                id
            }
        }
    }
`);

/**
 * Replies in a thread: into the pending review, opening one when there is none, or on its own at once when
 * the reader asks for that.
 */
export async function replyToThread(
    client: GitHubClient,
    subject: ReviewSubject,
    threadId: string,
    body: string,
    { single }: { single: boolean },
): Promise<void> {
    const pullRequestReviewId = single ? null : await pendingReview(client, subject);
    await mutate(client, addThreadReplyMutation, { threadId, body, pullRequestReviewId });
}

export async function setThreadResolved(client: GitHubClient, threadId: string, resolved: boolean): Promise<void> {
    if (resolved) await mutate(client, resolveThreadMutation, { threadId });
    else await mutate(client, unresolveThreadMutation, { threadId });
}

/**
 * The kinds of comment the viewer can edit: one on the PR, one in a review thread, a review's summary, and the
 * PR's description, whose id is the PR's.
 */
export type CommentKind = "issue" | "review-comment" | "review" | "description";

export async function editComment(client: GitHubClient, kind: CommentKind, id: string, body: string): Promise<void> {
    if (kind === "description") await editPullRequest(client, id, { body });
    else if (kind === "issue") await mutate(client, updateIssueCommentMutation, { id, body });
    else if (kind === "review-comment") await mutate(client, updateReviewCommentMutation, { id, body });
    else await mutate(client, updateReviewMutation, { id, body });
}

/** Deletes a comment; a review's summary and the description cannot be deleted, only edited. */
export async function deleteComment(
    client: GitHubClient,
    kind: Exclude<CommentKind, "review" | "description">,
    id: string,
): Promise<void> {
    if (kind === "issue") await mutate(client, deleteIssueCommentMutation, { id });
    else await mutate(client, deleteReviewCommentMutation, { id });
}

export async function setReaction(
    client: GitHubClient,
    subjectId: string,
    content: ReactionContent,
    on: boolean,
): Promise<void> {
    if (on) await mutate(client, addReactionMutation, { subjectId, content });
    else await mutate(client, removeReactionMutation, { subjectId, content });
}

export async function setFileViewed(
    client: GitHubClient,
    pullRequestId: string,
    path: string,
    viewed: boolean,
): Promise<void> {
    if (viewed) await mutate(client, markFileViewedMutation, { pullRequestId, path });
    else await mutate(client, unmarkFileViewedMutation, { pullRequestId, path });
}

export async function dismissReview(client: GitHubClient, reviewId: string, message: string): Promise<void> {
    await mutate(client, dismissReviewMutation, { id: reviewId, message });
}

/** Asks a reviewer for another review, as the sidebar's re-request does on GitHub. */
export async function requestReview(client: GitHubClient, route: PrRoute, login: string): Promise<void> {
    try {
        await client.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
            owner: route.owner,
            repo: route.repo,
            pull_number: route.number,
            reviewers: [login],
        });
    } catch (error) {
        throw writeError(error);
    }
}

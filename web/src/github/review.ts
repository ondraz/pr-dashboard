import type { PrRoute } from "../logic/prRoute.ts";
import type { CommentTarget, ReviewEvent } from "../logic/review.ts";
import { type GitHubClient, mutate, writeError } from "./client.ts";
import { graphql } from "./gql/index.ts";

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

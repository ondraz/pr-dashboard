import type {
    PullCommitFieldsFragment,
    ReviewThreadDetailPageFragment,
    TimelinePageFragment,
} from "../github/gql/graphql.ts";

type TimelineNode = NonNullable<NonNullable<TimelinePageFragment["nodes"]>[number]>;
type ReviewThread = NonNullable<NonNullable<ReviewThreadDetailPageFragment["nodes"]>[number]>;
type Of<T extends TimelineNode["__typename"]> = Extract<TimelineNode, { __typename: T }>;

export type IssueCommentNode = Of<"IssueComment">;
export type ReviewNode = Of<"PullRequestReview">;
export type CommitNode = Of<"PullRequestCommit">;
export type EventNode = Of<
    | "HeadRefForcePushedEvent"
    | "ReviewRequestedEvent"
    | "ReviewRequestRemovedEvent"
    | "ReviewDismissedEvent"
    | "LabeledEvent"
    | "UnlabeledEvent"
    | "RenamedTitleEvent"
    | "BaseRefChangedEvent"
    | "ReadyForReviewEvent"
    | "ConvertToDraftEvent"
    | "ClosedEvent"
    | "ReopenedEvent"
    | "MergedEvent"
>;

const EVENT_TYPES: ReadonlySet<string> = new Set<EventNode["__typename"]>([
    "HeadRefForcePushedEvent",
    "ReviewRequestedEvent",
    "ReviewRequestRemovedEvent",
    "ReviewDismissedEvent",
    "LabeledEvent",
    "UnlabeledEvent",
    "RenamedTitleEvent",
    "BaseRefChangedEvent",
    "ReadyForReviewEvent",
    "ConvertToDraftEvent",
    "ClosedEvent",
    "ReopenedEvent",
    "MergedEvent",
]);

export type ConversationItem =
    | { kind: "comment"; comment: IssueCommentNode }
    | { kind: "review"; review: ReviewNode; threads: ReviewThread[] }
    | { kind: "commits"; id: string; commits: CommitNode["commit"][] }
    | { kind: "event"; event: EventNode }
    /** Threads whose review is not in the timeline read, shown after it. */
    | { kind: "threads"; threads: ReviewThread[] };

const isEvent = (node: TimelineNode): node is EventNode => EVENT_TYPES.has(node.__typename);

/** The review a thread hangs off: the one its first comment was posted in. */
export function threadReviewId(thread: ReviewThread): string | null {
    return thread.comments.nodes?.[0]?.pullRequestReview?.id ?? null;
}

/** A thread the viewer started in their pending review, which nobody else sees until it is submitted. */
export function isPendingThread(thread: ReviewThread): boolean {
    return thread.comments.nodes?.[0]?.state === "PENDING";
}

/**
 * The Conversation tab, top to bottom. Each review carries the threads it started, as on GitHub; a
 * reply posted later is its own review with nothing else in it, and those are left out, since the
 * reply already shows in its thread. Commits pushed in a row read as one entry. A review still
 * pending is the viewer's own unsent draft and stays out, with its threads.
 */
export function buildConversation(
    timeline: readonly TimelineNode[],
    threads: readonly ReviewThread[],
): ConversationItem[] {
    const threadsByReview = new Map<string, ReviewThread[]>();
    const orphans: ReviewThread[] = [];
    for (const thread of threads) {
        if (isPendingThread(thread)) continue;
        const reviewId = threadReviewId(thread);
        if (!reviewId) {
            orphans.push(thread);
            continue;
        }
        const list = threadsByReview.get(reviewId);
        if (list) list.push(thread);
        else threadsByReview.set(reviewId, [thread]);
    }

    const items: ConversationItem[] = [];
    for (const node of timeline) {
        if (node.__typename === "IssueComment") {
            items.push({ kind: "comment", comment: node });
        } else if (node.__typename === "PullRequestReview") {
            const started = threadsByReview.get(node.id) ?? [];
            threadsByReview.delete(node.id);
            if (node.state === "PENDING") continue;
            if (node.state === "COMMENTED" && !node.bodyHTML.trim() && !started.length) continue;
            items.push({ kind: "review", review: node, threads: started });
        } else if (node.__typename === "PullRequestCommit") {
            const last = items.at(-1);
            if (last?.kind === "commits") last.commits.push(node.commit);
            else items.push({ kind: "commits", id: node.id, commits: [node.commit] });
        } else if (isEvent(node)) {
            items.push({ kind: "event", event: node });
        }
    }

    for (const list of threadsByReview.values()) orphans.push(...list);
    if (orphans.length) items.push({ kind: "threads", threads: orphans });
    return items;
}

/** When a timeline entry happened: a commit by its commit date, a review when it was submitted. */
function nodeDate(node: TimelineNode): string | null {
    switch (node.__typename) {
        case "PullRequestCommit":
            return node.commit.committedDate;
        case "PullRequestReview":
            return node.submittedAt ?? node.createdAt;
        default:
            return "createdAt" in node && typeof node.createdAt === "string" ? node.createdAt : null;
    }
}

/**
 * The timeline with `commits` it lacks placed among its entries by commit date, for when GitHub left
 * the commits out of it. GitHub orders them by when they were pushed, which the commit date stands in for.
 */
export function withCommits(
    timeline: readonly TimelineNode[],
    commits: readonly PullCommitFieldsFragment[],
): TimelineNode[] {
    const shown = new Set(
        timeline.flatMap((node) => (node.__typename === "PullRequestCommit" ? [node.commit.oid] : [])),
    );
    const missing = commits
        .filter((commit) => !shown.has(commit.oid))
        .map((commit): CommitNode => ({ __typename: "PullRequestCommit", id: `commit-${commit.oid}`, commit }))
        .sort((a, b) => Date.parse(a.commit.committedDate) - Date.parse(b.commit.committedDate));
    if (!missing.length) return [...timeline];
    const merged: TimelineNode[] = [];
    let next = 0;
    for (const node of timeline) {
        const at = nodeDate(node);
        while (at && next < missing.length && Date.parse(missing[next]?.commit.committedDate ?? "") <= Date.parse(at)) {
            merged.push(missing[next++] as CommitNode);
        }
        merged.push(node);
    }
    merged.push(...missing.slice(next));
    return merged;
}

/** Threads someone still has to act on: neither resolved nor in the viewer's unsent review. */
export function openThreads(threads: readonly ReviewThread[]): ReviewThread[] {
    return threads.filter((thread) => !thread.isResolved && !isPendingThread(thread));
}

/** Where a thread sits within its file: `:12`, `:10-12`, or nothing for a comment on the whole file. */
export function threadLines(thread: ReviewThread): string {
    if (thread.subjectType === "FILE") return "";
    const line = thread.line ?? thread.originalLine;
    const start = thread.startLine ?? thread.originalStartLine;
    return line ? `:${start && start !== line ? `${start}-` : ""}${line}` : "";
}

/** The first words of a comment as plain text, for a one-line list. */
export function commentExcerpt(body: string, length = 140): string {
    const text = body
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/<[^>]+>/g, "")
        // Markdown's marks, but not the underscores inside names like agent_cli.py.
        .replace(/^\s*(?:[>#]+|[-*+]|\d+\.)\s+/gm, "")
        .replace(/\*\*|[*`]|(?<!\w)_+|_+(?!\w)/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/** The DOM id of a thread or a review in the Conversation tab, which the side panel jumps to. */
export const conversationAnchor = (nodeId: string) => `conversation-${nodeId}`;

/** The last lines of a thread's diff hunk, the part its comment is about, as GitHub shows them. */
export function hunkTail(diffHunk: string, lines = 4): { text: string; kind: "add" | "del" | "context" }[] {
    return diffHunk
        .split("\n")
        .filter((line) => !line.startsWith("@@"))
        .slice(-lines)
        .map((text) => ({
            text,
            kind: text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "context",
        }));
}

/**
 * The conversation narrowed to what is still open: each review with only its unresolved threads, the
 * threads apart from any review likewise, and the review holding Copilot's standing verdict, which owes a
 * change without a thread to resolve. Everything else drops out.
 */
export function unresolvedOnly(items: readonly ConversationItem[], verdictReviewId: string | null): ConversationItem[] {
    return items.flatMap((item): ConversationItem[] => {
        if (item.kind !== "review" && item.kind !== "threads") return [];
        const threads = item.threads.filter((thread) => !thread.isResolved);
        if (threads.length) return [{ ...item, threads }];
        return item.kind === "review" && item.review.id === verdictReviewId ? [{ ...item, threads }] : [];
    });
}

/** When something in the conversation was made, and by whom. */
export interface Moment {
    at: string | null;
    author: string | null;
}

/** Every comment, review, commit and event an item holds, threads and their replies included. */
export function itemMoments(item: ConversationItem): Moment[] {
    const threadMoments = (threads: readonly ReviewThread[]) =>
        threads.flatMap((thread) =>
            (thread.comments.nodes ?? []).map((comment) => ({
                at: comment?.createdAt ?? null,
                author: comment?.author?.login ?? null,
            })),
        );
    switch (item.kind) {
        case "comment":
            return [{ at: item.comment.createdAt, author: item.comment.author?.login ?? null }];
        case "review":
            return [
                { at: item.review.submittedAt ?? item.review.createdAt, author: item.review.author?.login ?? null },
                ...threadMoments(item.threads),
            ];
        case "commits":
            return item.commits.map((commit) => ({
                at: commit.committedDate,
                author: commit.author?.user?.login ?? null,
            }));
        case "event":
            return [{ at: item.event.createdAt, author: item.event.actor?.login ?? null }];
        case "threads":
            return threadMoments(item.threads);
    }
}

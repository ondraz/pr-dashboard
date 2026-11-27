import { type CopilotVerdict, copilotVerdict, latestCopilotReview, type ReviewLike } from "./copilot.ts";
import type { RestReview } from "./reviews.ts";

export interface MergeQueueEntry {
    position?: number | null;
    state?: string | null;
}

/** A review thread as the GraphQL `reviewThreads` connection returns it. */
export interface ReviewThreadLike {
    isResolved: boolean;
    comments?: {
        totalCount: number;
        nodes?:
            | readonly ({
                  pullRequestReview?: { id: string } | null;
                  author?: { login: string } | null;
                  state?: string;
              } | null)[]
            | null;
    } | null;
    lastComment?: { nodes?: readonly ({ author?: { login: string } | null } | null)[] | null } | null;
}

/** What one PR still owes, as read from its review threads and reviews. */
export interface OutstandingWork {
    /** Unresolved review threads. */
    threads: number;
    /** Comments inside the unresolved threads. */
    comments: number;
    /** Unresolved threads the viewer started. */
    mine: number;
    /** Of those, the ones where someone else spoke last. */
    replies: number;
    /** Every review some thread hangs off, resolved or not. */
    threadedReviews: Set<string>;
    copilot: CopilotVerdict | null;
    mergeQueue: MergeQueueEntry | null;
    isDraft: boolean | null;
    headSha: string | null;
    /** Each reviewer's latest approval or change request; null when not read. */
    verdicts: RestReview[] | null;
    /** The viewer's own reviews, oldest first; null when not asked for or not read. */
    viewerReviews: RestReview[] | null;
}

export function emptyOutstandingWork(): OutstandingWork {
    return {
        threads: 0,
        comments: 0,
        mine: 0,
        replies: 0,
        threadedReviews: new Set(),
        copilot: null,
        mergeQueue: null,
        isDraft: null,
        headSha: null,
        verdicts: null,
        viewerReviews: null,
    };
}

/** Adds one page of review threads to `work`; `login` counts the viewer's own threads. */
export function tallyThreads(
    work: OutstandingWork,
    threads: readonly (ReviewThreadLike | null)[],
    login?: string | null,
): void {
    for (const thread of threads) {
        if (!thread) continue;
        // A verdict that left comments is settled by them - counted while open, done once resolved.
        const first = thread.comments?.nodes?.[0];
        // The viewer's pending review is theirs alone until it is submitted, so it owes nobody anything yet.
        if (first?.state === "PENDING") continue;
        if (first?.pullRequestReview) work.threadedReviews.add(first.pullRequestReview.id);
        if (thread.isResolved) continue;
        work.threads++;
        work.comments += thread.comments ? thread.comments.totalCount : 1;
        const starter = first?.author?.login ?? null;
        if (login && starter === login) {
            work.mine++;
            const last = thread.lastComment?.nodes?.[0];
            if (last?.author && last.author.login !== login) work.replies++;
        }
    }
}

/**
 * Copilot's verdict counts on its own only when it asks for changes and left no inline comment:
 * while its comments are open they already count, and once they are resolved it has been answered.
 */
export function standingVerdict(work: OutstandingWork): CopilotVerdict | null {
    const verdict = work.copilot;
    return verdict?.owing && !work.threadedReviews.has(verdict.id) ? verdict : null;
}

export interface UnresolvedSummary {
    unresolvedThreads: number;
    unresolvedComments: number;
    copilotVerdict: CopilotVerdict | null;
    /** Unresolved threads plus one for a standing Copilot verdict. */
    unresolved: number;
}

export function unresolvedSummary(work: OutstandingWork | null | undefined): UnresolvedSummary {
    if (!work) return { unresolvedThreads: 0, unresolvedComments: 0, copilotVerdict: null, unresolved: 0 };
    const verdict = standingVerdict(work);
    return {
        unresolvedThreads: work.threads,
        unresolvedComments: work.comments,
        copilotVerdict: verdict,
        unresolved: work.threads + (verdict ? 1 : 0),
    };
}

/** What one PR owes, from every one of its review threads and its latest reviews. */
export function prUnresolvedSummary(
    threads: readonly (ReviewThreadLike | null)[],
    reviews: readonly (ReviewLike | null)[],
): UnresolvedSummary {
    const work = emptyOutstandingWork();
    tallyThreads(work, threads);
    work.copilot = copilotVerdict(latestCopilotReview(reviews));
    return unresolvedSummary(work);
}

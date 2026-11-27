import type { CopilotVerdict } from "./copilot.ts";
import {
    type MyReviewStanding,
    type ReviewedStatus,
    reviewHref,
    WAITING_STATES,
    type WaitingInput,
    waitingState,
} from "./reviews.ts";
import type { AutoMerge } from "./stacks.ts";
import { timeAgo } from "./time.ts";
import type { MergeQueueEntry, UnresolvedSummary } from "./unresolved.ts";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface BadgeLink {
    text: string;
    title: string;
    href: string;
    className: string;
}

/** A queued PR keeps `auto_merge` armed in REST, so the queue entry wins over the auto-merge badge. */
export function mergeBadge(
    autoMerge: AutoMerge | null,
    mergeQueue: MergeQueueEntry | null = null,
): { text: string; title: string; inQueue: boolean } | null {
    if (mergeQueue) {
        const position = Number.isInteger(mergeQueue.position) ? ` #${mergeQueue.position}` : "";
        const state = mergeQueue.state ? ` (${mergeQueue.state.toLowerCase().replace(/_/g, " ")})` : "";
        return { text: `Merge queue${position}`, title: `In the merge queue${position}${state}`, inQueue: true };
    }
    if (!autoMerge) return null;
    const method = autoMerge.method ? ` (${autoMerge.method})` : "";
    const by = autoMerge.enabledBy ? ` by ${autoMerge.enabledBy}` : "";
    return {
        text: "Auto-merge",
        title: `Auto-merge enabled${method}${by} - merges on its own once checks and reviews pass`,
        inQueue: false,
    };
}

/**
 * What is still owed on a PR: review threads left open, plus Copilot's standing verdict when it
 * asked for something and left no comment to resolve. With nothing open inline, the verdict itself
 * is what there is to read, so the badge links to it.
 */
export function unresolvedBadge(
    pr: { html_url: string; myOpenThreads?: number } & UnresolvedSummary,
): { count: number; title: string; href: string } | null {
    if (!pr.unresolved) return null;
    const parts: string[] = [];
    if (pr.unresolvedThreads) {
        const comments = pr.unresolvedComments || pr.unresolvedThreads;
        const yours = pr.myOpenThreads ? `, ${pr.myOpenThreads} yours` : "";
        parts.push(
            `${plural(pr.unresolvedThreads, "unresolved review thread", "unresolved review threads")} (${plural(comments, "comment", "comments")})${yours}`,
        );
    }
    if (pr.copilotVerdict) parts.push(`Copilot: ${pr.copilotVerdict.label}`);
    return { count: pr.unresolved, title: parts.join(" - "), href: unresolvedHref(pr.html_url, pr) };
}

function unresolvedHref(
    htmlUrl: string,
    pr: { unresolvedThreads: number; copilotVerdict: CopilotVerdict | null },
): string {
    const reviewId = pr.copilotVerdict?.databaseId;
    if (!pr.unresolvedThreads && reviewId != null) return `${htmlUrl}#pullrequestreview-${reviewId}`;
    return `${htmlUrl}/files`;
}

export function unresolvedTotalTitle(total: number): string {
    return `${plural(total, "unresolved review thread", "unresolved review threads")} in this group`;
}

/**
 * What to do next on a PR waiting for the viewer. The tab is a to-do list, so the color says whether
 * the viewer can act: green when one approval finishes it, faded while the author owes them, amber
 * kept for a change request that still stands.
 */
export function waitingBadge(
    pr: WaitingInput & { html_url: string } & Omit<MyReviewStanding, "myVerdict" | "lastReviewAt">,
    now: number = Date.now(),
): BadgeLink {
    const key = waitingState(pr);
    const state = WAITING_STATES[key];
    const className =
        key === "ready" || key === "approved"
            ? "review-approved"
            : key === "author" && pr.myVerdict === "CHANGES_REQUESTED"
              ? "review-changes"
              : key === "author"
                ? "review-pending review-waiting"
                : "review-pending";
    const title = pr.lastReviewAt ? `${state.label}. Your last review: ${timeAgo(pr.lastReviewAt, now)}` : state.label;
    return { text: state.text, title, href: reviewHref(pr), className };
}

export const REVIEWED_BADGE_CLASS: Record<ReviewedStatus, string> = {
    "changes-updated": "review-changes",
    updated: "review-pending",
    changes: "review-changes",
    commented: "review-pending",
    approved: "review-approved",
    unknown: "review-pending",
};

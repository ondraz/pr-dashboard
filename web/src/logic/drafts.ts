import type { PrRoute } from "./prRoute.ts";
import type { CommentTarget, DiffSide } from "./review.ts";

/** Every draft of one PR is stored under this prefix, followed by what it is a draft of. */
export const draftPrefix = (route: PrRoute) => `draft:${route.owner}/${route.repo}#${route.number}:`;

/** The draft slot of a new comment on the diff; the path goes last, since it may hold anything. */
export function targetSlot(target: CommentTarget): string {
    if (target.subject === "file") return `file:${target.path}`;
    return `line:${target.side}:${target.startLine ?? target.line}-${target.line}:${target.path}`;
}

const LINE_SLOT = /^line:(LEFT|RIGHT):(\d+)-(\d+):(.+)$/s;

export function parseTargetSlot(slot: string): CommentTarget | null {
    if (slot.startsWith("file:")) {
        const path = slot.slice("file:".length);
        return path ? { subject: "file", path } : null;
    }
    const match = LINE_SLOT.exec(slot);
    if (!match) return null;
    const [, side, start, end, path] = match as unknown as [string, DiffSide, string, string, string];
    const line = Number(end);
    const startLine = Number(start);
    return { subject: "line", path, side, line, startLine: startLine === line ? null : startLine };
}

/**
 * The slots of a comment on the PR itself, of the pending review's summary, of a new title and of the batch of
 * suggestions to commit.
 */
export const PR_COMMENT_SLOT = "comment";
export const REVIEW_SLOT = "review";
export const TITLE_SLOT = "title";
export const SUGGESTIONS_SLOT = "suggestions";

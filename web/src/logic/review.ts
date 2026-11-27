export type DiffSide = "LEFT" | "RIGHT";

/** Where a new review comment goes: a whole file, or one line or a range of lines on one side of the diff. */
export type CommentTarget =
    | { subject: "file"; path: string }
    | { subject: "line"; path: string; side: DiffSide; line: number; startLine: number | null };

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** One line of a patch: the hunk it sits in and its text without the `+`, `-` or space in front. */
export interface PatchLine {
    hunk: number;
    text: string;
}

/** The lines a patch shows on each side, by line number: the only lines GitHub takes a comment on. */
export interface PatchLines {
    LEFT: Map<number, PatchLine>;
    RIGHT: Map<number, PatchLine>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function patchLines(hunks: string): PatchLines {
    const lines: PatchLines = { LEFT: new Map(), RIGHT: new Map() };
    let hunk = -1;
    let left = 0;
    let right = 0;
    for (const line of hunks.split("\n")) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            hunk++;
            left = Number(header[1]);
            right = Number(header[2]);
            continue;
        }
        if (hunk < 0 || line.startsWith("\\")) continue;
        const text = line.slice(1);
        if (line.startsWith("-")) {
            lines.LEFT.set(left++, { hunk, text });
        } else if (line.startsWith("+")) {
            lines.RIGHT.set(right++, { hunk, text });
        } else {
            lines.LEFT.set(left++, { hunk, text });
            lines.RIGHT.set(right++, { hunk, text });
        }
    }
    return lines;
}

/** The lines a range ending at `line` can start on: the earlier lines of its hunk on the same side, nearest last. */
export function rangeStarts(lines: PatchLines, side: DiffSide, line: number): number[] {
    const end = lines[side].get(line);
    if (!end) return [];
    return [...lines[side]]
        .filter(([number, at]) => at.hunk === end.hunk && number < line)
        .map(([number]) => number)
        .sort((a, b) => a - b);
}

/**
 * The target for a comment started at `line`, spanning back to `from` when both sit in one hunk, as GitHub
 * takes a range only within one; null when the line is not in the patch at all.
 */
export function lineTarget(
    lines: PatchLines,
    path: string,
    side: DiffSide,
    line: number,
    from: number = line,
): CommentTarget | null {
    if (!lines[side].has(line)) return null;
    const start = Math.min(from, line);
    const end = Math.max(from, line);
    const ranged = start !== end && rangeStarts(lines, side, end).includes(start);
    return { subject: "line", path, side, line: ranged ? end : line, startLine: ranged ? start : null };
}

/** A suggested change replacing the target's lines with their text as it is, for the reviewer to edit. */
export function suggestionBlock(lines: PatchLines, target: CommentTarget): string | null {
    if (target.subject !== "line" || target.side !== "RIGHT") return null;
    const texts: string[] = [];
    for (let line = target.startLine ?? target.line; line <= target.line; line++) {
        const at = lines.RIGHT.get(line);
        if (!at) return null;
        texts.push(at.text);
    }
    return `\`\`\`suggestion\n${texts.join("\n")}\n\`\`\``;
}

/** `text` with `insert` at the caret, on lines of its own. */
export function insertBlock(text: string, caret: number, insert: string): { text: string; caret: number } {
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const trail = after.startsWith("\n") ? "" : "\n";
    const head = `${before}${lead}${insert}${trail}`;
    return { text: head + after, caret: head.length };
}

/** "line 12" or "lines 10 to 12", on the side the comment is on. */
export function targetLabel(target: CommentTarget): string {
    if (target.subject === "file") return "this file";
    const side = target.side === "LEFT" ? "the old side" : "the new side";
    const range = target.startLine === null ? `line ${target.line}` : `lines ${target.startLine} to ${target.line}`;
    return `${range} on ${side}`;
}

/**
 * Why a review cannot be submitted as `event`, or null when it can. GitHub turns away approving or asking for
 * changes on your own PR, and a comment or a request for changes that says nothing.
 */
export function submitBlocker(
    event: ReviewEvent,
    { body, pendingComments, ownPr }: { body: string; pendingComments: number; ownPr: boolean },
): string | null {
    if (ownPr && event !== "COMMENT") {
        return event === "APPROVE"
            ? "You cannot approve your own pull request."
            : "You cannot request changes on your own pull request.";
    }
    if (event === "APPROVE" || body.trim() || pendingComments > 0) return null;
    return event === "COMMENT" ? "Write a summary or add a comment first." : "Say what needs to change.";
}

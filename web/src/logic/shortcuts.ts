/** A key the PR page answers, and what it does, for the shortcut list `?` opens. */
export interface Shortcut {
    keys: readonly string[];
    does: string;
}

export const PR_SHORTCUTS: readonly Shortcut[] = [
    { keys: ["[", "]"], does: "Previous and next pull request in the list" },
    { keys: ["j", "k"], does: "Next and previous file (Files changed)" },
    { keys: ["n", "p"], does: "Next and previous unresolved thread" },
    { keys: ["c"], does: "Comment on the current file (Files changed), or on the pull request" },
    { keys: ["v"], does: "Mark the current file viewed, or not (Files changed)" },
    { keys: ["?"], does: "Show these shortcuts" },
];

/**
 * Where `j` / `n` (forwards) and `k` / `p` (backwards) go, from the tops of the targets on screen in page
 * order: the first one below the reading line, or the last one above it. A target scrolled to sits on the
 * line, so the next press moves past it.
 */
export function stepIndex(tops: readonly number[], direction: 1 | -1, line: number): number | null {
    if (direction === 1) {
        const index = tops.findIndex((top) => top > line + 1);
        return index < 0 ? null : index;
    }
    for (let index = tops.length - 1; index >= 0; index--) {
        if ((tops[index] as number) < line - 1) return index;
    }
    return null;
}

/** The target being read: the last one whose top is at or above the reading line, else the first. */
export function currentIndex(tops: readonly number[], line: number): number | null {
    if (!tops.length) return null;
    let current = 0;
    tops.forEach((top, index) => {
        if (top <= line + 1) current = index;
    });
    return current;
}

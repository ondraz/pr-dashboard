/** A suggested change to commit: the lines of the head commit's file it replaces, and what replaces them. */
export interface Suggestion {
    commentId: string;
    threadId: string;
    path: string;
    /** First and last line replaced, 1-based and inclusive, in the file at the head commit. */
    startLine: number;
    line: number;
    /** The lines that replace them; none deletes them. */
    lines: string[];
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*suggestion\s*$/;

/**
 * The suggested lines in a comment's Markdown, or null unless it holds exactly one `suggestion` block, the
 * only kind GitHub commits. An empty block suggests deleting the lines.
 */
export function suggestedLines(body: string): string[] | null {
    const lines = body.split(/\r?\n/);
    const found: string[][] = [];
    for (let i = 0; i < lines.length; i++) {
        const open = FENCE_OPEN.exec(lines[i] ?? "");
        if (!open) continue;
        const fence = open[1] ?? "```";
        const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
        const end = lines.findIndex((line, n) => n > i && close.test(line));
        if (end < 0) return null;
        found.push(lines.slice(i + 1, end));
        i = end;
    }
    return found.length === 1 ? (found[0] ?? null) : null;
}

/** What a review thread's comment needs for its suggestion to be committed. */
export interface SuggestionSource {
    threadId: string;
    path: string;
    subjectType: string;
    diffSide: string;
    line: number | null;
    startLine: number | null;
    isOutdated: boolean;
    isResolved: boolean;
    comment: { id: string; body: string; state: string };
}

/**
 * The comment's suggestion, when GitHub would let it be committed: a submitted comment on lines of the new side
 * that still stand in the head commit, in a thread nobody resolved.
 */
export function suggestionOf(source: SuggestionSource): Suggestion | null {
    if (source.subjectType !== "LINE" || source.diffSide !== "RIGHT" || source.line === null) return null;
    if (source.isOutdated || source.isResolved || source.comment.state === "PENDING") return null;
    const lines = suggestedLines(source.comment.body);
    if (lines === null) return null;
    return {
        commentId: source.comment.id,
        threadId: source.threadId,
        path: source.path,
        startLine: source.startLine ?? source.line,
        line: source.line,
        lines,
    };
}

/** Thrown when two suggestions change the same lines, which one commit cannot hold. */
export class OverlappingSuggestions extends Error {
    override name = "OverlappingSuggestions";
}

/**
 * The file with each suggestion in place of its lines. The file's own line ending is kept, and so is whether it
 * ends with one.
 */
export function applySuggestions(content: string, suggestions: readonly Suggestion[]): string {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const trailing = content.endsWith(eol);
    const lines = (trailing ? content.slice(0, -eol.length) : content).split(eol);
    const ordered = [...suggestions].sort((a, b) => b.startLine - a.startLine);
    let floor = Number.POSITIVE_INFINITY;
    for (const suggestion of ordered) {
        if (suggestion.line >= floor) {
            throw new OverlappingSuggestions(`Two suggestions change ${suggestion.path} at line ${suggestion.line}`);
        }
        if (suggestion.startLine < 1 || suggestion.line > lines.length || suggestion.startLine > suggestion.line) {
            throw new RangeError(`${suggestion.path} has no lines ${suggestion.startLine}-${suggestion.line}`);
        }
        lines.splice(suggestion.startLine - 1, suggestion.line - suggestion.startLine + 1, ...suggestion.lines);
        floor = suggestion.startLine;
    }
    return lines.join(eol) + (trailing ? eol : "");
}

/** The headline GitHub gives a suggestion's commit: the file's name for one, a general one for several. */
export function suggestionHeadline(suggestions: readonly Suggestion[]): string {
    const [only] = suggestions;
    if (suggestions.length === 1 && only) return `Update ${only.path.split("/").at(-1)}`;
    return "Apply suggestions from code review";
}

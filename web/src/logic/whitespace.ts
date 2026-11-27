/**
 * Hiding whitespace, as `git diff -w` does, done in the browser since GitHub's API has no such option.
 *
 * Every line outside a diff's hunks is the same on both sides, so re-diffing each hunk's old and new lines
 * with whitespace ignored gives a whitespace-blind diff of the whole files without reading either of them.
 * A line whose change was only whitespace becomes context, shown as it is now; hunks left with no change
 * drop out, and the rest are cut down to three lines of context around what still changes.
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const CONTEXT = 3;
// Past this many cells in the comparison table a hunk is left as it is rather than held in memory.
const MAX_CELLS = 4_000_000;

type Kind = " " | "-" | "+";

interface Row {
    kind: Kind;
    text: string;
}

interface Hunk {
    /** The first line of each side the hunk holds, or the line after the hunk's place when it holds none. */
    oldStart: number;
    newStart: number;
    section: string;
    rows: Row[];
}

function parseHunks(patch: string): Hunk[] {
    const hunks: Hunk[] = [];
    for (const line of patch.split("\n")) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            // A side with no lines names the line before the hunk's place, as `range` writes it back.
            hunks.push({
                oldStart: Number(header[1]) + (header[2] === "0" ? 1 : 0),
                newStart: Number(header[3]) + (header[4] === "0" ? 1 : 0),
                section: header[5] ?? "",
                rows: [],
            });
            continue;
        }
        const kind = line[0];
        if (kind === " " || kind === "-" || kind === "+") hunks.at(-1)?.rows.push({ kind, text: line.slice(1) });
    }
    return hunks;
}

const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * The rows of a hunk whose old lines `before` became the new lines `after`, matching lines that differ only
 * in whitespace; a matched line shows as it is now. Null when the hunk is too large to compare.
 */
function compareIgnoringWhitespace(before: readonly string[], after: readonly string[]): Row[] | null {
    const a = before.map(squash);
    const b = after.map(squash);
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
        tail++;
    }
    const rows: Row[] = after.slice(0, head).map((text) => ({ kind: " ", text }));
    const n = a.length - head - tail;
    const m = b.length - head - tail;
    if ((n + 1) * (m + 1) > MAX_CELLS) return null;
    // The longest common run of the middle, from each pair of positions to the end.
    const width = m + 1;
    const common = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            common[i * width + j] =
                a[head + i] === b[head + j]
                    ? (common[(i + 1) * width + j + 1] as number) + 1
                    : Math.max(common[(i + 1) * width + j] as number, common[i * width + j + 1] as number);
        }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && a[head + i] === b[head + j]) {
            rows.push({ kind: " ", text: after[head + j] as string });
            i++;
            j++;
        } else if (
            j >= m ||
            (i < n && (common[(i + 1) * width + j] as number) >= (common[i * width + j + 1] as number))
        ) {
            rows.push({ kind: "-", text: before[head + i] as string });
            i++;
        } else {
            rows.push({ kind: "+", text: after[head + j] as string });
            j++;
        }
    }
    for (const text of after.slice(after.length - tail)) rows.push({ kind: " ", text });
    return rows;
}

const range = (start: number, count: number) => `${count ? start : start - 1},${count}`;

/** The parts of one hunk's rows that still change, each with up to three lines of context either side. */
function cut(hunk: Hunk, rows: readonly Row[]): string[] {
    const changes = rows.flatMap((row, index) => (row.kind === " " ? [] : [index]));
    const out: string[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    let next = 0;
    let first = true;
    for (let c = 0; c < changes.length; ) {
        const start = Math.max((changes[c] as number) - CONTEXT, next);
        let last = changes[c] as number;
        while (c + 1 < changes.length && (changes[c + 1] as number) - last <= 2 * CONTEXT)
            last = changes[++c] as number;
        c++;
        const end = Math.min(last + CONTEXT + 1, rows.length);
        for (const row of rows.slice(next, start)) {
            if (row.kind !== "+") oldLine++;
            if (row.kind !== "-") newLine++;
        }
        const part = rows.slice(start, end);
        const oldCount = part.filter((row) => row.kind !== "+").length;
        const newCount = part.filter((row) => row.kind !== "-").length;
        out.push(
            `@@ -${range(oldLine, oldCount)} +${range(newLine, newCount)} @@${first ? hunk.section : ""}`,
            ...part.map((row) => row.kind + row.text),
        );
        oldLine += oldCount;
        newLine += newCount;
        next = end;
        first = false;
    }
    return out;
}

/** The hunks with changes to whitespace alone left out; empty when nothing else changed. */
export function hideWhitespace(patch: string): string {
    const out: string[] = [];
    for (const hunk of parseHunks(patch)) {
        const before = hunk.rows.filter((row) => row.kind !== "+").map((row) => row.text);
        const after = hunk.rows.filter((row) => row.kind !== "-").map((row) => row.text);
        out.push(...cut(hunk, compareIgnoringWhitespace(before, after) ?? hunk.rows));
    }
    return out.join("\n");
}

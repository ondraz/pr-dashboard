/** What GitHub's REST API calls a file's change: `changed` is a mode change, `unchanged` a file it lists anyway. */
export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

/** One file of a diff, as the Files changed tab shows it. */
export interface ChangedFile {
    path: string;
    /** The path before a rename or copy. */
    previousPath: string | null;
    status: FileStatus;
    additions: number;
    deletions: number;
    /** The hunks, from the first `@@`; GitHub leaves it out for binary files and very large diffs. */
    patch: string | null;
}

/** A file's section of a raw `git diff`. */
export interface RawFileDiff {
    oldPath: string;
    newPath: string;
    binary: boolean;
    /** The hunks, from the first `@@`, or null when the section has none (binary, empty, mode only). */
    hunks: string | null;
}

/** Past this many changed lines a file's diff waits for a click, as on GitHub. */
export const LARGE_DIFF_LINES = 400;

/** A file whose hunks have to come from the raw diff: GitHub left its patch out, or cut it. */
export function needsRawDiff(file: ChangedFile): boolean {
    return file.additions + file.deletions > 0 && !patchIsComplete(file);
}

export function isLargeDiff(file: Pick<ChangedFile, "additions" | "deletions">): boolean {
    return file.additions + file.deletions > LARGE_DIFF_LINES;
}

/**
 * Whether the REST `patch` holds the whole change: GitHub drops it for a diff too large to send, so a file
 * with changed lines and no patch, or a patch whose lines do not add up, needs the raw diff instead.
 */
export function patchIsComplete(file: Pick<ChangedFile, "patch" | "additions" | "deletions">): boolean {
    if (file.patch === null) return file.additions + file.deletions === 0;
    let additions = 0;
    let deletions = 0;
    for (const line of file.patch.split("\n")) {
        if (line.startsWith("+")) additions++;
        else if (line.startsWith("-")) deletions++;
    }
    return additions === file.additions && deletions === file.deletions;
}

/** Git quotes a path with unusual characters and escapes them, as C does. */
function unquote(path: string): string {
    if (!path.startsWith('"') || !path.endsWith('"')) return path;
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    const body = path.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
        const char = body[i] as string;
        if (char !== "\\") {
            bytes.push(...encoder.encode(char));
            continue;
        }
        const next = body[++i] ?? "";
        const octal = /^[0-7]{3}/.exec(body.slice(i));
        if (octal) {
            bytes.push(Number.parseInt(octal[0], 8));
            i += 2;
        } else {
            const escaped: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
            bytes.push(...encoder.encode(escaped[next] ?? next));
        }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `a/x` or `b/x` from a `---` or `+++` line, null for `/dev/null`. */
function sidePath(rest: string): string | null {
    const path = unquote(rest.replace(/\t$/, ""));
    if (path === "/dev/null") return null;
    return path.replace(/^[ab]\//, "");
}

/** The paths of a `diff --git a/x b/x` line; only reliable when both sides are the same path. */
function headerPaths(header: string): { oldPath: string; newPath: string } {
    const rest = header.slice("diff --git ".length);
    const quoted = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(rest);
    if (quoted?.[1] && quoted[2]) {
        return { oldPath: unquote(quoted[1]).slice(2), newPath: unquote(quoted[2]).slice(2) };
    }
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) {
        const path = rest.slice(2, half);
        return { oldPath: path, newPath: path };
    }
    const [oldPath = "", newPath = oldPath] = rest.split(" b/");
    return { oldPath: oldPath.replace(/^a\//, ""), newPath };
}

/** Splits a raw `git diff`, as GitHub sends it for `application/vnd.github.diff`, into its files. */
export function splitRawDiff(raw: string): RawFileDiff[] {
    const files: RawFileDiff[] = [];
    let current: (RawFileDiff & { lines: string[] | null }) | null = null;
    const finish = () => {
        if (!current) return;
        const { lines, ...file } = current;
        files.push({ ...file, hunks: lines ? lines.join("\n").replace(/\n+$/, "") : null });
    };
    for (const line of raw.split("\n")) {
        if (line.startsWith("diff --git ")) {
            finish();
            current = { ...headerPaths(line), binary: false, hunks: null, lines: null };
            continue;
        }
        if (!current) continue;
        if (current.lines) {
            current.lines.push(line);
        } else if (line.startsWith("@@")) {
            current.lines = [line];
        } else if (line.startsWith("rename from ") || line.startsWith("copy from ")) {
            current.oldPath = unquote(line.slice(line.indexOf(" from ") + 6));
        } else if (line.startsWith("rename to ") || line.startsWith("copy to ")) {
            current.newPath = unquote(line.slice(line.indexOf(" to ") + 4));
        } else if (line.startsWith("--- ")) {
            current.oldPath = sidePath(line.slice(4)) ?? current.oldPath;
        } else if (line.startsWith("+++ ")) {
            current.newPath = sidePath(line.slice(4)) ?? current.newPath;
        } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
            current.binary = true;
        }
    }
    finish();
    return files;
}

/** The raw diff's section for `file`, matched on its path and, for a rename, the path before it. */
export function rawSectionOf(sections: readonly RawFileDiff[], file: ChangedFile): RawFileDiff | undefined {
    return sections.find(
        (section) => section.newPath === file.path && (!file.previousPath || section.oldPath === file.previousPath),
    );
}

/** The input `@git-diff-view` parses: a unified diff with its `---` and `+++` lines. */
export function unifiedDiffText(oldPath: string, newPath: string, hunks: string): string {
    return `--- a/${oldPath}\n+++ b/${newPath}\n${hunks.replace(/\n+$/, "")}\n`;
}

export interface FileTreeNode {
    /** One path segment, or several joined with `/` where a directory holds nothing but one directory. */
    name: string;
    path: string;
    file: ChangedFile | null;
    children: FileTreeNode[];
}

/**
 * The directories and files of a diff, directories first and each level by name, with chains of
 * directories that hold one directory each folded into one node, as GitHub's file tree does.
 */
export function buildFileTree(files: readonly ChangedFile[]): FileTreeNode[] {
    const root: FileTreeNode = { name: "", path: "", file: null, children: [] };
    for (const file of files) {
        const parts = file.path.split("/");
        let node = root;
        parts.forEach((part, index) => {
            const path = parts.slice(0, index + 1).join("/");
            const leaf = index === parts.length - 1;
            let child = node.children.find((candidate) => candidate.name === part && !candidate.file === !leaf);
            if (!child) {
                child = { name: part, path, file: leaf ? file : null, children: [] };
                node.children.push(child);
            }
            node = child;
        });
    }
    const fold = (node: FileTreeNode): FileTreeNode => {
        let folded = node;
        while (!folded.file && folded.children.length === 1 && !folded.children[0]?.file) {
            const only = folded.children[0] as FileTreeNode;
            folded = { ...only, name: `${folded.name}/${only.name}` };
        }
        return { ...folded, children: sortLevel(folded.children.map(fold)) };
    };
    return sortLevel(root.children.map(fold));
}

function sortLevel(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
}

/** The files in the order the tree lists them, which is the order their diffs are shown in. */
export function treeOrder(nodes: readonly FileTreeNode[]): ChangedFile[] {
    return nodes.flatMap((node) => (node.file ? [node.file] : treeOrder(node.children)));
}

/** Keeps the files whose path holds every word of `query`, ignoring case; a rename matches on either path. */
export function filterFiles(files: readonly ChangedFile[], query: string): ChangedFile[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...files];
    return files.filter((file) => {
        const paths = `${file.path}\n${file.previousPath ?? ""}`.toLowerCase();
        return words.every((word) => paths.includes(word));
    });
}

/** The id of a file's diff on the page, so the tree can scroll to it. */
export function fileAnchor(path: string): string {
    return `diff-${encodeURIComponent(path)}`;
}

/** Which changes the Files changed tab shows: the whole PR, one commit, or the commits after one up to another. */
export type DiffSpec = { kind: "all" } | { kind: "commit"; sha: string } | { kind: "range"; from: string; to: string };

const SHA = /^[0-9a-f]{7,40}$/i;

export type PartialDiffSpec = Exclude<DiffSpec, { kind: "all" }>;

/** The `<sha>` or `<from>..<to>` after `/files/`, as GitHub writes a commit or a range of commits there. */
export function parseDiffRange(param: string): PartialDiffSpec | null {
    const [from, to, ...rest] = param.split("..");
    if (rest.length || !from || !SHA.test(from)) return null;
    if (to === undefined) return { kind: "commit", sha: from.toLowerCase() };
    return SHA.test(to) ? { kind: "range", from: from.toLowerCase(), to: to.toLowerCase() } : null;
}

export function parseCommitSha(param: string): string | null {
    return SHA.test(param) ? param.toLowerCase() : null;
}

export function diffRangeParam(spec: PartialDiffSpec): string {
    return spec.kind === "commit" ? spec.sha : `${spec.from}..${spec.to}`;
}

/** The commit the diff's new side is at, whose files fill in the context around the hunks. */
export function diffHead(spec: DiffSpec, prHead: string): string {
    if (spec.kind === "commit") return spec.sha;
    if (spec.kind === "range") return spec.to;
    return prHead;
}

/** The commits `from` exclusive to `to` inclusive, in the PR's order; the PR's own base stands before its first. */
export function rangeOf(commits: readonly string[], first: number, last: number, base: string): PartialDiffSpec | null {
    const to = commits[last];
    if (to === undefined || first < 0 || first > last) return null;
    if (first === last) return { kind: "commit", sha: to };
    return { kind: "range", from: first === 0 ? base : (commits[first - 1] as string), to };
}

/** The changes since the commit the viewer last reviewed, or null when they have not reviewed. */
export function sinceReview(reviewedOid: string | null | undefined, headOid: string): PartialDiffSpec | null {
    return reviewedOid ? { kind: "range", from: reviewedOid, to: headOid } : null;
}

/** Whether a file's surroundings can be read from the file at the head commit; an added or deleted file has none. */
export function canExpandContext(file: ChangedFile): boolean {
    return file.status !== "added" && file.status !== "removed";
}

/** The fields of a review thread that say where it sits in the diff. */
export interface ThreadAnchor {
    path: string;
    line: number | null;
    diffSide: "LEFT" | "RIGHT";
    subjectType: "LINE" | "FILE";
    isOutdated: boolean;
}

export interface FileThreads<T> {
    /** Threads on the file as a whole, shown above its diff. */
    file: T[];
    /** Line threads by the line they end on, on each side of the diff. */
    old: Record<string, T[]>;
    new: Record<string, T[]>;
    count: number;
}

export interface PlacedThreads<T> {
    byPath: Map<string, FileThreads<T>>;
    /** Outdated threads and threads on files this diff does not show, listed apart from the diff. */
    apart: T[];
}

/** Puts each review thread at its file and line in the PR's whole diff, and everything else apart. */
export function placeThreads<T extends ThreadAnchor>(
    threads: readonly T[],
    paths: ReadonlySet<string>,
): PlacedThreads<T> {
    const byPath = new Map<string, FileThreads<T>>();
    const apart: T[] = [];
    for (const thread of threads) {
        const onLine = thread.subjectType === "LINE";
        if (thread.isOutdated || !paths.has(thread.path) || (onLine && thread.line === null)) {
            apart.push(thread);
            continue;
        }
        let placed = byPath.get(thread.path);
        if (!placed) {
            placed = { file: [], old: {}, new: {}, count: 0 };
            byPath.set(thread.path, placed);
        }
        placed.count++;
        if (!onLine) {
            placed.file.push(thread);
            continue;
        }
        const side = thread.diffSide === "LEFT" ? placed.old : placed.new;
        const key = String(thread.line);
        side[key] = [...(side[key] ?? []), thread];
    }
    return { byPath, apart };
}

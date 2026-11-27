import { DiffFile, DiffModeEnum, DiffViewWithMultiSelect, SplitSide } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { FileViewedState } from "../github/gql/graphql.ts";
import type { ReviewThread } from "../github/pullRequest.ts";
import { ChevronIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import { type Annotation as AnnotationData, placeAnnotations } from "../logic/checks.ts";
import {
    type ChangedFile,
    canExpandContext,
    type FileThreads,
    fileAnchor,
    isLargeDiff,
    patchIsComplete,
    type RawFileDiff,
    rawSectionOf,
    threadsOffLines,
    unifiedDiffText,
} from "../logic/diff.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { type CommentTarget, type DiffSide, lineTarget, type PatchLines, patchLines } from "../logic/review.ts";
import { hideWhitespace } from "../logic/whitespace.ts";
import { Annotation } from "./Annotation.tsx";
import { CommentComposer } from "./CommentComposer.tsx";
import { Thread } from "./Thread.tsx";
import { useFileText, useNearViewport } from "./useDiff.ts";

export type DiffMode = "unified" | "split";

const STATUS_LABEL: Partial<Record<ChangedFile["status"], string>> = {
    added: "Added",
    removed: "Deleted",
    renamed: "Renamed",
    copied: "Copied",
    changed: "Mode changed",
};

/** The raw diff a file falls back on when its REST patch is missing or cut. */
export interface RawDiffState {
    sections: RawFileDiff[] | undefined;
    error: Error | null;
}

export interface FileDiffProps {
    route: PrRoute;
    file: ChangedFile;
    /** The commit the diff's new side is at. */
    headOid: string;
    mode: DiffMode;
    /** Leave out changes to whitespace alone, as `git diff -w` does. */
    whitespaceHidden: boolean;
    /** Draw the hunks only once the file comes near the window, for a diff too long to draw at once. */
    lazy: boolean;
    theme: "light" | "dark";
    collapsed: boolean;
    onToggle: () => void;
    /** The reader's viewed state of the file, which GitHub keeps for them. */
    viewed: FileViewedState | undefined;
    /** Marks the file viewed or not; null where the reader cannot. */
    onViewed: ((viewed: boolean) => void) | null;
    /** A large diff the reader asked to see. */
    loaded: boolean;
    onLoad: () => void;
    raw: RawDiffState;
    threads: FileThreads<ReviewThread> | undefined;
    /** The checks' annotations on the file at `headOid`. */
    annotations: readonly AnnotationData[] | undefined;
    /** Where the file and the whole diff are on GitHub. */
    blobUrl: string | null;
    filesUrl: string;
    /** The new comments being written on this file. */
    composers: readonly CommentTarget[];
    /** Opens a new comment; null where the reader cannot comment on this diff. */
    onComment: ((target: CommentTarget) => void) | null;
}

type Body = { hunks: string } | { note: ReactNode };

function Note({ children }: { children: ReactNode }) {
    return <div className="file-note">{children}</div>;
}

/** The file's hunks, or why there are none to show. */
function bodyOf({ file, loaded, onLoad, raw, filesUrl }: FileDiffProps): Body {
    if (!file.patch && file.additions + file.deletions === 0) {
        if (file.status === "renamed" || file.status === "copied") {
            return { note: `File ${file.status} without changes.` };
        }
        if (file.status === "changed") return { note: "File mode changed." };
        return { note: "Binary or empty file, not shown." };
    }
    if (isLargeDiff(file) && !loaded) {
        return {
            note: (
                <>
                    Large diffs are not rendered by default.{" "}
                    <button type="button" className="link-btn" onClick={onLoad}>
                        Load diff
                    </button>
                </>
            ),
        };
    }
    if (file.patch && patchIsComplete(file)) return { hunks: file.patch };
    if (raw.error) {
        return {
            note: (
                <>
                    GitHub's API does not send this diff ({raw.error.message}).{" "}
                    <External href={filesUrl}>Open it on GitHub</External>.
                </>
            ),
        };
    }
    if (!raw.sections) return { note: "Loading the full diff..." };
    const section = rawSectionOf(raw.sections, file);
    if (section?.binary) return { note: "Binary file not shown." };
    if (!section?.hunks) {
        return {
            note: (
                <>
                    This diff is not in GitHub's raw diff either. <External href={filesUrl}>Open it on GitHub</External>
                    .
                </>
            ),
        };
    }
    return { hunks: section.hunks };
}

function useDiffFile(file: ChangedFile, hunks: string | null, theme: "light" | "dark", text: string | undefined) {
    const oldPath = file.previousPath ?? file.path;
    return useMemo(() => {
        if (hunks === null) return null;
        // With the file at the head commit, the view can show the lines between and around the hunks.
        const instance = DiffFile.createInstance({
            oldFile: { fileName: oldPath },
            newFile: { fileName: file.path, content: text ?? null },
            hunks: [unifiedDiffText(oldPath, file.path, hunks)],
        });
        instance.initTheme(theme);
        instance.init();
        instance.buildSplitDiffLines();
        instance.buildUnifiedDiffLines();
        return instance;
    }, [oldPath, file.path, hunks, theme, text]);
}

/** What sits under one line of the diff: the checks' annotations, its review threads, and a new comment. */
interface LineExtras {
    annotations: AnnotationData[];
    threads: ReviewThread[];
    composer: CommentTarget | null;
}

type ExtendSide = Record<string, { data: LineExtras }>;

function extendDataOf(
    threads: FileThreads<ReviewThread> | undefined,
    composers: readonly CommentTarget[],
    annotations: ReadonlyMap<number, AnnotationData[]> | undefined,
) {
    const sides: Record<DiffSide, ExtendSide> = { LEFT: {}, RIGHT: {} };
    const at = (side: DiffSide, line: number) => {
        sides[side][line] ??= { data: { annotations: [], threads: [], composer: null } };
        return (sides[side][line] as { data: LineExtras }).data;
    };
    for (const [line, list] of annotations ?? []) at("RIGHT", line).annotations = list;
    for (const [line, list] of Object.entries(threads?.old ?? {})) at("LEFT", Number(line)).threads = list;
    for (const [line, list] of Object.entries(threads?.new ?? {})) at("RIGHT", Number(line)).threads = list;
    for (const target of composers) {
        if (target.subject === "line") at(target.side, target.line).composer = target;
    }
    return { oldFile: sides.LEFT, newFile: sides.RIGHT };
}

function LineExtrasView({ data, lines }: { data: LineExtras | undefined; lines: PatchLines | null }) {
    // In split view the side without anything under the line is asked to render too, with nothing.
    if (!data || (!data.annotations.length && !data.threads.length && !data.composer)) return null;
    return (
        <div className="diff-threads">
            {data.annotations.map((annotation) => (
                <Annotation key={annotation.id} annotation={annotation} />
            ))}
            {data.threads.map((thread) => (
                <Thread key={thread.id} thread={thread} inDiff />
            ))}
            {data.composer && <CommentComposer target={data.composer} lines={lines} />}
        </div>
    );
}

// About one row of the diff per line of its patch, so the page keeps its length while files are drawn.
const ROW_HEIGHT = 20;
const MAX_PLACEHOLDER = 20_000;

/** Where a file's hunks will be drawn once it comes near the window. */
function FilePlaceholder({ file, loaded }: { file: ChangedFile; loaded: boolean }) {
    const rows =
        isLargeDiff(file) && !loaded ? 2 : file.patch ? file.patch.split("\n").length : file.additions + file.deletions;
    return (
        <div
            className="file-placeholder"
            style={{ height: Math.min(rows * ROW_HEIGHT, MAX_PLACEHOLDER) }}
            aria-hidden="true"
        />
    );
}

/** One file of the diff: its header, its file-level threads, and its hunks with their threads unless collapsed. */
export function FileDiff(props: FileDiffProps) {
    const {
        route,
        file,
        headOid,
        mode,
        theme,
        collapsed,
        onToggle,
        threads,
        annotations,
        blobUrl,
        composers,
        onComment,
    } = props;
    const { viewed, onViewed, whitespaceHidden, lazy } = props;
    const [wantsContext, setWantsContext] = useState(false);
    const [near, observe] = useNearViewport(lazy);
    const found = collapsed || !near ? null : bodyOf(props);
    const changed = found && "hunks" in found ? found.hunks : null;
    const shown = useMemo(
        () => (changed !== null && whitespaceHidden ? hideWhitespace(changed) : changed),
        [changed, whitespaceHidden],
    );
    const body: Body | null = shown === "" ? { note: "Only whitespace changed." } : shown ? { hunks: shown } : found;
    const hunks = shown || null;
    const expandable = hunks !== null && canExpandContext(file);
    const text = useFileText(route, file.path, headOid, expandable && wantsContext);
    const diffFile = useDiffFile(file, hunks, theme, text.data);
    const lines = useMemo(() => (hunks === null ? null : patchLines(hunks)), [hunks]);
    const offLines = useMemo(
        () => (whitespaceHidden && changed !== null ? threadsOffLines(threads, lines) : []),
        [whitespaceHidden, changed, threads, lines],
    );
    // An annotation is drawn under the line it ends on when the diff shows that line, and above the hunks otherwise.
    const placed = useMemo(() => placeAnnotations(annotations ?? [], lines?.RIGHT ?? new Map()), [annotations, lines]);
    const extendData = useMemo(
        () => extendDataOf(threads, composers, placed.byLine),
        [threads, composers, placed.byLine],
    );
    const renderExtendLine = useCallback(
        ({ data }: { data: LineExtras | undefined }) => <LineExtrasView data={data} lines={lines} />,
        [lines],
    );
    const fileComposer = composers.find((target) => target.subject === "file");
    const comment = (lineNumber: number, from: number, side: SplitSide) => {
        if (!onComment || !lines) return;
        const target = lineTarget(lines, file.path, side === SplitSide.old ? "LEFT" : "RIGHT", lineNumber, from);
        if (target) onComment(target);
    };
    const status = STATUS_LABEL[file.status];

    return (
        <section
            id={fileAnchor(file.path)}
            ref={observe}
            data-path={file.path}
            data-undrawn-threads={!collapsed && !near && threads?.count ? "" : undefined}
            className={`file-diff${collapsed ? " collapsed" : ""}`}
            aria-label={file.path}
        >
            <div className="file-header">
                <button
                    type="button"
                    className="file-toggle"
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.path}`}
                    onClick={onToggle}
                >
                    <ChevronIcon />
                </button>
                <span className="file-path">
                    {file.previousPath && file.previousPath !== file.path && (
                        <>
                            <span className="file-previous-path">{file.previousPath}</span>
                            {" → "}
                        </>
                    )}
                    {file.path}
                </span>
                {status && <span className="file-status">{status}</span>}
                {!!annotations?.length && (
                    <span className="file-threads">
                        {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}
                    </span>
                )}
                {!!threads?.count && (
                    <span className="file-threads">
                        {threads.count} {threads.count === 1 ? "thread" : "threads"}
                    </span>
                )}
                <span className="diffstat">
                    <span className="diffstat-add">+{file.additions}</span>
                    <span className="diffstat-del">−{file.deletions}</span>
                </span>
                {expandable &&
                    (text.data !== undefined && diffFile ? (
                        <button type="button" className="link-btn" onClick={() => diffFile.onAllExpand(mode)}>
                            Show the whole file
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="link-btn"
                            disabled={text.isFetching}
                            title="Read the file at this commit, so the lines around each change can be shown"
                            onClick={() => setWantsContext(true)}
                        >
                            {text.isFetching ? "Loading context..." : "Load context"}
                        </button>
                    ))}
                {onComment && !collapsed && (
                    <button
                        type="button"
                        className="link-btn"
                        onClick={() => onComment({ subject: "file", path: file.path })}
                    >
                        Comment on file
                    </button>
                )}
                {blobUrl && (
                    <External className="file-view" href={blobUrl}>
                        View file
                    </External>
                )}
                {viewed === "DISMISSED" && <span className="file-status">Changed since last viewed</span>}
                {onViewed && (
                    <label className="file-viewed">
                        <input
                            type="checkbox"
                            checked={viewed === "VIEWED"}
                            onChange={(event) => onViewed(event.target.checked)}
                        />
                        Viewed
                    </label>
                )}
            </div>
            {!collapsed && !near && <FilePlaceholder file={file} loaded={props.loaded} />}
            {body && (
                <div className="file-body">
                    {text.error && <Note>The file could not be read for context: {text.error.message}</Note>}
                    {(!!placed.elsewhere.length || !!threads?.file.length || !!offLines.length || fileComposer) && (
                        <div className="diff-threads file-level">
                            {placed.elsewhere.map((annotation) => (
                                <Annotation key={annotation.id} annotation={annotation} withPath />
                            ))}
                            {threads?.file.map((thread) => (
                                <Thread key={thread.id} thread={thread} inDiff />
                            ))}
                            {offLines.map((thread) => (
                                <Thread key={thread.id} thread={thread} />
                            ))}
                            {fileComposer && <CommentComposer target={fileComposer} lines={null} />}
                        </div>
                    )}
                    {"note" in body ? (
                        <Note>{body.note}</Note>
                    ) : (
                        diffFile && (
                            <DiffViewWithMultiSelect<LineExtras>
                                key={text.data === undefined ? "hunks" : "file"}
                                diffFile={diffFile}
                                diffViewMode={mode === "split" ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
                                diffViewTheme={theme}
                                diffViewHighlight
                                extendData={extendData}
                                renderExtendLine={renderExtendLine}
                                enableMultiSelect={!!onComment}
                                diffViewAddWidget={!!onComment}
                                onAddWidgetClick={({ lineNumber, fromLineNumber, side }) =>
                                    comment(lineNumber, fromLineNumber ?? lineNumber, side)
                                }
                            />
                        )
                    )}
                </div>
            )}
        </section>
    );
}

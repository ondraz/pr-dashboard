import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { type ReactNode, useMemo, useState } from "react";
import type { ReviewThread } from "../github/pullRequest.ts";
import { ChevronIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import {
    type ChangedFile,
    canExpandContext,
    type FileThreads,
    fileAnchor,
    isLargeDiff,
    patchIsComplete,
    type RawFileDiff,
    rawSectionOf,
    unifiedDiffText,
} from "../logic/diff.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { Thread } from "./Thread.tsx";
import { useFileText } from "./useDiff.ts";

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
    theme: "light" | "dark";
    collapsed: boolean;
    onToggle: () => void;
    /** A large diff the reader asked to see. */
    loaded: boolean;
    onLoad: () => void;
    raw: RawDiffState;
    threads: FileThreads<ReviewThread> | undefined;
    /** Where the file and the whole diff are on GitHub. */
    blobUrl: string | null;
    filesUrl: string;
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

function extendDataOf(threads: FileThreads<ReviewThread> | undefined) {
    const side = (lines: Record<string, ReviewThread[]> = {}) =>
        Object.fromEntries(Object.entries(lines).map(([line, data]) => [line, { data }]));
    return { oldFile: side(threads?.old), newFile: side(threads?.new) };
}

// In split view the side without a thread is asked to render too, with nothing.
function renderThreads({ data }: { data: ReviewThread[] | undefined }) {
    if (!data?.length) return null;
    return (
        <div className="diff-threads">
            {data.map((thread) => (
                <Thread key={thread.id} thread={thread} inDiff />
            ))}
        </div>
    );
}

/** One file of the diff: its header, its file-level threads, and its hunks with their threads unless collapsed. */
export function FileDiff(props: FileDiffProps) {
    const { route, file, headOid, mode, theme, collapsed, onToggle, threads, blobUrl } = props;
    const [wantsContext, setWantsContext] = useState(false);
    const body = collapsed ? null : bodyOf(props);
    const hunks = body && "hunks" in body ? body.hunks : null;
    const expandable = hunks !== null && canExpandContext(file);
    const text = useFileText(route, file.path, headOid, expandable && wantsContext);
    const diffFile = useDiffFile(file, hunks, theme, text.data);
    const extendData = useMemo(() => extendDataOf(threads), [threads]);
    const status = STATUS_LABEL[file.status];

    return (
        <section
            id={fileAnchor(file.path)}
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
                {blobUrl && (
                    <External className="file-view" href={blobUrl}>
                        View file
                    </External>
                )}
            </div>
            {body && (
                <div className="file-body">
                    {text.error && <Note>The file could not be read for context: {text.error.message}</Note>}
                    {!!threads?.file.length && (
                        <div className="diff-threads file-level">
                            {threads.file.map((thread) => (
                                <Thread key={thread.id} thread={thread} inDiff />
                            ))}
                        </div>
                    )}
                    {"note" in body ? (
                        <Note>{body.note}</Note>
                    ) : (
                        diffFile && (
                            <DiffView<ReviewThread[]>
                                key={text.data === undefined ? "hunks" : "file"}
                                diffFile={diffFile}
                                diffViewMode={mode === "split" ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
                                diffViewTheme={theme}
                                diffViewHighlight
                                extendData={extendData}
                                renderExtendLine={renderThreads}
                            />
                        )
                    )}
                </div>
            )}
        </section>
    );
}

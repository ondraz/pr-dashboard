import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { type ReactNode, useMemo } from "react";
import { ChevronIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import {
    type ChangedFile,
    fileAnchor,
    isLargeDiff,
    patchIsComplete,
    type RawFileDiff,
    rawSectionOf,
    unifiedDiffText,
} from "../logic/diff.ts";

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
    file: ChangedFile;
    mode: DiffMode;
    theme: "light" | "dark";
    collapsed: boolean;
    onToggle: () => void;
    /** A large diff the reader asked to see. */
    loaded: boolean;
    onLoad: () => void;
    raw: RawDiffState;
    /** Where the file and the whole diff are on GitHub. */
    blobUrl: string | null;
    filesUrl: string;
}

function Highlighted({
    oldPath,
    newPath,
    hunks,
    mode,
    theme,
}: {
    oldPath: string;
    newPath: string;
    hunks: string;
    mode: DiffMode;
    theme: "light" | "dark";
}) {
    const diffFile = useMemo(() => {
        const instance = DiffFile.createInstance({
            oldFile: { fileName: oldPath },
            newFile: { fileName: newPath },
            hunks: [unifiedDiffText(oldPath, newPath, hunks)],
        });
        instance.initTheme(theme);
        instance.init();
        instance.buildSplitDiffLines();
        instance.buildUnifiedDiffLines();
        return instance;
    }, [oldPath, newPath, hunks, theme]);
    return (
        <DiffView
            diffFile={diffFile}
            diffViewMode={mode === "split" ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
            diffViewTheme={theme}
            diffViewHighlight
        />
    );
}

function Note({ children }: { children: ReactNode }) {
    return <div className="file-note">{children}</div>;
}

function FileBody(props: FileDiffProps) {
    const { file, mode, theme, loaded, onLoad, raw, filesUrl } = props;
    const oldPath = file.previousPath ?? file.path;
    if (!file.patch && file.additions + file.deletions === 0) {
        if (file.status === "renamed" || file.status === "copied") {
            return <Note>File {file.status} without changes.</Note>;
        }
        if (file.status === "changed") return <Note>File mode changed.</Note>;
        return <Note>Binary or empty file, not shown.</Note>;
    }
    if (isLargeDiff(file) && !loaded) {
        return (
            <Note>
                Large diffs are not rendered by default.{" "}
                <button type="button" className="link-btn" onClick={onLoad}>
                    Load diff
                </button>
            </Note>
        );
    }
    if (file.patch && patchIsComplete(file)) {
        return <Highlighted oldPath={oldPath} newPath={file.path} hunks={file.patch} mode={mode} theme={theme} />;
    }
    if (raw.error) {
        return (
            <Note>
                GitHub's API does not send this diff ({raw.error.message}).{" "}
                <External href={filesUrl}>Open it on GitHub</External>.
            </Note>
        );
    }
    if (!raw.sections) {
        return <Note>Loading the full diff...</Note>;
    }
    const section = rawSectionOf(raw.sections, file);
    if (section?.binary) return <Note>Binary file not shown.</Note>;
    if (!section?.hunks) {
        return (
            <Note>
                This diff is not in GitHub's raw diff either. <External href={filesUrl}>Open it on GitHub</External>.
            </Note>
        );
    }
    return <Highlighted oldPath={oldPath} newPath={file.path} hunks={section.hunks} mode={mode} theme={theme} />;
}

/** One file of the diff: its header, and its hunks unless collapsed. */
export function FileDiff(props: FileDiffProps) {
    const { file, collapsed, onToggle, blobUrl } = props;
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
                <span className="diffstat">
                    <span className="diffstat-add">+{file.additions}</span>
                    <span className="diffstat-del">−{file.deletions}</span>
                </span>
                {blobUrl && (
                    <External className="file-view" href={blobUrl}>
                        View file
                    </External>
                )}
            </div>
            {!collapsed && (
                <div className="file-body">
                    <FileBody {...props} />
                </div>
            )}
        </section>
    );
}

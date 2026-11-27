import { useMemo, useState } from "react";
import { usePersistedChoice } from "../app/storage.ts";
import { External } from "../list/PrRows.tsx";
import {
    buildFileTree,
    type ChangedFile,
    fileAnchor,
    filterFiles,
    isLargeDiff,
    needsRawDiff,
    treeOrder,
} from "../logic/diff.ts";
import { type DiffMode, FileDiff } from "./FileDiff.tsx";
import { FileTree } from "./FileTree.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { useColorScheme, usePullFiles, usePullRawDiff } from "./useDiff.ts";

const MODES: readonly DiffMode[] = ["unified", "split"];

function toggled(set: ReadonlySet<string>, key: string, on: boolean): Set<string> {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** The PR's diff: a filterable file tree beside every changed file, unified or split. */
export function FilesTab() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const { data: files, error } = usePullFiles(route);
    const [mode, setMode] = usePersistedChoice<DiffMode>("diff_view", MODES, "unified");
    const theme = useColorScheme();
    const [filter, setFilter] = useState("");
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());

    const shown = useMemo(() => filterFiles(files ?? [], filter), [files, filter]);
    const tree = useMemo(() => buildFileTree(shown), [shown]);
    const ordered = useMemo(() => treeOrder(tree), [tree]);
    const wantsRaw = ordered.some(
        (file) => !collapsed.has(file.path) && (!isLargeDiff(file) || loaded.has(file.path)) && needsRawDiff(file),
    );
    const raw = usePullRawDiff(route, pr.headRefOid, wantsRaw);

    if (error && !files) return <div className="error">{error.message}</div>;
    if (!files) {
        return (
            <div className="loading">
                <div className="spinner" />
                <div>Loading changes...</div>
            </div>
        );
    }
    if (!files.length) return <div className="empty">No files changed.</div>;

    const open = (file: ChangedFile) => {
        setCollapsed((current) => toggled(current, file.path, false));
        document.getElementById(fileAnchor(file.path))?.scrollIntoView({ block: "start" });
    };
    const additions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const someCollapsed = ordered.some((file) => collapsed.has(file.path));

    return (
        <div className="files-tab">
            <div className="files-toolbar">
                <span className="files-summary">
                    {files.length} {files.length === 1 ? "file" : "files"} changed{" "}
                    <span className="diffstat-add">+{additions}</span>{" "}
                    <span className="diffstat-del">−{deletions}</span>
                </span>
                <div className="files-actions">
                    <button
                        type="button"
                        className="step-btn"
                        onClick={() =>
                            setCollapsed(someCollapsed ? new Set() : new Set(ordered.map((file) => file.path)))
                        }
                    >
                        {someCollapsed ? "Expand all" : "Collapse all"}
                    </button>
                    <fieldset className="segmented" aria-label="Diff view">
                        {MODES.map((choice) => (
                            <button
                                key={choice}
                                type="button"
                                className="step-btn"
                                aria-pressed={mode === choice}
                                onClick={() => setMode(choice)}
                            >
                                {choice === "unified" ? "Unified" : "Split"}
                            </button>
                        ))}
                    </fieldset>
                </div>
            </div>
            {files.length < pr.changedFiles && (
                <div className="timeline-note">
                    Showing {files.length} of {pr.changedFiles} files, as many as GitHub's API lists;{" "}
                    <External href={`${pr.url}/files`}>the rest are on GitHub</External>.
                </div>
            )}
            <div className="files-layout">
                <FileTree tree={tree} filter={filter} onFilter={setFilter} onOpen={open} />
                <div className="file-diffs">
                    {ordered.map((file) => (
                        <FileDiff
                            key={file.path}
                            file={file}
                            mode={mode}
                            theme={theme}
                            collapsed={collapsed.has(file.path)}
                            onToggle={() =>
                                setCollapsed((current) => toggled(current, file.path, !current.has(file.path)))
                            }
                            loaded={loaded.has(file.path)}
                            onLoad={() => setLoaded((current) => toggled(current, file.path, true))}
                            raw={{ sections: raw.data, error: raw.error }}
                            blobUrl={
                                file.status === "removed"
                                    ? null
                                    : `https://github.com/${route.owner}/${route.repo}/blob/${pr.headRefOid}/${encodePath(file.path)}`
                            }
                            filesUrl={`${pr.url}/files`}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { usePersistedChoice } from "../app/storage.ts";
import type { ReviewThread } from "../github/pullRequest.ts";
import { External } from "../list/PrRows.tsx";
import {
    buildFileTree,
    type ChangedFile,
    type DiffSpec,
    diffHead,
    fileAnchor,
    filterFiles,
    isLargeDiff,
    needsRawDiff,
    parseCommitSha,
    parseDiffRange,
    placeThreads,
    treeOrder,
} from "../logic/diff.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { timeAgo } from "../logic/time.ts";
import { CommitPicker } from "./CommitPicker.tsx";
import { type DiffMode, FileDiff } from "./FileDiff.tsx";
import { FileTree } from "./FileTree.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { Thread } from "./Thread.tsx";
import { type DiffFiles, useColorScheme, useDiffFiles, useRawDiff } from "./useDiff.ts";
import { usePullRequestCommits } from "./usePullRequest.ts";

const MODES: readonly DiffMode[] = ["unified", "split"];

function toggled(set: ReadonlySet<string>, key: string, on: boolean): Set<string> {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** The diff the URL names: `/files` for the whole PR, `/files/<sha>` or `/commits/<sha>` for one commit, `/files/<a>..<b>`. */
function useDiffSpec(): DiffSpec {
    const { range, sha } = useParams({ strict: false });
    const commit = sha === undefined ? null : parseCommitSha(sha);
    if (commit) return { kind: "commit", sha: commit };
    return (range === undefined ? null : parseDiffRange(range)) ?? { kind: "all" };
}

function githubDiffUrl(prUrl: string, spec: DiffSpec): string {
    if (spec.kind === "commit") return `${prUrl}/commits/${spec.sha}`;
    if (spec.kind === "range") return `${prUrl}/files/${spec.from}..${spec.to}`;
    return `${prUrl}/files`;
}

/** What a single commit says about itself, with steps to the commits either side of it in the PR. */
function CommitHeader({
    route,
    sha,
    commit,
}: {
    route: PrRoute;
    sha: string;
    commit: NonNullable<DiffFiles["commit"]>;
}) {
    const commits = usePullRequestCommits(route).data?.commits ?? [];
    const index = commits.findIndex((candidate) => candidate.oid === sha);
    const [headline, ...rest] = commit.message.split("\n");
    const body = rest.join("\n").trim();
    const step = (offset: number, label: string) => {
        const target = index < 0 ? undefined : commits[index + offset];
        return target ? (
            <Link
                className="step-btn"
                to="/$owner/$repo/pull/$number/commits/$sha"
                params={{ ...route, sha: target.oid }}
            >
                {label}
            </Link>
        ) : (
            <span className="step-btn" aria-disabled="true">
                {label}
            </span>
        );
    };
    return (
        <div className="commit-header">
            <div className="commit-header-main">
                <h2>{headline}</h2>
                {body && <pre className="commit-body">{body}</pre>}
                <div className="commit-meta">
                    {commit.author} committed {commit.committedAt ? timeAgo(commit.committedAt) : ""} ·{" "}
                    <External className="sha" href={commit.htmlUrl}>
                        {sha.slice(0, 7)}
                    </External>
                    {index >= 0 && ` · commit ${index + 1} of ${commits.length}`}
                </div>
            </div>
            <div className="pr-steps">
                {step(-1, "‹ Previous commit")}
                {step(1, "Next commit ›")}
            </div>
        </div>
    );
}

function ThreadsApart({ threads }: { threads: ReviewThread[] }) {
    if (!threads.length) return null;
    return (
        <section className="threads-apart" aria-label="Threads outside the diff">
            <h2>
                {threads.length} {threads.length === 1 ? "thread is" : "threads are"} not on the current diff: outdated,
                or on a file it no longer changes
            </h2>
            {threads.map((thread) => (
                <Thread key={thread.id} thread={thread} />
            ))}
        </section>
    );
}

/** A diff of the PR: a filterable file tree beside every changed file, unified or split, with its review threads. */
export function FilesTab() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const spec = useDiffSpec();
    const { data, error } = useDiffFiles(route, spec, pr.changedFiles);
    const files = data?.files;
    const [mode, setMode] = usePersistedChoice<DiffMode>("diff_view", MODES, "unified");
    const theme = useColorScheme();
    const [filter, setFilter] = useState("");
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
    const headOid = diffHead(spec, pr.headRefOid);

    const shown = useMemo(() => filterFiles(files ?? [], filter), [files, filter]);
    const tree = useMemo(() => buildFileTree(shown), [shown]);
    const ordered = useMemo(() => treeOrder(tree), [tree]);
    // Thread lines belong to the PR's whole diff, so only that view places them.
    const placed = useMemo(
        () =>
            spec.kind === "all" && files ? placeThreads(detail.threads, new Set(files.map((file) => file.path))) : null,
        [spec.kind, files, detail.threads],
    );
    const wantsRaw = ordered.some(
        (file) => !collapsed.has(file.path) && (!isLargeDiff(file) || loaded.has(file.path)) && needsRawDiff(file),
    );
    const raw = useRawDiff(route, spec, headOid, wantsRaw);
    const filesUrl = githubDiffUrl(pr.url, spec);

    let content: ReactNode;
    if (error && !data) {
        content = <div className="error">{error.message}</div>;
    } else if (!data || !files) {
        content = (
            <div className="loading">
                <div className="spinner" />
                <div>Loading changes...</div>
            </div>
        );
    } else if (!files.length) {
        content = <div className="empty">No files changed.</div>;
    } else {
        const open = (file: ChangedFile) => {
            setCollapsed((current) => toggled(current, file.path, false));
            document.getElementById(fileAnchor(file.path))?.scrollIntoView({ block: "start" });
        };
        const additions = files.reduce((sum, file) => sum + file.additions, 0);
        const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
        const someCollapsed = ordered.some((file) => collapsed.has(file.path));
        content = (
            <>
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
                {!data.complete && (
                    <div className="timeline-note">
                        Showing the {files.length} files GitHub's API lists;{" "}
                        <External href={filesUrl}>the rest are on GitHub</External>.
                    </div>
                )}
                {data.compareStatus === "diverged" && spec.kind === "range" && (
                    <div className="timeline-note">
                        The branch was rewritten after <code>{spec.from.slice(0, 7)}</code>, so this shows the changes
                        since where the two histories meet, which can include changes from the base branch.
                    </div>
                )}
                {spec.kind !== "all" && detail.threads.length > 0 && (
                    <div className="timeline-note">
                        Review threads show on{" "}
                        <Link to="/$owner/$repo/pull/$number/files" params={route}>
                            all changes
                        </Link>
                        .
                    </div>
                )}
                {placed && <ThreadsApart threads={placed.apart} />}
                <div className="files-layout">
                    <FileTree tree={tree} filter={filter} onFilter={setFilter} onOpen={open} />
                    <div className="file-diffs">
                        {ordered.map((file) => (
                            <FileDiff
                                key={file.path}
                                route={route}
                                file={file}
                                headOid={headOid}
                                mode={mode}
                                theme={theme}
                                collapsed={collapsed.has(file.path)}
                                onToggle={() =>
                                    setCollapsed((current) => toggled(current, file.path, !current.has(file.path)))
                                }
                                loaded={loaded.has(file.path)}
                                onLoad={() => setLoaded((current) => toggled(current, file.path, true))}
                                raw={{ sections: raw.data, error: raw.error }}
                                threads={placed?.byPath.get(file.path)}
                                blobUrl={
                                    file.status === "removed"
                                        ? null
                                        : `https://github.com/${route.owner}/${route.repo}/blob/${headOid}/${encodePath(file.path)}`
                                }
                                filesUrl={filesUrl}
                            />
                        ))}
                    </div>
                </div>
            </>
        );
    }

    return (
        <div className="files-tab">
            {spec.kind === "commit" && data?.commit && (
                <CommitHeader route={route} sha={spec.sha} commit={data.commit} />
            )}
            <div className="files-picker">
                <CommitPicker spec={spec} />
            </div>
            {content}
        </div>
    );
}

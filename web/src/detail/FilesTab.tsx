import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { drafts, useDraftKeys } from "../app/drafts.ts";
import { usePersistedChoice } from "../app/storage.ts";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { FileViewedState } from "../github/gql/graphql.ts";
import type { ReviewThread } from "../github/pullRequest.ts";
import { setFileViewed } from "../github/review.ts";
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
import { draftPrefix, parseTargetSlot } from "../logic/drafts.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import type { CommentTarget } from "../logic/review.ts";
import { timeAgo } from "../logic/time.ts";
import { targetDraftKey } from "./CommentComposer.tsx";
import { CommitPicker } from "./CommitPicker.tsx";
import { type DiffMode, FileDiff } from "./FileDiff.tsx";
import { FileTree } from "./FileTree.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { Thread } from "./Thread.tsx";
import { type DiffFiles, useColorScheme, useDiffFiles, useRawDiff } from "./useDiff.ts";
import { prQueryKey, usePullRequestCommits, useViewedFiles } from "./usePullRequest.ts";
import { usePrWrite } from "./useWrite.ts";

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

const NO_COMPOSERS: readonly CommentTarget[] = [];

/** The new comments being written on the PR's diff, by file: every draft kept for one opens its box. */
function useComposers(route: PrRoute): Map<string, CommentTarget[]> {
    const prefix = draftPrefix(route);
    const keys = useDraftKeys(prefix);
    return useMemo(() => {
        const byPath = new Map<string, CommentTarget[]>();
        for (const key of keys) {
            const target = parseTargetSlot(key.slice(prefix.length));
            if (target) byPath.set(target.path, [...(byPath.get(target.path) ?? []), target]);
        }
        return byPath;
    }, [keys, prefix]);
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
    // The reader's own folding, over the default of folding the files they marked as viewed.
    const [folded, setFolded] = useState<ReadonlyMap<string, boolean>>(new Map());
    const viewed = useViewedFiles(route).data;
    const isCollapsed = (path: string) => folded.get(path) ?? viewed?.get(path) === "VIEWED";
    const fold = (paths: readonly string[], on: boolean | null) =>
        setFolded((current) => {
            const next = new Map(current);
            for (const path of paths) {
                if (on === null) next.delete(path);
                else next.set(path, on);
            }
            return next;
        });
    const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
    const headOid = diffHead(spec, pr.headRefOid);
    const { canWrite } = useWriteAccess(route);
    const queryClient = useQueryClient();
    const { github } = useDashboardState();
    const markViewed = usePrWrite(
        (client, args: { path: string; on: boolean }) => setFileViewed(client, pr.id, args.path, args.on),
        { reread: "viewed" },
    );
    const onViewed = canWrite
        ? (path: string, on: boolean) => {
              queryClient.setQueryData<Map<string, FileViewedState>>(
                  [...prQueryKey(github?.id, route), "viewed"],
                  (current) => new Map(current).set(path, on ? "VIEWED" : "UNVIEWED"),
              );
              // Marking a file viewed folds it, and unmarking unfolds it, as on GitHub.
              fold([path], null);
              markViewed.mutate({ path, on });
          }
        : null;
    const composers = useComposers(route);
    // New comments go on the PR's whole diff, whose lines are the ones GitHub places them on.
    const onComment =
        canWrite && spec.kind === "all"
            ? (target: CommentTarget) => {
                  const key = targetDraftKey(route, target);
                  if (drafts.read(key) === null) drafts.write(key, "");
              }
            : null;

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
        (file) => !isCollapsed(file.path) && (!isLargeDiff(file) || loaded.has(file.path)) && needsRawDiff(file),
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
            fold([file.path], false);
            document.getElementById(fileAnchor(file.path))?.scrollIntoView({ block: "start" });
        };
        const additions = files.reduce((sum, file) => sum + file.additions, 0);
        const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
        const someCollapsed = ordered.some((file) => isCollapsed(file.path));
        const viewedCount = viewed ? files.filter((file) => viewed.get(file.path) === "VIEWED").length : null;
        content = (
            <>
                <div className="files-toolbar">
                    <span className="files-summary">
                        {files.length} {files.length === 1 ? "file" : "files"} changed{" "}
                        <span className="diffstat-add">+{additions}</span>{" "}
                        <span className="diffstat-del">−{deletions}</span>
                    </span>
                    <div className="files-actions">
                        {viewedCount !== null && (
                            <span className="files-viewed">
                                {viewedCount} / {files.length} viewed
                            </span>
                        )}
                        <button
                            type="button"
                            className="step-btn"
                            onClick={() =>
                                fold(
                                    ordered.map((file) => file.path),
                                    !someCollapsed,
                                )
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
                                collapsed={isCollapsed(file.path)}
                                onToggle={() => fold([file.path], !isCollapsed(file.path))}
                                viewed={viewed?.get(file.path)}
                                onViewed={onViewed && ((on) => onViewed(file.path, on))}
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
                                composers={(onComment && composers.get(file.path)) || NO_COMPOSERS}
                                onComment={onComment}
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

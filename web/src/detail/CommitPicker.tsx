import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type DiffSpec, diffRangeParam, rangeOf, sinceReview } from "../logic/diff.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestCommits } from "./usePullRequest.ts";

const short = (sha: string) => sha.slice(0, 7);

function specLabel(spec: DiffSpec, since: DiffSpec | null): string {
    if (spec.kind === "all") return "All changes";
    if (spec.kind === "commit") return `Commit ${short(spec.sha)}`;
    if (since?.kind === "range" && since.from === spec.from && since.to === spec.to) {
        return "Changes since your last review";
    }
    return `Changes ${short(spec.from)}..${short(spec.to)}`;
}

/** Picks which changes the Files changed tab shows: all of them, one commit, a range, or since your last review. */
export function CommitPicker({ spec }: { spec: DiffSpec }) {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const commits = usePullRequestCommits(route).data?.commits ?? [];
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const oids = commits.map((commit) => commit.oid);
    const [first, setFirst] = useState(0);
    const [last, setLast] = useState<number | null>(null);
    const lastIndex = last ?? oids.length - 1;
    const since = sinceReview(pr.viewerLatestReview, pr.headRefOid);
    const upToDate = since?.kind === "range" && since.from === since.to;
    const close = () => setOpen(false);
    const files = "/$owner/$repo/pull/$number/files/$range" as const;

    return (
        <details className="commit-picker" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary className="step-btn">{specLabel(spec, since)} ▾</summary>
            <div className="commit-menu">
                <Link to="/$owner/$repo/pull/$number/files" params={route} onClick={close}>
                    All changes
                </Link>
                {since?.kind === "range" &&
                    (upToDate ? (
                        <span className="muted">No new changes since your last review</span>
                    ) : (
                        <Link to={files} params={{ ...route, range: diffRangeParam(since) }} onClick={close}>
                            Changes since your last review
                        </Link>
                    ))}
                {!!commits.length && <div className="commit-menu-heading">One commit</div>}
                {commits.map((commit) => (
                    <Link
                        key={commit.oid}
                        to={files}
                        params={{ ...route, range: commit.oid }}
                        className="commit-menu-commit"
                        onClick={close}
                    >
                        <span className="commit-headline">{commit.messageHeadline}</span>
                        <code>{commit.abbreviatedOid}</code>
                    </Link>
                ))}
                {commits.length > 1 && (
                    <form
                        className="commit-range"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const range = rangeOf(oids, first, lastIndex, pr.baseRefOid);
                            if (!range) return;
                            close();
                            void navigate({ to: files, params: { ...route, range: diffRangeParam(range) } });
                        }}
                    >
                        <div className="commit-menu-heading">A range of commits</div>
                        <label>
                            From
                            <select value={first} onChange={(event) => setFirst(Number(event.target.value))}>
                                {commits.map((commit, index) => (
                                    <option key={commit.oid} value={index}>
                                        {commit.abbreviatedOid} {commit.messageHeadline}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            To
                            <select value={lastIndex} onChange={(event) => setLast(Number(event.target.value))}>
                                {commits.map((commit, index) => (
                                    <option key={commit.oid} value={index}>
                                        {commit.abbreviatedOid} {commit.messageHeadline}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button type="submit" className="step-btn" disabled={first > lastIndex}>
                            Show these commits
                        </button>
                    </form>
                )}
            </div>
        </details>
    );
}

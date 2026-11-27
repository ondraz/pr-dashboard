import { External } from "../list/PrRows.tsx";
import { type CheckEntry, checkDuration, groupChecks } from "../logic/checks.ts";
import type { CheckGroup } from "../logic/mergeBox.ts";
import { Annotation } from "./Annotation.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestChecks } from "./usePullRequest.ts";

const GROUP = {
    failing: { heading: "Failing", tone: "fail", mark: "✕" },
    pending: { heading: "In progress", tone: "pending", mark: "●" },
    successful: { heading: "Successful", tone: "ok", mark: "✓" },
    skipped: { heading: "Skipped", tone: "neutral", mark: "–" },
} as const satisfies Record<CheckGroup, unknown>;

const ROLLUP_TITLE: Record<string, string> = {
    SUCCESS: "All checks have passed",
    PENDING: "Some checks haven't completed yet",
    EXPECTED: "Some checks haven't completed yet",
};

function CheckRow({ check }: { check: CheckEntry }) {
    const { tone, mark } = GROUP[check.group];
    const duration = checkDuration(check.startedAt, check.completedAt);
    const meta = [check.label, duration, check.source].filter(Boolean).join(" · ");
    const more = check.annotations.length > 0 || !!check.summary;
    const unread = check.annotationCount - check.annotations.length;
    return (
        <li className={`check-row tone-${tone}`}>
            <span className="merge-mark" aria-hidden="true">
                {mark}
            </span>
            <div className="check-main">
                <div className="check-line">
                    <span className="check-name">{check.name}</span>
                    {check.required && <span className="check-required">Required</span>}
                    <span className="check-meta">{meta}</span>
                </div>
                {check.title && <div className="check-title">{check.title}</div>}
                {more && (
                    <details className="check-details" open={check.group === "failing"}>
                        <summary>
                            {[
                                check.summary && "Summary",
                                check.annotationCount &&
                                    `${check.annotationCount} ${check.annotationCount === 1 ? "annotation" : "annotations"}`,
                            ]
                                .filter(Boolean)
                                .join(" and ")}
                        </summary>
                        {check.summary && <pre className="check-summary">{check.summary}</pre>}
                        {check.annotations.map((annotation) => (
                            <Annotation key={annotation.id} annotation={annotation} withPath />
                        ))}
                        {unread > 0 && <p className="muted">{unread} more on the check's own page.</p>}
                    </details>
                )}
            </div>
            {check.detailsUrl && (
                <External className="check-link" href={check.detailsUrl}>
                    {check.actionsJobId ? "Logs" : "Details"}
                </External>
            )}
        </li>
    );
}

/** The check runs and statuses on the PR's head commit, failing first, with their summaries, annotations and logs. */
export function ChecksTab() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const { data, error } = usePullRequestChecks(route, pr.headRefOid);
    if (error && !data) return <div className="error">{error.message}</div>;
    if (!data) {
        return (
            <div className="loading">
                <div className="spinner" />
                <div>Loading checks...</div>
            </div>
        );
    }
    const onGitHub = <External href={`${pr.url}/checks`}>View on GitHub</External>;
    if (!data.checks.length) {
        return <div className="empty">No checks ran on {pr.headRefOid.slice(0, 7)}.</div>;
    }
    const groups = groupChecks(data.checks);
    const counts = groups.map(({ group, checks }) => `${checks.length} ${group}`).join(", ");
    return (
        <div className="checks-tab">
            <div className="checks-summary">
                <h2>{ROLLUP_TITLE[data.state ?? ""] ?? "Some checks were not successful"}</h2>
                <span className="muted">
                    {counts} on <code className="sha">{pr.headRefOid.slice(0, 7)}</code> · {onGitHub}
                </span>
            </div>
            {!data.complete && (
                <div className="timeline-note">
                    Showing the first {data.checks.length} checks; the rest are on GitHub.
                </div>
            )}
            {groups.map(({ group, checks }) => (
                <section key={group} className="check-group" aria-label={GROUP[group].heading}>
                    <h3>
                        {GROUP[group].heading} <span className="tab-count">{checks.length}</span>
                    </h3>
                    <ul className="check-rows">
                        {checks.map((check) => (
                            <CheckRow key={check.id} check={check} />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

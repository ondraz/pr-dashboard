import type { ReactNode } from "react";
import type { ReviewedPr, WaitingPr } from "../github/dashboard.ts";
import { REVIEWED_BADGE_CLASS } from "../logic/badges.ts";
import { byRepo } from "../logic/filters.ts";
import { reviewedGroups, reviewHref } from "../logic/reviews.ts";
import { latestSession, type PrSessions } from "../sessions.ts";
import { useCollapse } from "./collapse.tsx";
import { ChevronIcon, RepoIcon } from "./icons.tsx";
import { External, ReviewedItem, WaitingItem } from "./PrRows.tsx";

function Section({
    collapseKey,
    heading,
    count,
    children,
}: {
    collapseKey: string;
    heading: ReactNode;
    count: number;
    children: ReactNode;
}) {
    const { collapsed, headerProps } = useCollapse(collapseKey);
    return (
        <div className={`repo-group${collapsed ? " collapsed" : ""}`}>
            <div className="repo-header collapse-header" {...headerProps}>
                <ChevronIcon />
                {heading}
                <span className="repo-pr-count">{count}</span>
            </div>
            {!collapsed && <div className="group-body">{children}</div>}
        </div>
    );
}

/** PRs waiting for the viewer's review, by repository. */
export function WaitingList({ prs, sessions, now }: { prs: WaitingPr[]; sessions: PrSessions; now: number }) {
    if (!prs.length) return <div className="empty">Nothing is waiting for your review.</div>;
    return byRepo(prs).map(([repo, list]) => (
        <Section
            key={repo}
            collapseKey={`review-repo:${repo}`}
            count={list.length}
            heading={
                <>
                    <RepoIcon />
                    <span className="repo-name">
                        <External href={`https://github.com/${repo}`}>{repo.split("/")[1]}</External>
                    </span>
                </>
            }
        >
            {list.map((pr) => (
                <WaitingItem
                    key={pr.number}
                    pr={pr}
                    session={latestSession(sessions, "reviewed", pr.html_url)}
                    now={now}
                />
            ))}
        </Section>
    ));
}

/** Open PRs the viewer reviewed, grouped by where that review stands. */
export function ReviewedList({ prs, sessions, now }: { prs: ReviewedPr[]; sessions: PrSessions; now: number }) {
    if (!prs.length) return <div className="empty">No open pull requests you have reviewed.</div>;
    return reviewedGroups(prs).map(({ status, prs: list }) => (
        <Section
            key={status.key}
            collapseKey={`reviewed:${status.key}`}
            count={list.length}
            heading={<span className="repo-name">{status.label}</span>}
        >
            {list.map((pr) => (
                <ReviewedItem
                    key={`${pr.repoFullName}#${pr.number}`}
                    pr={pr}
                    session={latestSession(sessions, "reviewed", pr.html_url)}
                    badge={{ href: reviewHref(pr), text: status.text, className: REVIEWED_BADGE_CLASS[status.key] }}
                    now={now}
                />
            ))}
        </Section>
    ));
}

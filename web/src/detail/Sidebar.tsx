import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { PrSession } from "../../../shared/sessions.ts";
import { PrDraftIcon, PrOpenIcon, SparkIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import { labelColor } from "../logic/labels.ts";
import { prRouteOf } from "../logic/prRoute.ts";
import { type ReviewerState, reviewers } from "../logic/reviewers.ts";
import { type SessionRole, sessionLink } from "../logic/sessionLinks.ts";
import type { StackNode } from "../logic/stacks.ts";
import { timeAgo } from "../logic/time.ts";
import { usePrListContext } from "./listContext.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestStack } from "./usePullRequest.ts";

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="sidebar-section" aria-label={title}>
            <h2>{title}</h2>
            {children}
        </section>
    );
}

const None = ({ text = "None" }: { text?: string }) => <p className="muted">{text}</p>;

const REVIEWER_STATE: Record<ReviewerState, { text: string; className: string }> = {
    REQUESTED: { text: "Awaiting review", className: "review-pending" },
    APPROVED: { text: "Approved", className: "review-approved" },
    CHANGES_REQUESTED: { text: "Changes requested", className: "review-changes" },
    COMMENTED: { text: "Commented", className: "review-pending" },
    DISMISSED: { text: "Dismissed", className: "review-pending" },
};

function Reviewers() {
    const { pr } = useOpenPr().detail;
    const list = reviewers(
        (pr.reviewRequests?.nodes ?? []).map((request) => request?.requestedReviewer),
        pr.latestReviews?.nodes ?? [],
    );
    return (
        <Section title="Reviewers">
            {list.length ? (
                <ul className="sidebar-list">
                    {list.map((reviewer) => {
                        const state = REVIEWER_STATE[reviewer.state];
                        return (
                            <li key={reviewer.name}>
                                <span className="who">
                                    {reviewer.avatarUrl && (
                                        <img
                                            className="avatar"
                                            src={reviewer.avatarUrl}
                                            alt=""
                                            width={20}
                                            height={20}
                                        />
                                    )}
                                    {reviewer.name}
                                </span>
                                <span className={`review-status ${state.className}`}>{state.text}</span>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <None text="No reviews" />
            )}
        </Section>
    );
}

function Assignees() {
    const assignees = (useOpenPr().detail.pr.assignees.nodes ?? []).filter((user) => !!user);
    return (
        <Section title="Assignees">
            {assignees.length ? (
                <ul className="sidebar-list">
                    {assignees.map((user) => (
                        <li key={user.login}>
                            <span className="who">
                                {user.avatarUrl && (
                                    <img className="avatar" src={user.avatarUrl} alt="" width={20} height={20} />
                                )}
                                <External href={user.url}>{user.login}</External>
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <None text="No one assigned" />
            )}
        </Section>
    );
}

function Labels() {
    const labels = (useOpenPr().detail.pr.labels?.nodes ?? []).filter((label) => !!label);
    return (
        <Section title="Labels">
            {labels.length ? (
                <div className="pr-labels sidebar-labels">
                    {labels.map((label) => (
                        <span
                            key={label.name}
                            className="pr-label"
                            style={{ background: labelColor(label.name), color: "var(--color-btn-text)" }}
                        >
                            {label.name}
                        </span>
                    ))}
                </div>
            ) : (
                <None />
            )}
        </Section>
    );
}

function LinkedIssues() {
    const { pr } = useOpenPr().detail;
    const repo = pr.url.split("/").slice(3, 5).join("/");
    const issues = (pr.closingIssuesReferences?.nodes ?? []).filter((issue) => !!issue);
    return (
        <Section title="Linked issues">
            {issues.length ? (
                <ul className="sidebar-list">
                    {issues.map((issue) => (
                        <li key={issue.url}>
                            <External href={issue.url}>
                                {issue.repository.nameWithOwner === repo ? "" : issue.repository.nameWithOwner}#
                                {issue.number} {issue.title}
                            </External>
                            {issue.state === "CLOSED" && <span className="thread-tag">Closed</span>}
                        </li>
                    ))}
                </ul>
            ) : (
                <None text="None that this PR closes" />
            )}
        </Section>
    );
}

function Milestone() {
    const { milestone } = useOpenPr().detail.pr;
    return (
        <Section title="Milestone">
            {milestone ? <External href={milestone.url}>{milestone.title}</External> : <None text="No milestone" />}
        </Section>
    );
}

function StackMember({ node, current }: { node: StackNode; current: boolean }) {
    const route = prRouteOf(node.html_url);
    const label = (
        <>
            <span className="stack-member-number">#{node.number}</span> {node.title}
        </>
    );
    return (
        <li className={`stack-member${current ? " current" : ""}`} aria-current={current ? "page" : undefined}>
            <span className={`pr-status ${node.draft ? "draft" : "open"}`}>
                {node.draft ? <PrDraftIcon /> : <PrOpenIcon />}
            </span>
            {current || !route ? (
                <span className="stack-member-title">{label}</span>
            ) : (
                <Link className="stack-member-title" to="/$owner/$repo/pull/$number" params={route}>
                    {label}
                </Link>
            )}
            {node.author && <span className="stack-member-author">{node.author}</span>}
        </li>
    );
}

function Stack() {
    const { route, detail } = useOpenPr();
    const { data, error } = usePullRequestStack(route);
    if (error) {
        return (
            <Section title="Stack">
                <None text="Could not read the stack" />
            </Section>
        );
    }
    if (!data?.length) return null;
    const stack = data[0]?.stack;
    return (
        <Section title={`Stack of ${data.length}`}>
            {stack?.name && (
                <p className={`stack-name${stack.name.declared ? "" : " stack-name-derived"}`}>{stack.name.text}</p>
            )}
            {/* Tip first, so the PR on the base branch sits at the bottom, as in the list. */}
            <ol className="stack-members">
                {data
                    .slice()
                    .reverse()
                    .map((node) => (
                        <StackMember key={node.number} node={node} current={node.number === detail.pr.number} />
                    ))}
            </ol>
            {stack?.rootBaseRef && <p className="stack-onto">onto {stack.rootBaseRef}</p>}
        </Section>
    );
}

function SessionRow({ session, role }: { session: PrSession; role: SessionRole }) {
    const link = sessionLink(session, role);
    if (!link) return null;
    return (
        <li className={link.archived ? "archived" : undefined}>
            <a className="session-badge" href={link.href} title={link.title}>
                <SparkIcon />
                {link.app}
            </a>
            <span className="session-title">{session.title || "Untitled session"}</span>
            <span className="session-meta">
                {role} · {timeAgo(session.lastActivityAt)}
                {session.archived ? " · archived" : ""}
            </span>
        </li>
    );
}

/** Every Claude session that made or reviewed the PR, the most recently active first. */
function Sessions() {
    const { pr } = useOpenPr().detail;
    const { made, reviewed } = usePrListContext(pr.url);
    const rows = [
        ...made.map((session) => ({ session, role: "made" as const })),
        ...reviewed.map((session) => ({ session, role: "reviewed" as const })),
    ].sort((a, b) => b.session.lastActivityAt - a.session.lastActivityAt);
    return (
        <Section title="Sessions">
            {rows.length ? (
                <ul className="sidebar-list session-list">
                    {rows.map(({ session, role }) => (
                        <SessionRow key={`${role}:${session.id}`} session={session} role={role} />
                    ))}
                </ul>
            ) : (
                <None text="No Claude session made or reviewed this PR" />
            )}
        </Section>
    );
}

export function Sidebar() {
    return (
        <aside className="pr-sidebar">
            <Reviewers />
            <Assignees />
            <Labels />
            <LinkedIssues />
            <Milestone />
            <Stack />
            <Sessions />
        </aside>
    );
}

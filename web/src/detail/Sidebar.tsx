import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import type { PrSession } from "../../../shared/sessions.ts";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { useWriteAccess } from "../app/writeAccess.tsx";
import { loadAssignableUsers, type PickOption, removeReviewRequest } from "../github/manage.ts";
import { dismissReview, requestReview } from "../github/review.ts";
import { PrDraftIcon, PrOpenIcon, SparkIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import { CHECK_GROUP, type CheckEntry, groupChecks } from "../logic/checks.ts";
import { commentExcerpt, conversationAnchor, openThreads, threadLines } from "../logic/conversation.ts";
import { type PrRoute, prRouteOf } from "../logic/prRoute.ts";
import { canDismiss, canReRequest, type Reviewer, type ReviewerState, reviewers } from "../logic/reviewers.ts";
import { type SessionRole, sessionLink } from "../logic/sessionLinks.ts";
import type { StackNode } from "../logic/stacks.ts";
import { timeAgo } from "../logic/time.ts";
import { prUnresolvedSummary } from "../logic/unresolved.ts";
import { usePrListContext } from "./listContext.ts";
import { Picker } from "./Picker.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestChecks, usePullRequestStack } from "./usePullRequest.ts";
import { usePrWrite } from "./useWrite.ts";

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="sidebar-section" aria-label={title}>
            <div className="sidebar-heading">
                <h2>{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

/** The Edit button of a section the reader can change, and the picker it opens. */
function useEditing(kind: string, allowed: boolean) {
    const [editing, setEditing] = useState(false);
    const button = allowed ? (
        <button
            type="button"
            className="link-btn sidebar-edit"
            aria-label={`Edit ${kind}`}
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
        >
            Edit
        </button>
    ) : null;
    return { editing: allowed && editing, close: () => setEditing(false), button };
}

const None = ({ text = "None" }: { text?: string }) => <p className="muted">{text}</p>;

/**
 * Shows a thread or review in the Conversation tab, going there first from another tab: opened,
 * scrolled to the middle and focused, as a click in GitHub's or Codex's list of comments does.
 */
function useRevealInConversation(route: PrRoute) {
    const navigate = useNavigate();
    const matchRoute = useMatchRoute();
    return (nodeId: string) => {
        const show = () => {
            const target = document.getElementById(conversationAnchor(nodeId));
            if (!target) return false;
            if (target instanceof HTMLDetailsElement) target.open = true;
            target.scrollIntoView({ block: "center" });
            target.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
            target.classList.remove("revealed");
            void target.offsetWidth;
            target.classList.add("revealed");
            return true;
        };
        if (matchRoute({ to: "/$owner/$repo/pull/$number", params: route }) && show()) return;
        void navigate({ to: "/$owner/$repo/pull/$number", params: route }).then(() => {
            // The tab renders after the navigation settles; give it a few frames.
            let tries = 0;
            const retry = () => {
                if (!show() && ++tries < 40) setTimeout(retry, 25);
            };
            retry();
        });
    };
}

/** Every thread still open and Copilot's standing verdict, each a click away from where it sits. */
function UnresolvedComments() {
    const { route, detail } = useOpenPr();
    const { pr, threads } = detail;
    const open = useMemo(() => openThreads(threads), [threads]);
    const verdict = useMemo(
        () => prUnresolvedSummary(threads, pr.reviews?.nodes ?? []).copilotVerdict,
        [threads, pr.reviews],
    );
    const reveal = useRevealInConversation(route);
    const count = open.length + (verdict ? 1 : 0);
    return (
        <Section title="Unresolved comments" action={count ? <span className="tab-count">{count}</span> : undefined}>
            {count ? (
                <ul className="sidebar-list unresolved-list">
                    {verdict && (
                        <li>
                            <button type="button" className="unresolved-item" onClick={() => reveal(verdict.id)}>
                                <span className="unresolved-where">Copilot's review</span>
                                <span className="unresolved-text">{verdict.label}</span>
                            </button>
                        </li>
                    )}
                    {open.map((thread) => {
                        const comments = (thread.comments.nodes ?? []).filter((comment) => !!comment);
                        const first = comments[0];
                        const replies = thread.comments.totalCount - 1;
                        return (
                            <li key={thread.id}>
                                <button type="button" className="unresolved-item" onClick={() => reveal(thread.id)}>
                                    <span className="unresolved-where">
                                        <code title={thread.path}>
                                            {thread.path.split("/").at(-1)}
                                            {threadLines(thread)}
                                        </code>
                                        {thread.isOutdated && <span className="thread-tag">Outdated</span>}
                                    </span>
                                    <span className="unresolved-text">
                                        {first?.author?.avatarUrl && (
                                            <img
                                                className="avatar"
                                                src={first.author.avatarUrl}
                                                alt=""
                                                width={16}
                                                height={16}
                                            />
                                        )}
                                        <span className="who">{first?.author?.login ?? "ghost"}</span>{" "}
                                        {commentExcerpt(first?.body ?? "")}
                                    </span>
                                    {replies > 0 && (
                                        <span className="muted unresolved-replies">
                                            {replies} {replies === 1 ? "reply" : "replies"}
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <None text="Nothing is unresolved" />
            )}
        </Section>
    );
}

function CheckItem({ check }: { check: CheckEntry }) {
    const { tone, mark } = CHECK_GROUP[check.group];
    return (
        <li className={`sidebar-check tone-${tone}`} title={`${check.name}: ${check.label}`}>
            <span className="merge-mark" aria-hidden="true">
                {mark}
            </span>
            <span className="sidebar-check-name">
                {check.detailsUrl ? <External href={check.detailsUrl}>{check.name}</External> : check.name}
            </span>
            <span className="muted sidebar-check-state">{check.label}</span>
        </li>
    );
}

// Past this many, the checks that need nothing from anyone fold away under their count.
const SHOWN_CHECKS = 8;

/** The head commit's checks, failing and running ones first, each with where it stands. */
function Checks() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const { data, error } = usePullRequestChecks(route, pr.headRefOid);
    const all = (
        <Link to="/$owner/$repo/pull/$number/checks" params={route} className="link-btn sidebar-edit">
            All checks
        </Link>
    );
    let body: ReactNode;
    if (error && !data) {
        body = /not accessible/i.test(error.message) ? (
            <p className="muted">
                This sign-in cannot read checks. A token needs Checks and Commit statuses read access; the GitHub App
                has both.
            </p>
        ) : (
            <p className="error-text">The checks could not be read: {error.message}</p>
        );
    } else if (!data) body = <None text="Loading checks…" />;
    else if (!data.checks.length) body = <None text={`No checks ran on ${pr.headRefOid.slice(0, 7)}`} />;
    else {
        const groups = groupChecks(data.checks);
        const fold = data.checks.length > SHOWN_CHECKS;
        const loud = groups.filter(({ group }) => !fold || group === "failing" || group === "pending");
        const quiet = fold ? groups.filter(({ group }) => group === "successful" || group === "skipped") : [];
        const quietCount = quiet.reduce((sum, { checks }) => sum + checks.length, 0);
        body = (
            <>
                <p className="muted sidebar-check-counts">
                    {groups.map(({ group, checks }) => `${checks.length} ${group}`).join(", ")}
                </p>
                <ul className="sidebar-list sidebar-checks">
                    {loud.flatMap(({ checks }) => checks.map((check) => <CheckItem key={check.id} check={check} />))}
                </ul>
                {quietCount > 0 && (
                    <details className="sidebar-checks-more">
                        <summary>{quiet.map(({ group, checks }) => `${checks.length} ${group}`).join(", ")}</summary>
                        <ul className="sidebar-list sidebar-checks">
                            {quiet.flatMap(({ checks }) =>
                                checks.map((check) => <CheckItem key={check.id} check={check} />),
                            )}
                        </ul>
                    </details>
                )}
                {!data.complete && <p className="muted">More checks ran than were read.</p>}
            </>
        );
    }
    return (
        <Section title="Checks" action={all}>
            {body}
        </Section>
    );
}

const REVIEWER_STATE: Record<ReviewerState, { text: string; className: string }> = {
    REQUESTED: { text: "Awaiting review", className: "review-pending" },
    APPROVED: { text: "Approved", className: "review-approved" },
    CHANGES_REQUESTED: { text: "Changes requested", className: "review-changes" },
    COMMENTED: { text: "Commented", className: "review-pending" },
    DISMISSED: { text: "Dismissed", className: "review-pending" },
};

function ReviewerActions({ reviewer }: { reviewer: Reviewer }) {
    const { route, detail } = useOpenPr();
    const { github } = useDashboardState();
    const { canWrite } = useWriteAccess(route);
    const [dismissing, setDismissing] = useState(false);
    const [message, setMessage] = useState("");
    const ask = usePrWrite((client) => requestReview(client, route, reviewer.name));
    const dismiss = usePrWrite((client, text: string) => dismissReview(client, reviewer.reviewId ?? "", text));
    const withdraw = usePrWrite((client) =>
        removeReviewRequest(client, route, { teamSlug: reviewer.name.split("/").at(-1) ?? reviewer.name }),
    );
    if (!canWrite || detail.pr.state !== "OPEN") return null;
    const reRequest = canReRequest(reviewer, github?.login ?? null, detail.pr.author?.login ?? null);
    const error = ask.error ?? dismiss.error ?? withdraw.error;
    return (
        <>
            {reviewer.team && reviewer.state === "REQUESTED" && (
                <button
                    type="button"
                    className="link-btn reviewer-action"
                    title={`Withdraw the request for ${reviewer.name}'s review`}
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(undefined)}
                >
                    Remove
                </button>
            )}
            {reRequest && (
                <button
                    type="button"
                    className="link-btn reviewer-action"
                    title={`Ask ${reviewer.name} for another review`}
                    disabled={ask.isPending}
                    onClick={() => ask.mutate(undefined)}
                >
                    Re-request
                </button>
            )}
            {canDismiss(reviewer) && !dismissing && (
                <button
                    type="button"
                    className="link-btn reviewer-action"
                    title={`Dismiss ${reviewer.name}'s review`}
                    onClick={() => setDismissing(true)}
                >
                    Dismiss
                </button>
            )}
            {dismissing && (
                <form
                    className="dismiss-form"
                    aria-label={`Dismiss ${reviewer.name}'s review`}
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (message.trim() && !dismiss.isPending) {
                            dismiss.mutate(message, { onSuccess: () => setDismissing(false) });
                        }
                    }}
                >
                    <input
                        aria-label="Why the review is dismissed"
                        placeholder="Why dismiss it?"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                    />
                    <button type="button" className="step-btn" onClick={() => setDismissing(false)}>
                        Cancel
                    </button>
                    <button type="submit" className="danger-btn" disabled={!message.trim() || dismiss.isPending}>
                        Dismiss review
                    </button>
                </form>
            )}
            {error && <span className="error-text">{error.message}</span>}
        </>
    );
}

function Reviewers() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const { canWrite } = useWriteAccess(route);
    const requested = (pr.reviewRequests?.nodes ?? []).map((request) => request?.requestedReviewer);
    const list = reviewers(requested, pr.latestReviews?.nodes ?? []);
    const { editing, close, button } = useEditing("reviewers", canWrite && pr.state === "OPEN");
    const toggle = usePrWrite((client, { option, on }: { option: PickOption; on: boolean }) =>
        on ? requestReview(client, route, option.name) : removeReviewRequest(client, route, { login: option.name }),
    );
    const current = requested.flatMap((reviewer) =>
        reviewer && "login" in reviewer
            ? [{ id: `user:${reviewer.login}`, name: reviewer.login, avatarUrl: null }]
            : [],
    );
    return (
        <Section title="Reviewers" action={button}>
            {editing && (
                <Picker
                    kind="reviewers"
                    current={current}
                    load={(client, query) => loadAssignableUsers(client, route, query)}
                    exclude={pr.author ? [pr.author.login] : []}
                    busy={toggle.isPending}
                    onToggle={(option, on) => toggle.mutate({ option, on })}
                    onClose={close}
                />
            )}
            {toggle.error && <p className="error-text">{toggle.error.message}</p>}
            {list.length ? (
                <ul className="sidebar-list">
                    {list.map((reviewer) => {
                        const state = REVIEWER_STATE[reviewer.state];
                        return (
                            <li key={reviewer.name} className="reviewer">
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
                                <ReviewerActions reviewer={reviewer} />
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
            <UnresolvedComments />
            <Checks />
            <Reviewers />
            <LinkedIssues />
            <Stack />
            <Sessions />
        </aside>
    );
}

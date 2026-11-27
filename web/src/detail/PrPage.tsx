import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useMatchRoute, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useAuth } from "../app/AuthProvider.tsx";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { useBackToList } from "../app/listReturn.tsx";
import { SignIn } from "../app/SignIn.tsx";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { PullRequestDetail } from "../github/pullRequest.ts";
import { ArrowLeftIcon, RepoIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import { checkGroup } from "../logic/mergeBox.ts";
import { githubPrUrl, type PrRoute } from "../logic/prRoute.ts";
import { timeAgo } from "../logic/time.ts";
import { AgentButtons, AgentPanel, type AgentTask } from "./AgentPanel.tsx";
import { PrContext } from "./PrContext.tsx";
import { PrHeader } from "./PrHeader.tsx";
import { PrSteps } from "./PrSteps.tsx";
import { ReviewButton, ReviewPanel } from "./ReviewPanel.tsx";
import { ShortcutsHelp } from "./ShortcutsHelp.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { SuggestionBatch } from "./Suggestions.tsx";
import { useLastOpened } from "./useLastOpened.ts";
import { prQueryKey, usePullRequest, usePullRequestLiveCheck } from "./usePullRequest.ts";

function BackButton() {
    const back = useBackToList();
    return (
        <Link
            to="/"
            className="back-btn"
            onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                back();
            }}
        >
            <ArrowLeftIcon />
            Pull requests
        </Link>
    );
}

function Tabs({ route, detail, actions }: { route: PrRoute; detail: PullRequestDetail; actions: ReactNode }) {
    const { pr } = detail;
    const tab = { className: "tab-btn", activeProps: { "aria-current": "page" as const } };
    return (
        <nav className="tab-bar pr-tabs" aria-label="Pull request">
            <Link {...tab} to="/$owner/$repo/pull/$number" params={route} activeOptions={{ exact: true }}>
                Conversation
            </Link>
            <Link {...tab} to="/$owner/$repo/pull/$number/commits" params={route}>
                Commits <span className="tab-count">{pr.commits.totalCount}</span>
            </Link>
            <Link {...tab} to="/$owner/$repo/pull/$number/checks" params={route}>
                Checks <ChecksCount detail={detail} />
            </Link>
            <Link {...tab} to="/$owner/$repo/pull/$number/files" params={route}>
                Files changed <span className="tab-count">{pr.changedFiles}</span>
            </Link>
            {actions && <div className="pr-tab-actions">{actions}</div>}
        </nav>
    );
}

/** How many checks ran on the head commit, marked when any of them failed or is still running. */
function ChecksCount({ detail }: { detail: PullRequestDetail }) {
    const rollup = detail.pr.headCommit.nodes?.[0]?.commit.statusCheckRollup;
    if (!rollup) return null;
    const counts = [
        ...(rollup.contexts.checkRunCountsByState ?? []),
        ...(rollup.contexts.statusContextCountsByState ?? []),
    ];
    const total = counts.reduce((sum, { count }) => sum + count, 0);
    const group = checkGroup(rollup.state);
    return (
        <span className={`tab-count${group === "failing" ? " failing" : group === "pending" ? " pending" : ""}`}>
            {total}
        </span>
    );
}

/** Why the page offers no review actions, when it does not. */
function WriteNote({ route }: { route: PrRoute }) {
    const { reason } = useWriteAccess(route);
    if (reason?.kind === "refused") {
        return (
            <div className="timeline-note write-note">
                GitHub refused a change in {route.owner}/{route.repo} ({reason.message}), so the review actions are
                hidden here. The GitHub App may not be installed on this repository, or lack a permission it needs.
            </div>
        );
    }
    return null;
}

/** One PR, at the same path as on GitHub: its header, tabs, the open tab and the sidebar. */
export function PrPage() {
    const { owner, repo, number } = useParams({ from: "/$owner/$repo/pull/$number" });
    const route = useMemo(() => ({ owner, repo, number }), [owner, repo, number]);
    const auth = useAuth();
    const { github } = useDashboardState();
    const queryClient = useQueryClient();
    const query = usePullRequest(route);
    const { data, error, isFetching } = query;
    const { canWrite, reason } = useWriteAccess(route);
    const [reviewing, setReviewing] = useState(false);
    const [agent, setAgent] = useState<AgentTask | null>(null);
    usePullRequestLiveCheck(route, data, isFetching);
    const lastOpened = useLastOpened(route, data?.pr.headRefOid, query.dataUpdatedAt);
    const open = useMemo(() => (data ? { route, detail: data, lastOpened } : null), [route, data, lastOpened]);
    // The diff takes the whole width, as on GitHub.
    const matchRoute = useMatchRoute();
    const wide =
        !!matchRoute({ to: "/$owner/$repo/pull/$number/files", fuzzy: true }) ||
        !!matchRoute({ to: "/$owner/$repo/pull/$number/commits/$sha" });
    // The commits and the stack are read again with the PR.
    const refresh = () => void queryClient.invalidateQueries({ queryKey: prQueryKey(github?.id, route) });

    let content: ReactNode;
    if (!auth.ready) {
        content = (
            <div className="loading">
                <div className="spinner" />
                <div>Checking sign-in...</div>
            </div>
        );
    } else if (!auth.credentials) {
        content = (
            <>
                <div className="empty">Sign in to open this pull request.</div>
                <SignIn onSaveToken={auth.saveToken} />
            </>
        );
    } else if (error && !data) {
        content = <div className="error">{error.message}</div>;
    } else if (!open) {
        content = (
            <div className="loading">
                <div className="spinner" />
                <div>Loading pull request...</div>
            </div>
        );
    } else {
        // A review started on a PR since closed can still be finished or discarded.
        const reviewable = open.detail.pr.state === "OPEN" || !!open.detail.pr.pendingReview?.nodes?.length;
        content = (
            <PrContext value={open}>
                {error && <div className="error">Refresh failed: {error.message}</div>}
                <PrHeader />
                <WriteNote route={route} />
                <Tabs
                    route={route}
                    detail={open.detail}
                    actions={
                        <>
                            {open.detail.pr.state === "OPEN" && <AgentButtons open={agent} onOpen={setAgent} />}
                            {canWrite && reviewable ? (
                                <ReviewButton open={reviewing} onToggle={() => setReviewing(!reviewing)} />
                            ) : reason?.kind === "token" ? (
                                <span
                                    className="muted read-only-note"
                                    title="Sign in with the GitHub App to review here"
                                >
                                    Read-only token
                                </span>
                            ) : null}
                        </>
                    }
                />
                {agent && open.detail.pr.state === "OPEN" && (
                    <AgentPanel key={agent} task={agent} onClose={() => setAgent(null)} />
                )}
                {reviewing && canWrite && <ReviewPanel onDone={() => setReviewing(false)} />}
                <SuggestionBatch />
                {wide ? (
                    <Outlet />
                ) : (
                    <div className="detail-body">
                        <div className="detail-main">
                            <Outlet />
                        </div>
                        <Sidebar />
                    </div>
                )}
            </PrContext>
        );
    }

    return (
        <>
            <div className={`progress-bar${isFetching ? " active" : ""}`} aria-hidden="true" />
            <div className="header">
                <div className="detail-nav">
                    <BackButton />
                    <PrSteps url={githubPrUrl(route)} />
                    <ShortcutsHelp />
                    <span className="detail-repo">
                        <RepoIcon />
                        <External href={`https://github.com/${owner}/${repo}`}>
                            {owner}/{repo}
                        </External>
                    </span>
                </div>
                <div className="header-right">
                    <span className={`last-updated${isFetching ? " refreshing" : ""}`}>
                        {isFetching
                            ? "Refreshing…"
                            : query.dataUpdatedAt
                              ? `Updated ${timeAgo(query.dataUpdatedAt)}`
                              : ""}
                    </span>
                    <button
                        type="button"
                        className={`refresh-btn${isFetching ? " is-refreshing" : ""}`}
                        disabled={isFetching || !auth.credentials}
                        onClick={refresh}
                    >
                        <span className="btn-spinner" />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>
            <div className={`container detail-container${wide ? " wide" : ""}`}>{content}</div>
        </>
    );
}

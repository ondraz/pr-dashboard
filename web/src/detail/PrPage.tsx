import { Link, Outlet, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useAuth } from "../app/AuthProvider.tsx";
import { useBackToList } from "../app/listReturn.tsx";
import { SignIn } from "../app/SignIn.tsx";
import type { PullRequestDetail } from "../github/pullRequest.ts";
import { ArrowLeftIcon, RepoIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import type { PrRoute } from "../logic/prRoute.ts";
import { timeAgo } from "../logic/time.ts";
import { PrContext } from "./PrContext.tsx";
import { PrHeader } from "./PrHeader.tsx";
import { usePullRequest } from "./usePullRequest.ts";

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

function Tabs({ route, detail }: { route: PrRoute; detail: PullRequestDetail }) {
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
            <External className="tab-btn" href={`${pr.url}/checks`} title="Opens on GitHub">
                Checks ↗
            </External>
            <External className="tab-btn" href={`${pr.url}/files`} title="Opens on GitHub">
                Files changed <span className="tab-count">{pr.changedFiles}</span> ↗
            </External>
        </nav>
    );
}

/** One PR, at the same path as on GitHub: its header, tabs and the open tab. */
export function PrPage() {
    const { owner, repo, number } = useParams({ from: "/$owner/$repo/pull/$number" });
    const route = useMemo(() => ({ owner, repo, number }), [owner, repo, number]);
    const auth = useAuth();
    const query = usePullRequest(route);
    const { data, error, isFetching } = query;
    const open = useMemo(() => (data ? { route, detail: data } : null), [route, data]);

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
        content = (
            <PrContext value={open}>
                {error && <div className="error">Refresh failed: {error.message}</div>}
                <PrHeader />
                <Tabs route={route} detail={open.detail} />
                <Outlet />
            </PrContext>
        );
    }

    return (
        <>
            <div className={`progress-bar${isFetching ? " active" : ""}`} aria-hidden="true" />
            <div className="header">
                <div className="detail-nav">
                    <BackButton />
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
                        onClick={() => void query.refetch()}
                    >
                        <span className="btn-spinner" />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>
            <div className="container detail-container">{content}</div>
        </>
    );
}

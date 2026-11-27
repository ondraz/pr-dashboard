import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuth } from "../app/AuthProvider.tsx";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { useRememberListEntry } from "../app/listReturn.tsx";
import { SignIn } from "../app/SignIn.tsx";
import type { DashboardView } from "../app/useDashboard.ts";
import { type AgeFilter, applyFilters, type StatusFilter } from "../logic/filters.ts";
import { featureId, listLayout } from "../logic/layout.ts";
import { REFRESH_MODES, type RefreshMode } from "../logic/refresh.ts";
import { TABS, type Tab } from "../logic/tabs.ts";
import { timeAgo } from "../logic/time.ts";
import { useSetCollapsed } from "./collapse.tsx";
import { type Grouping, useListView } from "./listView.ts";
import { MineList } from "./MineList.tsx";
import { ReviewedList, WaitingList } from "./ReviewLists.tsx";

const TAB_LABELS: Record<Tab, string> = {
    mine: "My PRs",
    reviews: "Waiting for my review",
    reviewed: "Reviewed by me",
};

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: "Ready" },
    { value: "draft", label: "Draft" },
];
const AGE_FILTERS: readonly { value: AgeFilter; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "all", label: "All time" },
];
const GROUPINGS: readonly { value: Grouping; label: string }[] = [
    { value: "repo", label: "By repo" },
    { value: "feature", label: "By feature" },
];

/** Re-renders every `ms`, so relative times such as "Updated 3m ago" stay current. */
function useTick(ms: number): void {
    const [, tick] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        const timer = setInterval(tick, ms);
        return () => clearInterval(timer);
    }, [ms]);
}

function TabBar({
    tab,
    counts,
    onSelect,
}: {
    tab: Tab;
    counts: Record<Tab, number> | null;
    onSelect: (tab: Tab) => void;
}) {
    const buttons = useRef(new Map<Tab, HTMLButtonElement>());
    // Arrow keys move between tabs, as in any tablist.
    const onKeyDown = (event: KeyboardEvent) => {
        const i = TABS.indexOf(tab);
        const next =
            event.key === "ArrowRight"
                ? TABS[(i + 1) % TABS.length]
                : event.key === "ArrowLeft"
                  ? TABS[(i - 1 + TABS.length) % TABS.length]
                  : event.key === "Home"
                    ? TABS[0]
                    : event.key === "End"
                      ? TABS.at(-1)
                      : undefined;
        if (!next) return;
        event.preventDefault();
        onSelect(next);
        buttons.current.get(next)?.focus();
    };
    return (
        <div className="tab-bar" role="tablist" aria-label="Pull request lists" tabIndex={-1} onKeyDown={onKeyDown}>
            {TABS.map((name) => (
                <button
                    key={name}
                    ref={(element) => {
                        if (element) buttons.current.set(name, element);
                        else buttons.current.delete(name);
                    }}
                    type="button"
                    className="tab-btn"
                    role="tab"
                    id={`tab-${name}`}
                    aria-controls="content"
                    aria-selected={tab === name}
                    tabIndex={tab === name ? 0 : -1}
                    onClick={() => onSelect(name)}
                >
                    {TAB_LABELS[name]} <span className="tab-count">{counts ? counts[name] : "-"}</span>
                </button>
            ))}
        </div>
    );
}

function Choices<T extends string>({
    choices,
    value,
    onChange,
}: {
    choices: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    return choices.map((choice) => (
        <button
            key={choice.value}
            type="button"
            className={`filter-btn${choice.value === value ? " active" : ""}`}
            aria-pressed={choice.value === value}
            onClick={() => onChange(choice.value)}
        >
            {choice.label}
        </button>
    ));
}

function RefreshModes({ mode, onChange }: { mode: RefreshMode; onChange: (mode: RefreshMode) => void }) {
    return (
        <div className="interval-bar">
            {REFRESH_MODES.map((choice) => (
                <button
                    key={choice.mode}
                    type="button"
                    className={`interval-btn${choice.mode === mode ? " active" : ""}`}
                    aria-pressed={choice.mode === mode}
                    title={choice.title}
                    onClick={() => onChange(choice.mode)}
                >
                    {choice.label}
                </button>
            ))}
        </div>
    );
}

function TabContent({
    data,
    tab,
    status,
    age,
    grouping,
    onShowFeature,
}: {
    data: DashboardView;
    tab: Tab;
    status: StatusFilter;
    age: AgeFilter;
    grouping: Grouping;
    onShowFeature: (key: string) => void;
}) {
    const now = Date.now();
    const filters = { status, age };
    if (tab === "reviews") {
        return <WaitingList prs={applyFilters(data.waiting, filters, now)} sessions={data.sessions} now={now} />;
    }
    if (tab === "reviewed") {
        return <ReviewedList prs={applyFilters(data.reviewed, filters, now)} sessions={data.sessions} now={now} />;
    }
    const layout = listLayout(applyFilters(data.mine, filters, now), data.repoNodes, grouping);
    return (
        <MineList
            layout={layout}
            grouping={grouping}
            sessions={data.sessions}
            now={now}
            onShowFeature={onShowFeature}
        />
    );
}

/** The list of open PRs: the viewer's own, the ones waiting for their review, and the ones they reviewed. */
export function ListPage() {
    const queryClient = useQueryClient();
    const setCollapsed = useSetCollapsed();
    const auth = useAuth();
    const { credentials } = auth;
    const { tab, setTab, status, setStatus, age, setAge, grouping, setGrouping } = useListView();
    const [scrollTo, setScrollTo] = useState<string | null>(null);
    const dashboard = useDashboardState();
    useRememberListEntry();
    const { data, error, isFetching, mode, setMode } = dashboard;
    useTick(30_000);

    const counts = useMemo(() => {
        if (!data) return null;
        const filters = { status, age };
        return {
            mine: applyFilters(data.mine, filters).length,
            reviews: applyFilters(data.waiting, filters).length,
            reviewed: applyFilters(data.reviewed, filters).length,
        };
    }, [data, status, age]);

    useEffect(() => {
        if (!scrollTo) return;
        document.getElementById(featureId(scrollTo))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        setScrollTo(null);
    }, [scrollTo]);

    // Following a cross-repo badge: switch to the grouped view and jump to that group, opened.
    const showFeature = (key: string) => {
        setGrouping("feature");
        setCollapsed(`feature:${key}`, false);
        setScrollTo(key);
    };

    const save = (next: string, remember: boolean) => {
        if (credentials?.kind === "token" && credentials.token === next) dashboard.refresh();
        auth.saveToken(next, remember);
    };

    const signOut = async () => {
        if (credentials?.kind === "app") await auth.signOut();
        else auth.clearToken();
        queryClient.removeQueries({ queryKey: ["dashboard"] });
        queryClient.removeQueries({ queryKey: ["pr"] });
    };

    const signedIn = !!credentials;
    const showList = signedIn && !error;
    // Signed in through the app, a failed load is not fixed by pasting a token.
    const showSignIn = auth.ready && !showList && credentials?.kind !== "app";
    const statusLine = isFetching
        ? (dashboard.progress ?? "Refreshing…")
        : dashboard.updatedAt && signedIn
          ? `Updated ${timeAgo(dashboard.updatedAt)}`
          : "";
    // Only the start and the end are announced; the per-phase counters would make the live region noise.
    const announcement = isFetching
        ? "Refreshing pull requests"
        : error
          ? `Refresh failed: ${error.message}`
          : data && signedIn
            ? `Pull requests updated: ${data.mine.length}`
            : "";

    let content: ReactNode;
    if (!auth.ready) {
        content = (
            <div className="loading">
                <div className="spinner" />
                <div>Checking sign-in...</div>
            </div>
        );
    } else if (!credentials) {
        content = (
            <div className="empty">
                {auth.appConfigured
                    ? "Sign in with GitHub, or enter a token, to load your open PRs."
                    : "Enter a GitHub token to load your open PRs."}
            </div>
        );
    } else if (error) content = <div className="error">{error.message}</div>;
    else if (!data) {
        content = (
            <div className="loading">
                <div className="spinner" />
                <div>Loading pull requests...</div>
            </div>
        );
    } else {
        content = (
            <TabContent
                data={data}
                tab={tab}
                status={status}
                age={age}
                grouping={grouping}
                onShowFeature={showFeature}
            />
        );
    }

    return (
        <>
            <div className={`progress-bar${isFetching ? " active" : ""}`} aria-hidden="true" />
            <div className="header">
                <h1>Pull Requests</h1>
                <div className="header-right">
                    <span className={`last-updated${isFetching ? " refreshing" : ""}`}>{statusLine}</span>
                    <span className="sr-only" role="status" aria-live="polite">
                        {announcement}
                    </span>
                    <RefreshModes mode={mode} onChange={setMode} />
                    <span className="pr-count" title="Your open pull requests">
                        {data && signedIn ? data.mine.length : "-"}
                    </span>
                    <button
                        type="button"
                        className={`refresh-btn${isFetching ? " is-refreshing" : ""}`}
                        disabled={isFetching || !signedIn}
                        onClick={dashboard.refresh}
                    >
                        <span className="btn-spinner" />
                        <span>Refresh</span>
                    </button>
                    {credentials && (
                        <button
                            type="button"
                            className="refresh-btn"
                            onClick={() =>
                                signOut().catch((failure: unknown) => console.error("Sign-out failed", failure))
                            }
                        >
                            {credentials.kind === "app" ? "Sign out" : "Clear token"}
                        </button>
                    )}
                </div>
            </div>

            <div className="container">
                {showSignIn && <SignIn onSaveToken={save} />}
                {showList && (
                    <>
                        <TabBar tab={tab} counts={counts} onSelect={setTab} />
                        <div className="filter-bar">
                            <Choices choices={STATUS_FILTERS} value={status} onChange={setStatus} />
                            <span className="filter-sep">|</span>
                            <Choices choices={AGE_FILTERS} value={age} onChange={setAge} />
                            {tab === "mine" && (
                                <span className="grouping-controls">
                                    <span className="filter-sep">|</span>
                                    <Choices choices={GROUPINGS} value={grouping} onChange={setGrouping} />
                                </span>
                            )}
                        </div>
                    </>
                )}
                {showList ? (
                    <div
                        id="content"
                        className={`content${isFetching && data ? " refreshing" : ""}`}
                        role="tabpanel"
                        aria-labelledby={`tab-${tab}`}
                        aria-busy={isFetching}
                    >
                        {content}
                    </div>
                ) : (
                    <div className="content">{content}</div>
                )}
            </div>
        </>
    );
}

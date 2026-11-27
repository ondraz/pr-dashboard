import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { useLiveTicks } from "../app/useLiveTicks.ts";
import {
    loadPullRequest,
    loadPullRequestCommits,
    loadViewedFiles,
    type PullRequestDetail,
    readPullRequestFingerprint,
} from "../github/pullRequest.ts";
import { loadStack } from "../github/stack.ts";
import { prFingerprint } from "../logic/fingerprint.ts";
import { LiveCheck } from "../logic/liveCheck.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { refreshInterval } from "../logic/refresh.ts";

/** Refreshes on the list's schedule: on its interval, or on returning to the tab for "on access". */
export function useRefreshOptions() {
    const { mode } = useDashboardState();
    const interval = refreshInterval(mode);
    return {
        refetchInterval: (query: { state: { error: Error | null } }) =>
            interval > 0 && !query.state.error ? interval : (false as const),
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: mode === "0",
    };
}

export const prQueryKey = (githubId: number | undefined, route: PrRoute) =>
    ["pr", githubId, route.owner, route.repo, route.number] as const;

export function usePullRequest(route: PrRoute) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: prQueryKey(github?.id, route),
        enabled: !!github,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return loadPullRequest(github.client, route);
        },
        ...useRefreshOptions(),
    });
}

export function usePullRequestCommits(route: PrRoute) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: [...prQueryKey(github?.id, route), "commits"],
        enabled: !!github,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return loadPullRequestCommits(github.client, route);
        },
        ...useRefreshOptions(),
    });
}

export function useViewedFiles(route: PrRoute) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: [...prQueryKey(github?.id, route), "viewed"],
        enabled: !!github,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return loadViewedFiles(github.client, route);
        },
        ...useRefreshOptions(),
    });
}

export function usePullRequestStack(route: PrRoute) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: [...prQueryKey(github?.id, route), "stack"],
        enabled: !!github,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return loadStack(github.client, route);
        },
        // Stack nodes point at each other, which the deep compare of structural sharing cannot walk.
        structuralSharing: false,
        ...useRefreshOptions(),
    });
}

/**
 * In live mode, the open PR has a change check of its own, as the list does: a one-point read
 * every 15 seconds, and everything on the page read again once it moves.
 */
export function usePullRequestLiveCheck(route: PrRoute, detail: PullRequestDetail | undefined, busy: boolean) {
    const { github, mode } = useDashboardState();
    const queryClient = useQueryClient();
    const busyRef = useRef(busy);
    busyRef.current = busy;
    const live = mode === "live";

    const liveCheck = useMemo(
        () =>
            github
                ? new LiveCheck({
                      probe: () => readPullRequestFingerprint(github.client, route),
                      busy: () => busyRef.current,
                      onChange: () => void queryClient.invalidateQueries({ queryKey: prQueryKey(github.id, route) }),
                  })
                : null,
        [github, route, queryClient],
    );

    useEffect(() => {
        if (live && detail) liveCheck?.setBaseline(prFingerprint(detail.pr));
    }, [live, liveCheck, detail]);

    useLiveTicks(live && detail ? liveCheck : null);
}

import { useQuery } from "@tanstack/react-query";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { loadPullRequest, loadPullRequestCommits } from "../github/pullRequest.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { refreshInterval } from "../logic/refresh.ts";

/** Refreshes on the list's schedule: on its interval, or on returning to the tab for "on access". */
function useRefreshOptions() {
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

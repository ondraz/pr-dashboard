import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { loadPullFiles, loadPullRawDiff } from "../github/diff.ts";
import { splitRawDiff } from "../logic/diff.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { prQueryKey, useRefreshOptions } from "./usePullRequest.ts";

/** The PR's changed files, read again with the rest of the PR. */
export function usePullFiles(route: PrRoute) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: [...prQueryKey(github?.id, route), "files"],
        enabled: !!github,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return loadPullFiles(github.client, route);
        },
        ...useRefreshOptions(),
    });
}

/**
 * The PR's raw diff at one head commit, split into files; read only once a file's REST patch turns out to
 * be missing or cut, and never again for the same head.
 */
export function usePullRawDiff(route: PrRoute, headOid: string, enabled: boolean) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: ["raw-diff", github?.id, route.owner, route.repo, route.number, headOid],
        enabled: enabled && !!github,
        staleTime: Number.POSITIVE_INFINITY,
        queryFn: async () => {
            if (!github) throw new Error("Not signed in");
            return splitRawDiff(await loadPullRawDiff(github.client, route));
        },
    });
}

const DARK = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void): () => void {
    const query = typeof window.matchMedia === "function" ? window.matchMedia(DARK) : null;
    query?.addEventListener("change", onChange);
    return () => query?.removeEventListener("change", onChange);
}

/** The system's colour scheme, which the page's own styles follow too. */
export function useColorScheme(): "light" | "dark" {
    return useSyncExternalStore(
        subscribeToScheme,
        () => (typeof window.matchMedia === "function" && window.matchMedia(DARK).matches ? "dark" : "light"),
        () => "light",
    );
}

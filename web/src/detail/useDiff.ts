import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import {
    type CommitDiff,
    loadCommitDiff,
    loadCommitRawDiff,
    loadCompareDiff,
    loadCompareRawDiff,
    loadFileText,
    loadPullFiles,
    loadPullRawDiff,
} from "../github/diff.ts";
import { type ChangedFile, type DiffSpec, splitRawDiff } from "../logic/diff.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { prQueryKey, useRefreshOptions } from "./usePullRequest.ts";

export interface DiffFiles {
    files: ChangedFile[];
    /** False when GitHub lists fewer files than the diff has. */
    complete: boolean;
    commit?: Omit<CommitDiff, "files" | "complete">;
    /** A comparison's status: `diverged` when its start is no longer an ancestor of its end. */
    compareStatus?: string;
}

const specKey = (spec: DiffSpec) =>
    spec.kind === "all" ? ["all"] : spec.kind === "commit" ? ["commit", spec.sha] : ["range", spec.from, spec.to];

/**
 * The files of the diff `spec` names. The whole PR's are read again with the PR; a commit's or a range's
 * never change, so they are read once.
 */
export function useDiffFiles(route: PrRoute, spec: DiffSpec, changedFiles: number) {
    const { github } = useDashboardState();
    const refresh = useRefreshOptions();
    const fixed = spec.kind !== "all";
    return useQuery({
        queryKey: fixed
            ? ["diff", github?.id, route.owner, route.repo, ...specKey(spec)]
            : [...prQueryKey(github?.id, route), "files"],
        enabled: !!github,
        ...(fixed ? { staleTime: Number.POSITIVE_INFINITY } : refresh),
        queryFn: async (): Promise<DiffFiles> => {
            if (!github) throw new Error("Not signed in");
            if (spec.kind === "commit") {
                const { files, complete, ...commit } = await loadCommitDiff(github.client, route, spec.sha);
                return { files, complete, commit };
            }
            if (spec.kind === "range") {
                const { files, complete, status } = await loadCompareDiff(github.client, route, spec.from, spec.to);
                return { files, complete, compareStatus: status };
            }
            const files = await loadPullFiles(github.client, route);
            return { files, complete: files.length >= changedFiles };
        },
    });
}

/**
 * The raw diff of `spec` at one head commit, split into files; read only once a file's REST patch turns out
 * to be missing or cut, and never again for the same commits.
 */
export function useRawDiff(route: PrRoute, spec: DiffSpec, headOid: string, enabled: boolean) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: ["raw-diff", github?.id, route.owner, route.repo, route.number, ...specKey(spec), headOid],
        enabled: enabled && !!github,
        staleTime: Number.POSITIVE_INFINITY,
        queryFn: async () => {
            if (!github) throw new Error("Not signed in");
            const raw =
                spec.kind === "commit"
                    ? await loadCommitRawDiff(github.client, route, spec.sha)
                    : spec.kind === "range"
                      ? await loadCompareRawDiff(github.client, route, spec.from, spec.to)
                      : await loadPullRawDiff(github.client, route);
            return splitRawDiff(raw);
        },
    });
}

/** A file's text at one commit, read once the reader asks for the lines around its changes. */
export function useFileText(route: PrRoute, path: string, ref: string, enabled: boolean) {
    const { github } = useDashboardState();
    return useQuery({
        queryKey: ["file-text", github?.id, route.owner, route.repo, ref, path],
        enabled: enabled && !!github,
        staleTime: Number.POSITIVE_INFINITY,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return loadFileText(github.client, route, path, ref);
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

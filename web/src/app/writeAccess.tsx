import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { PrRoute } from "../logic/prRoute.ts";
import { useAuth } from "./AuthProvider.tsx";
import { useDashboardState } from "./DashboardProvider.tsx";

export interface WriteAccess {
    /** Whether the page offers actions that write to GitHub in this repository. */
    canWrite: boolean;
    /** Why it does not: signed in with a read-only token, or GitHub refused a change here. */
    reason: { kind: "token" } | { kind: "refused"; message: string } | null;
    /** GitHub refused a change in this repository: hide the actions for it from now on. */
    refuse: (message: string) => void;
}

interface Refusals {
    sessionId: number | undefined;
    byRepo: ReadonlyMap<string, string>;
}

const RefusalsContext = createContext<{ refusals: Refusals; refuse: (repo: string, message: string) => void } | null>(
    null,
);

/** Remembers, per sign-in, the repositories where GitHub refused a change. */
export function WriteAccessProvider({ children }: { children: ReactNode }) {
    const { github } = useDashboardState();
    const sessionId = github?.id;
    const [refusals, setRefusals] = useState<Refusals>({ sessionId, byRepo: new Map() });
    const current = refusals.sessionId === sessionId ? refusals : { sessionId, byRepo: new Map<string, string>() };
    const refuse = useCallback(
        (repo: string, message: string) =>
            setRefusals((previous) => {
                const byRepo = new Map(previous.sessionId === sessionId ? previous.byRepo : []);
                byRepo.set(repo, message);
                return { sessionId, byRepo };
            }),
        [sessionId],
    );
    const value = useMemo(() => ({ refusals: current, refuse }), [current, refuse]);
    return <RefusalsContext value={value}>{children}</RefusalsContext>;
}

/**
 * Only the GitHub App's tokens may write: a pasted token is the read-only fallback, so its sign-in sees no
 * write actions, and neither does a repository where GitHub has refused one.
 */
export function useWriteAccess(route: PrRoute): WriteAccess {
    const { credentials } = useAuth();
    const context = useContext(RefusalsContext);
    if (!context) throw new Error("useWriteAccess needs a WriteAccessProvider");
    const repo = `${route.owner}/${route.repo}`.toLowerCase();
    const refused = context.refusals.byRepo.get(repo);
    const { refuse } = context;
    const reason =
        credentials?.kind !== "app"
            ? ({ kind: "token" } as const)
            : refused !== undefined
              ? ({ kind: "refused", message: refused } as const)
              : null;
    return { canWrite: reason === null, reason, refuse: (message: string) => refuse(repo, message) };
}

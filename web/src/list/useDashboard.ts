import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "../app/services.tsx";
import { readChangeFingerprint } from "../github/changeCheck.ts";
import type { GitHubClient } from "../github/client.ts";
import { type DashboardData, fetchViewerLogin, loadDashboard } from "../github/dashboard.ts";
import { ChangeFingerprint } from "../logic/fingerprint.ts";
import { LIVE_PROBE_MS, LiveCheck } from "../logic/liveCheck.ts";
import { type RefreshMode, refreshInterval } from "../logic/refresh.ts";
import type { PrSessions } from "../sessions.ts";

export interface DashboardView extends DashboardData {
    login: string;
    sessions: PrSessions;
}

interface TokenSession {
    id: number;
    client: GitHubClient;
    fingerprint: ChangeFingerprint;
    login: string | null;
}

let nextSessionId = 0;

/**
 * The three tabs' data for one token, refreshed as `mode` says: on a fixed interval, whenever the
 * tab becomes visible ("on access"), or in live mode whenever the cheap change check sees a change.
 */
export function useDashboard(token: string | null, mode: RefreshMode) {
    const services = useServices();
    const session = useMemo<TokenSession | null>(
        () =>
            token
                ? {
                      id: nextSessionId++,
                      client: services.createClient(token),
                      fingerprint: new ChangeFingerprint(),
                      login: null,
                  }
                : null,
        [token, services],
    );
    const [progress, setProgress] = useState<string | null>(null);
    const live = mode === "live";
    const interval = refreshInterval(mode);

    const query = useQuery({
        queryKey: ["dashboard", session?.id],
        enabled: !!session,
        queryFn: async (): Promise<DashboardView> => {
            if (!session) throw new Error("No token");
            setProgress("Refreshing…");
            if (!session.login) {
                setProgress("Checking account…");
                session.login = await fetchViewerLogin(session.client);
            }
            const [data, sessions] = await Promise.all([
                loadDashboard(session.client, session.login, {
                    onProgress: setProgress,
                    fingerprint: live ? session.fingerprint : undefined,
                }),
                services.fetchSessions(),
            ]);
            return { ...data, login: session.login, sessions };
        },
        // Stack nodes point at each other, which the deep compare of structural sharing cannot walk.
        structuralSharing: false,
        refetchInterval: (current) => (interval > 0 && !current.state.error ? interval : false),
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: mode === "0",
    });

    const fetchingRef = useRef(query.isFetching);
    fetchingRef.current = query.isFetching;
    const refetchRef = useRef(query.refetch);
    refetchRef.current = query.refetch;

    const liveCheck = useMemo(
        () =>
            session
                ? new LiveCheck({
                      probe: () => readChangeFingerprint(session.client, session.login ?? "", session.fingerprint),
                      busy: () => fetchingRef.current,
                      onChange: () => void refetchRef.current(),
                  })
                : null,
        [session],
    );

    useEffect(() => {
        if (live) liveCheck?.setBaseline(query.data?.fingerprint ?? null);
    }, [live, liveCheck, query.data]);

    const checking = live && !!liveCheck && !!query.data && !query.error;
    useEffect(() => {
        if (!checking || !liveCheck) return;
        const check = () => {
            if (document.visibilityState === "visible") void liveCheck.check();
        };
        const timer = setInterval(check, LIVE_PROBE_MS);
        // Back on the tab, check at once rather than at the next tick.
        document.addEventListener("visibilitychange", check);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", check);
        };
    }, [checking, liveCheck]);

    return {
        data: query.data ?? null,
        error: query.error,
        isFetching: query.isFetching,
        progress: query.isFetching ? progress : null,
        updatedAt: query.dataUpdatedAt || null,
        refresh: () => void query.refetch(),
    };
}

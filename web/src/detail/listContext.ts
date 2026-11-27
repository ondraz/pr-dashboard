import { useMemo } from "react";
import type { PrSession } from "../../../shared/sessions.ts";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { buildFeatureGroups } from "../logic/layout.ts";

export interface PrListContext {
    /** The cross-repo set the PR belongs to, when the list draws one. */
    feature: { label: string; repoCount: number } | null;
    /** Every Claude session that made the PR, and that reviewed it, the most recent first. */
    made: PrSession[];
    reviewed: PrSession[];
}

/** What the list knows about the PR at `url`; empty until the list has loaded. */
export function usePrListContext(url: string): PrListContext {
    const { data } = useDashboardState();
    return useMemo(() => {
        if (!data) return { feature: null, made: [], reviewed: [] };
        const mine = data.mine.find((pr) => pr.html_url === url);
        const group = mine?.feature
            ? buildFeatureGroups(data.mine, data.repoNodes).find((candidate) => candidate.key === mine.feature?.key)
            : undefined;
        return {
            feature: group ? { label: group.label, repoCount: group.repos.size } : null,
            made: data.sessions.made.get(url) ?? [],
            reviewed: data.sessions.reviewed.get(url) ?? [],
        };
    }, [data, url]);
}

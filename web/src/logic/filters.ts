export type StatusFilter = "all" | "open" | "draft";
export type AgeFilter = "recent" | "all";

export interface ListFilters {
    status: StatusFilter;
    age: AgeFilter;
}

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

export function applyFilters<P extends { isDraft: boolean; updated_at: string }>(
    prs: readonly P[],
    filters: ListFilters,
    now: number = Date.now(),
): P[] {
    return prs.filter((pr) => {
        if (filters.status === "open" && pr.isDraft) return false;
        if (filters.status === "draft" && !pr.isDraft) return false;
        if (filters.age === "recent" && Date.parse(pr.updated_at) < now - RECENT_MS) return false;
        return true;
    });
}

export function newestUpdate(prs: readonly { updated_at: string }[]): number {
    return Math.max(...prs.map((pr) => Date.parse(pr.updated_at)));
}

/** PRs per repository, newest first inside each, and the repository updated most recently first. */
export function byRepo<P extends { repoFullName: string; updated_at: string }>(prs: readonly P[]): [string, P[]][] {
    const groups = new Map<string, P[]>();
    for (const pr of prs) {
        const list = groups.get(pr.repoFullName);
        if (list) list.push(pr);
        else groups.set(pr.repoFullName, [pr]);
    }
    for (const list of groups.values()) list.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    return [...groups.entries()].sort((a, b) => newestUpdate(b[1]) - newestUpdate(a[1]));
}

import { applyFilters, byRepo, type ListFilters } from "./filters.ts";
import { type LayoutPr, listLayout, type Row } from "./layout.ts";
import { type MyReviewStanding, reviewedGroups } from "./reviews.ts";
import type { StackNode } from "./stacks.ts";
import type { Tab } from "./tabs.ts";

interface Listed {
    html_url: string;
    repoFullName: string;
    isDraft: boolean;
    updated_at: string;
}

export interface ListView {
    tab: Tab;
    filters: ListFilters;
    grouping: "repo" | "feature";
}

export interface ListedPrs<M, W, R> {
    mine: readonly M[];
    waiting: readonly W[];
    reviewed: readonly R[];
    repoNodes: readonly StackNode[];
}

function rowUrls(rows: readonly Row<Listed & LayoutPr>[]): string[] {
    return rows.flatMap((row) =>
        row.kind === "pr"
            ? [row.pr.html_url]
            : row.members.flatMap((member) => (member.kind === "pr" ? [member.pr.html_url] : [])),
    );
}

/**
 * The PRs the list shows on its current tab, top to bottom, as `[` and `]` step through them. A
 * colleague's PR drawn as context in a stack is left out; collapsed sections are not.
 */
export function listOrder<
    M extends Listed & LayoutPr,
    W extends Listed,
    R extends Listed & Pick<MyReviewStanding, "myVerdict" | "updatedSinceReview">,
>(data: ListedPrs<M, W, R>, view: ListView, now: number = Date.now()): string[] {
    if (view.tab === "reviews") {
        return byRepo(applyFilters(data.waiting, view.filters, now)).flatMap(([, prs]) => prs.map((pr) => pr.html_url));
    }
    if (view.tab === "reviewed") {
        return reviewedGroups(applyFilters(data.reviewed, view.filters, now)).flatMap(({ prs }) =>
            prs.map((pr) => pr.html_url),
        );
    }
    const layout = listLayout(applyFilters(data.mine, view.filters, now), data.repoNodes, view.grouping);
    return [
        ...layout.features.flatMap((block) => block.sections.flatMap((section) => rowUrls(section.rows))),
        ...layout.repos.flatMap(({ body }) => rowUrls(body.rows)),
    ];
}

/** The PRs before and after `url` in `order`, or null at either end or when it is not there. */
export function neighbours(order: readonly string[], url: string): { previous: string | null; next: string | null } {
    const index = order.indexOf(url);
    if (index < 0) return { previous: null, next: null };
    return { previous: order[index - 1] ?? null, next: order[index + 1] ?? null };
}

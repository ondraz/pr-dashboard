export type Tab = "mine" | "reviews" | "reviewed";

export const TABS: readonly Tab[] = ["mine", "reviews", "reviewed"];

export type SearchName = "mine" | "requested" | "reviewed";

/**
 * The searches behind the three tabs. A PR waiting for the viewer's review again belongs in the
 * review tab, so the reviewed one leaves it out.
 */
export function tabSearches(login: string): Record<SearchName, string> {
    return {
        mine: `is:pr is:open author:${login}`,
        requested: `is:pr is:open review-requested:${login}`,
        reviewed: `is:pr is:open reviewed-by:${login} -author:${login} -review-requested:${login}`,
    };
}

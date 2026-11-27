export type ReviewerState = "REQUESTED" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

export interface Reviewer {
    name: string;
    state: ReviewerState;
    team: boolean;
    avatarUrl: string | null;
}

type RequestedReviewer = { login: string } | { name: string; combinedSlug: string };

interface LatestReview {
    state: string;
    author?: { login: string; avatarUrl?: string } | null;
}

const VERDICTS = new Set<string>(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]);

/**
 * The sidebar's reviewers: each one's latest review, and every review still requested. A request
 * made again after a review wins, since a new review is what is awaited.
 */
export function reviewers(
    requested: readonly (RequestedReviewer | null | undefined)[],
    latestReviews: readonly (LatestReview | null)[],
): Reviewer[] {
    const byName = new Map<string, Reviewer>();
    for (const review of latestReviews) {
        const login = review?.author?.login;
        if (!login || !VERDICTS.has(review.state)) continue;
        byName.set(login, {
            name: login,
            state: review.state as ReviewerState,
            team: false,
            avatarUrl: review.author?.avatarUrl ?? null,
        });
    }
    for (const reviewer of requested) {
        if (!reviewer) continue;
        const team = !("login" in reviewer);
        const name = team ? reviewer.combinedSlug : reviewer.login;
        byName.set(name, { name, state: "REQUESTED", team, avatarUrl: byName.get(name)?.avatarUrl ?? null });
    }
    return [...byName.values()];
}

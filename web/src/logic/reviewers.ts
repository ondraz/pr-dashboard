export type ReviewerState = "REQUESTED" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

export interface Reviewer {
    name: string;
    state: ReviewerState;
    team: boolean;
    avatarUrl: string | null;
    /** Their latest review, which a dismissal is of; null for someone who has not reviewed. */
    reviewId: string | null;
}

type RequestedReviewer = { login: string } | { name: string; combinedSlug: string };

interface LatestReview {
    id?: string;
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
            reviewId: review.id ?? null,
        });
    }
    for (const reviewer of requested) {
        if (!reviewer) continue;
        const team = !("login" in reviewer);
        const name = team ? reviewer.combinedSlug : reviewer.login;
        const reviewed = byName.get(name);
        byName.set(name, {
            name,
            state: "REQUESTED",
            team,
            avatarUrl: reviewed?.avatarUrl ?? null,
            reviewId: reviewed?.reviewId ?? null,
        });
    }
    return [...byName.values()];
}

/** Whether `viewer` can ask `reviewer` for another review: someone else who reviewed and is not asked already. */
export function canReRequest(reviewer: Reviewer, viewer: string | null, author: string | null): boolean {
    return !reviewer.team && reviewer.state !== "REQUESTED" && reviewer.name !== viewer && reviewer.name !== author;
}

/** Whether a reviewer's latest review stands as a verdict that can be dismissed. */
export function canDismiss(reviewer: Reviewer): boolean {
    return (reviewer.state === "APPROVED" || reviewer.state === "CHANGES_REQUESTED") && reviewer.reviewId !== null;
}

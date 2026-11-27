/** A review as the REST API returns it. */
export interface RestReview {
    state: string;
    user?: { login: string } | null;
    commit_id?: string | null;
    submitted_at?: string | null;
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "PENDING";

/** Each reviewer's latest verdict decides; a comment is not a verdict, a dismissal clears one. */
export function reviewDecision(reviews: readonly RestReview[] | null | undefined): ReviewDecision {
    if (!reviews) return "PENDING";
    const latestByUser = new Map<string, string>();
    for (const review of reviews) {
        if (review.state === "COMMENTED" || !review.user) continue;
        latestByUser.set(review.user.login, review.state);
    }
    const states = new Set(latestByUser.values());
    if (states.has("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
    if (states.has("APPROVED")) return "APPROVED";
    return "PENDING";
}

export type MyVerdict = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "UNKNOWN";

/** Where the viewer's own review of someone else's PR stands. */
export interface MyReviewStanding {
    myVerdict: MyVerdict;
    /** True when the PR's head moved since the viewer's last review. */
    updatedSinceReview: boolean;
    lastReviewAt: string | null;
    lastReviewSha: string | null;
    headSha: string | null;
}

/** `reviews` in the order GitHub lists them, oldest first; null when they could not all be read. */
export function myReviewStanding(
    reviews: readonly RestReview[] | null,
    login: string,
    headSha: string | null,
): MyReviewStanding {
    if (!reviews || !headSha) {
        return { myVerdict: "UNKNOWN", updatedSinceReview: false, lastReviewAt: null, lastReviewSha: null, headSha };
    }
    const mine = reviews.filter((review) => review.user?.login === login);
    // A dismissal clears the standing verdict instead of reviving an older one.
    const verdict = mine.filter((review) => review.state !== "COMMENTED" && review.state !== "PENDING").pop();
    const last = mine.at(-1);
    const myVerdict: MyVerdict =
        verdict?.state === "APPROVED" || verdict?.state === "CHANGES_REQUESTED" ? verdict.state : "COMMENTED";
    return {
        myVerdict,
        updatedSinceReview: !!last && last.commit_id !== headSha,
        lastReviewAt: last?.submitted_at ?? null,
        lastReviewSha: last?.commit_id ?? null,
        headSha,
    };
}

export type WaitingState = "review" | "rereview" | "answered" | "author" | "ready" | "approved" | "commented";

export const WAITING_STATES: Record<WaitingState, { text: string; label: string }> = {
    review: { text: "Review", label: "Not reviewed by you yet" },
    rereview: { text: "Re-review", label: "New commits since your review" },
    answered: { text: "Answered", label: "Someone answered in your open threads" },
    author: { text: "Waiting on author", label: "Your threads or change request are still open" },
    ready: { text: "Ready to approve", label: "Your threads are resolved and nothing changed since your review" },
    approved: { text: "Approved", label: "You approved the current state" },
    commented: { text: "Commented", label: "Review threads could not be loaded" },
};

export interface WaitingInput {
    lastReviewAt: string | null;
    updatedSinceReview: boolean;
    myVerdict: MyVerdict;
    /** False when the viewer's threads on the PR could not be read. */
    threadsLoaded: boolean;
    myOpenThreads?: number;
    myReplies?: number;
}

/** What to do next on a PR waiting for the viewer's review. */
export function waitingState(pr: WaitingInput): WaitingState {
    if (!pr.lastReviewAt) return "review";
    if (pr.updatedSinceReview) return "rereview";
    if (pr.myVerdict === "APPROVED") return "approved";
    if (pr.myReplies) return "answered";
    if (!pr.threadsLoaded) return pr.myVerdict === "CHANGES_REQUESTED" ? "author" : "commented";
    if (pr.myOpenThreads || pr.myVerdict === "CHANGES_REQUESTED") return "author";
    return "ready";
}

export type ReviewedStatus = "changes-updated" | "updated" | "changes" | "commented" | "approved" | "unknown";

/** The sections of the reviewed tab, in display order. */
export const REVIEWED_STATUSES: readonly { key: ReviewedStatus; label: string; text: string }[] = [
    { key: "changes-updated", label: "Updated after you requested changes", text: "Re-review" },
    { key: "updated", label: "Updated since your review", text: "Re-review" },
    { key: "changes", label: "Waiting on the author", text: "Changes requested" },
    { key: "commented", label: "You commented", text: "Commented" },
    { key: "approved", label: "Approved, not merged", text: "Approved" },
    { key: "unknown", label: "Review state not loaded", text: "Unknown" },
];

export function reviewedStatus(pr: Pick<MyReviewStanding, "myVerdict" | "updatedSinceReview">): ReviewedStatus {
    if (pr.myVerdict === "UNKNOWN") return "unknown";
    if (pr.myVerdict === "APPROVED") return "approved";
    if (pr.myVerdict === "CHANGES_REQUESTED") return pr.updatedSinceReview ? "changes-updated" : "changes";
    return pr.updatedSinceReview ? "updated" : "commented";
}

/** The reviewed tab's sections in display order, each newest update first; empty ones are left out. */
export function reviewedGroups<
    P extends Pick<MyReviewStanding, "myVerdict" | "updatedSinceReview"> & { updated_at: string },
>(prs: readonly P[]): { status: (typeof REVIEWED_STATUSES)[number]; prs: P[] }[] {
    return REVIEWED_STATUSES.map((status) => ({
        status,
        prs: prs
            .filter((pr) => reviewedStatus(pr) === status.key)
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    })).filter((group) => group.prs.length > 0);
}

/** A re-review needs only what was pushed since the viewer's last review. */
export function reviewHref(pr: { html_url: string } & Omit<MyReviewStanding, "myVerdict" | "lastReviewAt">): string {
    if (pr.updatedSinceReview && pr.lastReviewSha && pr.headSha) {
        return `${pr.html_url}/files/${pr.lastReviewSha}..${pr.headSha}`;
    }
    return `${pr.html_url}/files`;
}

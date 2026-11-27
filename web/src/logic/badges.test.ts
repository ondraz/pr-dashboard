import { describe, expect, it } from "vitest";
import { mergeBadge, REVIEWED_BADGE_CLASS, unresolvedBadge, waitingBadge } from "./badges.ts";
import { REVIEWED_STATUSES } from "./reviews.ts";

const url = "https://github.com/acme/widgets/pull/7";
const verdict = { id: "PRR_9", databaseId: 99, label: "Changes recommended", owing: true };

describe("mergeBadge", () => {
    it("names the method and who armed auto-merge", () => {
        expect(mergeBadge({ method: "squash", enabledBy: "alice" })).toEqual({
            text: "Auto-merge",
            title: "Auto-merge enabled (squash) by alice - merges on its own once checks and reviews pass",
            inQueue: false,
        });
        expect(mergeBadge(null)).toBeNull();
    });

    it("shows the merge queue position over auto-merge", () => {
        expect(mergeBadge({ method: "merge", enabledBy: "" }, { position: 2, state: "AWAITING_CHECKS" })).toEqual({
            text: "Merge queue #2",
            title: "In the merge queue #2 (awaiting checks)",
            inQueue: true,
        });
    });
});

describe("unresolvedBadge", () => {
    it("counts threads with their comments and links to the diff", () => {
        expect(
            unresolvedBadge({
                html_url: url,
                unresolved: 2,
                unresolvedThreads: 2,
                unresolvedComments: 5,
                copilotVerdict: null,
                myOpenThreads: 1,
            }),
        ).toEqual({ count: 2, title: "2 unresolved review threads (5 comments), 1 yours", href: `${url}/files` });
    });

    it("links to Copilot's review when its verdict is all there is", () => {
        expect(
            unresolvedBadge({
                html_url: url,
                unresolved: 1,
                unresolvedThreads: 0,
                unresolvedComments: 0,
                copilotVerdict: verdict,
            }),
        ).toEqual({ count: 1, title: "Copilot: Changes recommended", href: `${url}#pullrequestreview-99` });
    });

    it("is absent when nothing is owed", () => {
        expect(
            unresolvedBadge({
                html_url: url,
                unresolved: 0,
                unresolvedThreads: 0,
                unresolvedComments: 0,
                copilotVerdict: null,
            }),
        ).toBeNull();
    });
});

describe("waitingBadge", () => {
    const base = {
        html_url: url,
        myVerdict: "COMMENTED" as const,
        updatedSinceReview: false,
        lastReviewAt: "2026-11-25T12:00:00Z",
        lastReviewSha: "old",
        headSha: "new",
        threadsLoaded: true,
        myOpenThreads: 0,
        myReplies: 0,
    };
    const now = Date.parse("2026-11-27T12:00:00Z");

    it("asks for a first review", () => {
        expect(waitingBadge({ ...base, lastReviewAt: null }, now)).toEqual({
            text: "Review",
            title: "Not reviewed by you yet",
            href: `${url}/files`,
            className: "review-pending",
        });
    });

    it("links a re-review to what changed since the last one", () => {
        expect(waitingBadge({ ...base, updatedSinceReview: true }, now)).toMatchObject({
            text: "Re-review",
            title: "New commits since your review. Your last review: 2d ago",
            href: `${url}/files/old..new`,
        });
    });

    it("colors who has to act", () => {
        expect(waitingBadge(base, now).className).toBe("review-approved");
        expect(waitingBadge({ ...base, myOpenThreads: 1 }, now).className).toBe("review-pending review-waiting");
        expect(waitingBadge({ ...base, myVerdict: "CHANGES_REQUESTED" }, now).className).toBe("review-changes");
    });
});

describe("REVIEWED_BADGE_CLASS", () => {
    it("covers every reviewed section", () => {
        for (const status of REVIEWED_STATUSES) expect(REVIEWED_BADGE_CLASS[status.key]).toMatch(/^review-/);
    });
});

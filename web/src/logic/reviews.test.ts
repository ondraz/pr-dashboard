import { describe, expect, it } from "vitest";
import {
    myReviewStanding,
    type RestReview,
    reviewDecision,
    reviewedStatus,
    reviewHref,
    type WaitingInput,
    waitingState,
} from "./reviews.ts";

const r = (login: string, state: string, commit_id = "sha1", submitted_at = "2026-11-20T10:00:00Z"): RestReview => ({
    user: { login },
    state,
    commit_id,
    submitted_at,
});

describe("reviewDecision", () => {
    it("is pending without verdicts", () => {
        expect(reviewDecision([r("bob", "COMMENTED")])).toBe("PENDING");
        expect(reviewDecision([])).toBe("PENDING");
        expect(reviewDecision(null)).toBe("PENDING");
    });

    it("lets any standing change request win over approvals", () => {
        expect(reviewDecision([r("bob", "APPROVED"), r("carol", "CHANGES_REQUESTED")])).toBe("CHANGES_REQUESTED");
    });

    it("takes each reviewer's latest verdict, skipping comments", () => {
        expect(reviewDecision([r("bob", "CHANGES_REQUESTED"), r("bob", "APPROVED"), r("bob", "COMMENTED")])).toBe(
            "APPROVED",
        );
    });

    it("drops a dismissed verdict", () => {
        expect(reviewDecision([r("bob", "APPROVED"), r("bob", "DISMISSED")])).toBe("PENDING");
    });

    it("skips reviews by deleted users", () => {
        expect(reviewDecision([{ state: "APPROVED", user: null }])).toBe("PENDING");
    });
});

describe("myReviewStanding", () => {
    it("is unknown when the reviews or the head could not be read", () => {
        expect(myReviewStanding(null, "alice", "sha2")).toEqual({
            myVerdict: "UNKNOWN",
            updatedSinceReview: false,
            lastReviewAt: null,
            lastReviewSha: null,
            headSha: "sha2",
        });
        expect(myReviewStanding([], "alice", null).myVerdict).toBe("UNKNOWN");
    });

    it("keeps the last verdict through later comments and notes the head moved", () => {
        const standing = myReviewStanding(
            [
                r("alice", "CHANGES_REQUESTED", "sha1", "2026-11-18T10:00:00Z"),
                r("bob", "APPROVED", "sha2"),
                r("alice", "COMMENTED", "sha1", "2026-11-19T10:00:00Z"),
            ],
            "alice",
            "sha2",
        );
        expect(standing).toEqual({
            myVerdict: "CHANGES_REQUESTED",
            updatedSinceReview: true,
            lastReviewAt: "2026-11-19T10:00:00Z",
            lastReviewSha: "sha1",
            headSha: "sha2",
        });
    });

    it("treats a dismissal as clearing the verdict", () => {
        expect(myReviewStanding([r("alice", "APPROVED"), r("alice", "DISMISSED")], "alice", "sha1").myVerdict).toBe(
            "COMMENTED",
        );
    });

    it("is a comment when the viewer never reviewed", () => {
        expect(myReviewStanding([r("bob", "APPROVED")], "alice", "sha1")).toMatchObject({
            myVerdict: "COMMENTED",
            updatedSinceReview: false,
            lastReviewAt: null,
        });
    });
});

describe("waitingState", () => {
    const base: WaitingInput = {
        lastReviewAt: "2026-11-19T10:00:00Z",
        updatedSinceReview: false,
        myVerdict: "COMMENTED",
        threadsLoaded: true,
        myOpenThreads: 0,
        myReplies: 0,
    };

    it.each<[Partial<WaitingInput>, string]>([
        [{ lastReviewAt: null, updatedSinceReview: true }, "review"],
        [{ updatedSinceReview: true, myVerdict: "APPROVED" }, "rereview"],
        [{ myVerdict: "APPROVED", myReplies: 2 }, "approved"],
        [{ myReplies: 1, myVerdict: "CHANGES_REQUESTED" }, "answered"],
        [{ threadsLoaded: false, myVerdict: "CHANGES_REQUESTED" }, "author"],
        [{ threadsLoaded: false }, "commented"],
        [{ myOpenThreads: 1 }, "author"],
        [{ myVerdict: "CHANGES_REQUESTED" }, "author"],
        [{}, "ready"],
    ])("%j is %s", (input, expected) => {
        expect(waitingState({ ...base, ...input })).toBe(expected);
    });
});

describe("reviewedStatus", () => {
    it.each<[Parameters<typeof reviewedStatus>[0], string]>([
        [{ myVerdict: "UNKNOWN", updatedSinceReview: true }, "unknown"],
        [{ myVerdict: "APPROVED", updatedSinceReview: true }, "approved"],
        [{ myVerdict: "CHANGES_REQUESTED", updatedSinceReview: true }, "changes-updated"],
        [{ myVerdict: "CHANGES_REQUESTED", updatedSinceReview: false }, "changes"],
        [{ myVerdict: "COMMENTED", updatedSinceReview: true }, "updated"],
        [{ myVerdict: "COMMENTED", updatedSinceReview: false }, "commented"],
    ])("%j is %s", (input, expected) => {
        expect(reviewedStatus(input)).toBe(expected);
    });
});

describe("reviewHref", () => {
    const url = "https://github.com/acme/widgets/pull/4";

    it("links the commits since the last review when the head moved", () => {
        expect(reviewHref({ html_url: url, updatedSinceReview: true, lastReviewSha: "aaa", headSha: "bbb" })).toBe(
            `${url}/files/aaa..bbb`,
        );
    });

    it("links the whole diff otherwise", () => {
        expect(reviewHref({ html_url: url, updatedSinceReview: false, lastReviewSha: "aaa", headSha: "bbb" })).toBe(
            `${url}/files`,
        );
        expect(reviewHref({ html_url: url, updatedSinceReview: true, lastReviewSha: null, headSha: "bbb" })).toBe(
            `${url}/files`,
        );
    });
});

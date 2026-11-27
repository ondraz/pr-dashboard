import { describe, expect, it } from "vitest";
import type { CopilotVerdict } from "./copilot.ts";
import {
    emptyOutstandingWork,
    type ReviewThreadLike,
    standingVerdict,
    tallyThreads,
    unresolvedSummary,
} from "./unresolved.ts";

function thread(
    isResolved: boolean,
    starter: string,
    lastAuthor: string,
    totalCount = 1,
    reviewId = "PRR_x",
): ReviewThreadLike {
    return {
        isResolved,
        comments: { totalCount, nodes: [{ pullRequestReview: { id: reviewId }, author: { login: starter } }] },
        lastComment: { nodes: [{ author: { login: lastAuthor } }] },
    };
}

const verdict = (owing: boolean): CopilotVerdict => ({
    id: "PRR_c",
    databaseId: 9,
    label: "Changes recommended",
    owing,
});

describe("tallyThreads", () => {
    it("counts unresolved threads and the comments in them", () => {
        const work = emptyOutstandingWork();
        tallyThreads(work, [
            thread(false, "bob", "bob", 3),
            thread(true, "bob", "bob", 2),
            thread(false, "carol", "carol"),
        ]);
        expect(work).toMatchObject({ threads: 2, comments: 4, mine: 0, replies: 0 });
    });

    it("counts the viewer's threads and the ones someone else answered", () => {
        const work = emptyOutstandingWork();
        tallyThreads(
            work,
            [thread(false, "alice", "bob"), thread(false, "alice", "alice"), thread(true, "alice", "bob")],
            "alice",
        );
        expect(work).toMatchObject({ threads: 2, mine: 2, replies: 1 });
    });

    it("records the review behind every thread, resolved or not", () => {
        const work = emptyOutstandingWork();
        tallyThreads(work, [thread(true, "copilot", "copilot", 1, "PRR_c"), thread(false, "bob", "bob", 1, "PRR_b")]);
        expect([...work.threadedReviews]).toEqual(["PRR_c", "PRR_b"]);
    });

    it("counts a thread without comment data as one comment", () => {
        const work = emptyOutstandingWork();
        tallyThreads(work, [{ isResolved: false }, null]);
        expect(work).toMatchObject({ threads: 1, comments: 1 });
    });

    it("adds pages up", () => {
        const work = emptyOutstandingWork();
        tallyThreads(work, [thread(false, "bob", "bob")]);
        tallyThreads(work, [thread(false, "bob", "bob", 2)]);
        expect(work).toMatchObject({ threads: 2, comments: 3 });
    });
});

describe("standingVerdict", () => {
    it("counts an owing verdict that left no thread", () => {
        const work = { ...emptyOutstandingWork(), copilot: verdict(true) };
        expect(standingVerdict(work)).toBe(work.copilot);
    });

    it("leaves out a verdict whose threads already count or were resolved", () => {
        const work = { ...emptyOutstandingWork(), copilot: verdict(true) };
        work.threadedReviews.add("PRR_c");
        expect(standingVerdict(work)).toBeNull();
    });

    it("leaves out a verdict that does not ask for changes", () => {
        expect(standingVerdict({ ...emptyOutstandingWork(), copilot: verdict(false) })).toBeNull();
    });
});

describe("unresolvedSummary", () => {
    it("adds one for a standing verdict", () => {
        const work = { ...emptyOutstandingWork(), threads: 2, comments: 5, copilot: verdict(true) };
        expect(unresolvedSummary(work)).toEqual({
            unresolvedThreads: 2,
            unresolvedComments: 5,
            copilotVerdict: work.copilot,
            unresolved: 3,
        });
    });

    it("is zero when the work could not be read", () => {
        expect(unresolvedSummary(undefined)).toEqual({
            unresolvedThreads: 0,
            unresolvedComments: 0,
            copilotVerdict: null,
            unresolved: 0,
        });
    });
});

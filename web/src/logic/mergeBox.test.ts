import { describe, expect, it } from "vitest";
import { checkCounts, type MergeInput, mergeBoxRows } from "./mergeBox.ts";

const open: MergeInput = {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    checks: { state: "SUCCESS", counts: [{ state: "SUCCESS", count: 4 }] },
    autoMerge: null,
    mergeQueue: null,
};

const titles = (input: MergeInput) => mergeBoxRows(input).map((row) => `${row.tone}: ${row.title}`);

describe("mergeBoxRows", () => {
    it("says a reviewed, green, clean PR can merge", () => {
        expect(titles(open)).toEqual([
            "ok: Changes approved",
            "ok: All checks have passed",
            "ok: No conflicts with the base branch",
        ]);
        expect(mergeBoxRows(open)[1]?.detail).toBe("4 successful");
    });

    it("names what stands in the way", () => {
        expect(
            titles({
                ...open,
                reviewDecision: "CHANGES_REQUESTED",
                checks: {
                    state: "FAILURE",
                    counts: [
                        { state: "FAILURE", count: 1 },
                        { state: "SUCCESS", count: 3 },
                        { state: "IN_PROGRESS", count: 1 },
                        { state: "SKIPPED", count: 2 },
                    ],
                },
                mergeable: "CONFLICTING",
                mergeStateStatus: "DIRTY",
            }),
        ).toEqual([
            "fail: Changes requested",
            "fail: Some checks were not successful",
            "fail: This branch has conflicts that must be resolved",
        ]);
        expect(titles({ ...open, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" })).toEqual([
            "warn: Review required",
            "ok: All checks have passed",
            "warn: Merging is blocked",
        ]);
        expect(titles({ ...open, mergeStateStatus: "BEHIND" })[2]).toBe(
            "warn: This branch is out-of-date with the base branch",
        );
    });

    it("waits on checks still running and on GitHub working out mergeability", () => {
        const rows = titles({
            ...open,
            reviewDecision: null,
            checks: { state: "PENDING", counts: [{ state: "QUEUED", count: 2 }] },
            mergeable: "UNKNOWN",
            mergeStateStatus: "UNKNOWN",
        });
        expect(rows).toEqual([
            "neutral: No review required",
            "pending: Some checks haven't completed yet",
            "pending: Checking whether it can be merged",
        ]);
        expect(titles({ ...open, checks: null })[1]).toBe("neutral: No checks");
        expect(titles({ ...open, isDraft: true })[2]).toBe("neutral: This pull request is still a draft");
    });

    it("shows auto-merge, or the queue position, which wins", () => {
        const autoMerge = { method: "squash", enabledBy: "alice" };
        expect(mergeBoxRows({ ...open, autoMerge }).at(-1)?.title).toBe("Auto-merge enabled (squash) by alice");
        const queued = mergeBoxRows({ ...open, autoMerge, mergeQueue: { position: 2, state: "AWAITING_CHECKS" } }).at(
            -1,
        );
        expect(queued).toEqual({
            kind: "auto",
            tone: "pending",
            title: "Queued to merge at position 2",
            detail: "awaiting checks",
        });
    });

    it("is one line once the PR is merged or closed", () => {
        expect(titles({ ...open, state: "MERGED" })).toEqual(["merged: Merged"]);
        expect(titles({ ...open, state: "CLOSED" })).toEqual(["neutral: Closed without merging"]);
    });
});

describe("checkCounts", () => {
    it("adds check runs and commit statuses up by outcome", () => {
        expect(
            checkCounts([
                { state: "SUCCESS", count: 2 },
                { state: "ERROR", count: 1 },
                { state: "TIMED_OUT", count: 1 },
                { state: "EXPECTED", count: 1 },
                { state: "NEUTRAL", count: 1 },
            ]),
        ).toBe("2 failing, 2 successful, 1 pending, 1 skipped");
        expect(checkCounts([])).toBe("");
    });
});

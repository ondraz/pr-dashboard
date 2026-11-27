import { describe, expect, it } from "vitest";
import { landLabel, type MergeActionInput, mergeActions, mergeMethods, takesMessage } from "./mergeActions.ts";

const open: MergeActionInput = {
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    viewerCanUpdate: true,
    viewerCanUpdateBranch: false,
    viewerCanEnableAutoMerge: true,
    viewerCanDisableAutoMerge: true,
    isMergeQueueEnabled: false,
    autoMergeEnabled: false,
    queued: false,
    methods: { merge: true, squash: true, rebase: true, preferred: "SQUASH" },
};

describe("mergeMethods", () => {
    it("lists what the repository allows, the viewer's last method first", () => {
        expect(mergeMethods(open.methods)).toEqual(["SQUASH", "MERGE", "REBASE"]);
        expect(mergeMethods({ merge: false, squash: true, rebase: true, preferred: "MERGE" })).toEqual([
            "SQUASH",
            "REBASE",
        ]);
        expect(mergeMethods({ merge: false, squash: false, rebase: false, preferred: "MERGE" })).toEqual([]);
    });
});

describe("mergeActions", () => {
    it("merges a clean PR at once, by any allowed method", () => {
        expect(mergeActions(open)).toEqual({
            land: "merge",
            methods: ["SQUASH", "MERGE", "REBASE"],
            cancel: null,
            updateBranch: false,
            readyForReview: false,
            convertToDraft: true,
        });
        expect(mergeActions({ ...open, mergeStateStatus: "UNSTABLE" }).land).toBe("merge");
    });

    it("offers auto-merge while something stands in the way, and nothing to someone who may not", () => {
        for (const status of ["BLOCKED", "BEHIND", "DIRTY", "UNKNOWN"]) {
            expect(mergeActions({ ...open, mergeStateStatus: status }).land).toBe("auto-merge");
        }
        const blocked = mergeActions({ ...open, mergeStateStatus: "BLOCKED", viewerCanEnableAutoMerge: false });
        expect(blocked.land).toBeNull();
        expect(blocked.methods).toEqual([]);
    });

    it("takes back auto-merge, and keeps offering to update the branch meanwhile", () => {
        const actions = mergeActions({ ...open, autoMergeEnabled: true, viewerCanUpdateBranch: true });
        expect(actions.land).toBeNull();
        expect(actions.cancel).toBe("disable-auto-merge");
        expect(actions.updateBranch).toBe(true);
        expect(mergeActions({ ...open, autoMergeEnabled: true, viewerCanDisableAutoMerge: false }).cancel).toBeNull();
    });

    it("with a merge queue, adds the PR now or once it may join, and the queue picks the method", () => {
        const queue = { ...open, isMergeQueueEnabled: true };
        expect(mergeActions(queue)).toMatchObject({ land: "enqueue", methods: [] });
        expect(mergeActions({ ...queue, mergeStateStatus: "BLOCKED" }).land).toBe("queue-when-ready");
        const queued = mergeActions({ ...queue, queued: true, viewerCanUpdateBranch: true });
        expect(queued).toMatchObject({ land: null, cancel: "dequeue", updateBranch: false, convertToDraft: false });
    });

    it("offers only ready for review on a draft", () => {
        expect(mergeActions({ ...open, isDraft: true })).toEqual({
            land: null,
            methods: [],
            cancel: null,
            updateBranch: false,
            readyForReview: true,
            convertToDraft: false,
        });
        expect(mergeActions({ ...open, isDraft: true, viewerCanUpdate: false }).readyForReview).toBe(false);
    });

    it("offers nothing on a closed or merged PR", () => {
        for (const state of ["CLOSED", "MERGED"]) {
            expect(mergeActions({ ...open, state, viewerCanUpdateBranch: true })).toMatchObject({
                land: null,
                cancel: null,
                updateBranch: false,
                convertToDraft: false,
            });
        }
    });

    it("offers to update a branch GitHub says can be", () => {
        expect(mergeActions({ ...open, viewerCanUpdateBranch: true }).updateBranch).toBe(true);
    });
});

describe("landLabel and takesMessage", () => {
    it("words the button as GitHub does", () => {
        expect(landLabel("merge", "SQUASH")).toBe("Squash and merge");
        expect(landLabel("merge", "REBASE")).toBe("Rebase and merge");
        expect(landLabel("auto-merge", "MERGE")).toBe("Enable auto-merge (merge)");
        expect(landLabel("enqueue", null)).toBe("Add to merge queue");
        expect(landLabel("queue-when-ready", null)).toBe("Merge when ready");
    });

    it("asks for a message only for a commit GitHub writes", () => {
        expect(takesMessage("merge", "SQUASH")).toBe(true);
        expect(takesMessage("auto-merge", "MERGE")).toBe(true);
        expect(takesMessage("merge", "REBASE")).toBe(false);
        expect(takesMessage("enqueue", null)).toBe(false);
    });
});

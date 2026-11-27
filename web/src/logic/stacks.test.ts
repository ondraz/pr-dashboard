import { describe, expect, it } from "vitest";
import { autoMergeInfo, buildStackIndex, refLabel, stackName } from "./stacks.ts";
import { pull } from "./testPulls.ts";

describe("refLabel", () => {
    it("uses the label GitHub gives", () => {
        expect(refLabel({ label: "acme:feature", ref: "other" })).toBe("acme:feature");
    });

    it("builds owner:branch from the repository without a label", () => {
        expect(refLabel({ ref: "feature", repo: { full_name: "fork-owner/widgets" } })).toBe("fork-owner:feature");
    });

    it("leaves the owner empty when the repository is gone", () => {
        expect(refLabel({ ref: "feature", repo: null })).toBe(":feature");
    });

    it("is null without a ref", () => {
        expect(refLabel({})).toBeNull();
        expect(refLabel(null)).toBeNull();
    });
});

describe("autoMergeInfo", () => {
    it("names the method and who armed it", () => {
        expect(autoMergeInfo({ auto_merge: { merge_method: "squash", enabled_by: { login: "alice" } } })).toEqual({
            method: "squash",
            enabledBy: "alice",
        });
    });

    it("is null while auto-merge is not armed", () => {
        expect(autoMergeInfo({ auto_merge: null })).toBeNull();
        expect(autoMergeInfo(undefined)).toBeNull();
    });
});

describe("stackName", () => {
    it("takes the Stack line nearest the base", () => {
        expect(
            stackName([
                { title: "Bottom", stackTrailer: null },
                { title: "Middle", stackTrailer: "lower name" },
                { title: "Top", stackTrailer: "upper name" },
            ]),
        ).toEqual({ text: "lower name", declared: true });
    });

    it("falls back to the bottom PR's title", () => {
        expect(stackName([{ title: "Bottom", stackTrailer: null }])).toEqual({ text: "Bottom", declared: false });
        expect(stackName([])).toBeNull();
    });
});

describe("buildStackIndex", () => {
    it("chains PRs whose base is another's head, bottom-up", () => {
        const index = buildStackIndex(
            [pull(3, "c", "b"), pull(1, "a", "main"), pull(2, "b", "a", { body: "Stack: gears" })],
            "acme/widgets",
        );
        const bottom = index.get(1);
        const stack = bottom?.stack;
        expect(stack?.ordered.map((node) => node.number)).toEqual([1, 2, 3]);
        expect(stack).toMatchObject({ id: 1, size: 3, maxDepth: 3, rootBaseRef: "main" });
        expect(stack?.name).toEqual({ text: "gears", declared: true });
        expect([1, 2, 3].map((n) => index.get(n)?.depth)).toEqual([1, 2, 3]);
        expect(index.get(3)?.parent?.number).toBe(2);
        expect(index.get(1)?.children.map((child) => child.number)).toEqual([2]);
        expect(index.get(2)?.stack).toBe(stack);
    });

    it("orders siblings by number and gives both the same depth", () => {
        const index = buildStackIndex(
            [pull(1, "a", "main"), pull(5, "e", "a"), pull(4, "d", "a"), pull(6, "f", "d")],
            "acme/widgets",
        );
        expect(index.get(1)?.stack?.ordered.map((node) => node.number)).toEqual([1, 4, 6, 5]);
        expect(index.get(4)?.depth).toBe(2);
        expect(index.get(5)?.depth).toBe(2);
        expect(index.get(1)?.stack?.maxDepth).toBe(3);
    });

    it("keeps unrelated PRs in stacks of one, named by their own title", () => {
        const index = buildStackIndex([pull(1, "a", "main"), pull(2, "b", "main")], "acme/widgets");
        expect(index.get(1)?.stack).not.toBe(index.get(2)?.stack);
        expect(index.get(2)?.stack).toMatchObject({ size: 1, id: 2, name: { text: "Change 2", declared: false } });
    });

    it("does not link a fork's branch to a same-named branch in the base repository", () => {
        const fork = pull(2, "b", "a");
        fork.base = { label: "someone:a", ref: "a", repo: { full_name: "acme/widgets", default_branch: "main" } };
        const index = buildStackIndex([pull(1, "a", "main"), fork], "acme/widgets");
        expect(index.get(2)?.parent).toBeNull();
    });

    it("cuts the link that closes a loop of retargeted branches", () => {
        const index = buildStackIndex([pull(1, "a", "b"), pull(2, "b", "a")], "acme/widgets");
        const stack = index.get(1)?.stack;
        expect(stack?.size).toBe(2);
        expect(stack?.ordered.map((node) => node.number)).toEqual([2, 1]);
        expect(index.get(2)?.parent).toBeNull();
        expect(index.get(1)?.parent?.number).toBe(2);
        expect(stack?.rootBaseRef).toBe("a");
    });

    it("copies what the list shows from the REST pull request", () => {
        const node = buildStackIndex(
            [
                pull(7, "wid-9-gears", "release-1", {
                    title: "Gears",
                    draft: true,
                    mergeable: false,
                    user: { login: "bob" },
                    requested_reviewers: [{ login: "alice" }],
                    auto_merge: { merge_method: "rebase", enabled_by: { login: "bob" } },
                }),
            ],
            "acme/widgets",
        ).get(7);
        expect(node).toMatchObject({
            title: "Gears",
            draft: true,
            conflicting: true,
            author: "bob",
            requestedReviewers: ["alice"],
            autoMerge: { method: "rebase", enabledBy: "bob" },
            defaultBranch: "main",
            baseRef: "release-1",
            headRef: "wid-9-gears",
            repoFullName: "acme/widgets",
            feature: { key: "ticket:WID-9", label: "WID-9", kind: "ticket" },
            headLabel: "acme:wid-9-gears",
            baseLabel: "acme:release-1",
        });
    });

    it("shows no conflict while GitHub is still computing mergeability", () => {
        expect(buildStackIndex([pull(1, "a", "main", { mergeable: null })], "acme/widgets").get(1)?.conflicting).toBe(
            false,
        );
    });
});

import { describe, expect, it } from "vitest";
import { featureKey } from "./feature.ts";
import { listOrder, neighbours } from "./listOrder.ts";
import { buildStackIndex, type StackNode } from "./stacks.ts";
import { pull } from "./testPulls.ts";

const NOW = Date.parse("2026-11-27T00:00:00Z");
const url = (repo: string, number: number) => `https://github.com/${repo}/pull/${number}`;

function mine(node: StackNode, extra: { isDraft?: boolean; updated_at?: string } = {}) {
    return {
        html_url: node.html_url,
        repoFullName: node.repoFullName,
        number: node.number,
        isDraft: false,
        updated_at: node.updated_at,
        feature: node.feature,
        stackNode: node,
        ...extra,
    };
}

function single(repo: string, number: number, title: string, updated_at: string) {
    return {
        html_url: url(repo, number),
        repoFullName: repo,
        number,
        isDraft: false,
        updated_at,
        feature: featureKey(title, `branch-${number}`, ""),
        stackNode: null,
    };
}

// widgets: the stack 1 <- 2 on bob's 9, and 3 on its own; gadgets: 21, sharing GEAR-5 with 3.
const index = buildStackIndex(
    [
        pull(9, "base", "main", { user: { login: "bob" } }),
        pull(1, "one", "base", { updated_at: "2026-11-25T00:00:00Z" }),
        pull(2, "two", "one", { updated_at: "2026-11-26T00:00:00Z" }),
        pull(3, "gear-5-three", "main", { title: "GEAR-5: three", updated_at: "2026-11-20T00:00:00Z" }),
    ],
    "acme/widgets",
);
const node = (number: number) => index.get(number) as StackNode;
const data = {
    mine: [
        mine(node(1)),
        mine(node(2)),
        mine(node(3)),
        single("acme/gadgets", 21, "GEAR-5: twenty-one", "2026-11-21T00:00:00Z"),
    ],
    waiting: [
        {
            html_url: url("acme/gadgets", 30),
            repoFullName: "acme/gadgets",
            isDraft: false,
            updated_at: "2026-11-24T00:00:00Z",
        },
        {
            html_url: url("acme/widgets", 40),
            repoFullName: "acme/widgets",
            isDraft: true,
            updated_at: "2026-11-26T00:00:00Z",
        },
    ],
    reviewed: [
        {
            html_url: url("acme/widgets", 50),
            repoFullName: "acme/widgets",
            isDraft: false,
            updated_at: "2026-11-26T00:00:00Z",
            myVerdict: "APPROVED" as const,
            updatedSinceReview: false,
        },
        {
            html_url: url("acme/widgets", 51),
            repoFullName: "acme/widgets",
            isDraft: false,
            updated_at: "2026-11-25T00:00:00Z",
            myVerdict: "CHANGES_REQUESTED" as const,
            updatedSinceReview: true,
        },
    ],
    repoNodes: [...index.values()],
};
const all = { status: "all" as const, age: "all" as const };

describe("listOrder", () => {
    it("follows the list by repo: stacks tip first, colleagues' PRs left out", () => {
        expect(listOrder(data, { tab: "mine", filters: all, grouping: "repo" }, NOW)).toEqual([
            url("acme/widgets", 2),
            url("acme/widgets", 1),
            url("acme/widgets", 3),
            url("acme/gadgets", 21),
        ]);
    });

    it("puts cross-repo sets first when grouped by feature", () => {
        expect(listOrder(data, { tab: "mine", filters: all, grouping: "feature" }, NOW)).toEqual([
            url("acme/gadgets", 21),
            url("acme/widgets", 3),
            url("acme/widgets", 2),
            url("acme/widgets", 1),
        ]);
    });

    it("follows the review tabs and the filters", () => {
        expect(listOrder(data, { tab: "reviews", filters: all, grouping: "repo" }, NOW)).toEqual([
            url("acme/widgets", 40),
            url("acme/gadgets", 30),
        ]);
        expect(
            listOrder(data, { tab: "reviews", filters: { status: "open", age: "all" }, grouping: "repo" }, NOW),
        ).toEqual([url("acme/gadgets", 30)]);
        expect(listOrder(data, { tab: "reviewed", filters: all, grouping: "repo" }, NOW)).toEqual([
            url("acme/widgets", 51),
            url("acme/widgets", 50),
        ]);
    });
});

describe("neighbours", () => {
    it("finds the PRs either side, and none past the ends or for a PR not listed", () => {
        const order = ["a", "b", "c"];
        expect(neighbours(order, "b")).toEqual({ previous: "a", next: "c" });
        expect(neighbours(order, "a")).toEqual({ previous: null, next: "b" });
        expect(neighbours(order, "z")).toEqual({ previous: null, next: null });
    });
});

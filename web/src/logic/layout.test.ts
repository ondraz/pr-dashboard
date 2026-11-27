import { describe, expect, it } from "vitest";
import { featureKey } from "./feature.ts";
import { applyFilters, byRepo } from "./filters.ts";
import { buildFeatureGroups, type LayoutPr, listLayout, type Row, unresolvedTotal } from "./layout.ts";
import { buildStackIndex, type StackNode } from "./stacks.ts";
import { pull } from "./testPulls.ts";

interface TestPr extends LayoutPr {
    title: string;
}

/** The viewer's PR, enriched with its stack node, as the dashboard lists it. */
function listed(node: StackNode): TestPr {
    return {
        repoFullName: node.repoFullName,
        number: node.number,
        title: node.title,
        updated_at: node.updated_at,
        feature: node.feature,
        stackNode: node,
    };
}

function rowSummary(rows: Row<TestPr>[]): unknown[] {
    return rows.map((row) =>
        row.kind === "pr"
            ? row.pr.number
            : row.members.map((member) => (member.kind === "pr" ? member.pr.number : `ctx:${member.node.number}`)),
    );
}

describe("applyFilters", () => {
    const now = Date.parse("2026-11-27T00:00:00Z");
    const prs = [
        { id: 1, isDraft: false, updated_at: "2026-11-26T00:00:00Z" },
        { id: 2, isDraft: true, updated_at: "2026-11-20T00:00:00Z" },
        { id: 3, isDraft: false, updated_at: "2026-11-01T00:00:00Z" },
    ];

    it("keeps everything with no filter", () => {
        expect(applyFilters(prs, { status: "all", age: "all" }, now).map((pr) => pr.id)).toEqual([1, 2, 3]);
    });

    it("splits ready from draft", () => {
        expect(applyFilters(prs, { status: "open", age: "all" }, now).map((pr) => pr.id)).toEqual([1, 3]);
        expect(applyFilters(prs, { status: "draft", age: "all" }, now).map((pr) => pr.id)).toEqual([2]);
    });

    it("keeps only the last two weeks when recent", () => {
        expect(applyFilters(prs, { status: "all", age: "recent" }, now).map((pr) => pr.id)).toEqual([1, 2]);
    });
});

describe("byRepo", () => {
    it("orders repositories and their PRs newest first", () => {
        const groups = byRepo([
            { repoFullName: "acme/a", updated_at: "2026-11-01T00:00:00Z", n: 1 },
            { repoFullName: "acme/b", updated_at: "2026-11-05T00:00:00Z", n: 2 },
            { repoFullName: "acme/a", updated_at: "2026-11-10T00:00:00Z", n: 3 },
        ]);
        expect(groups.map(([repo, prs]) => [repo, prs.map((pr) => pr.n)])).toEqual([
            ["acme/a", [3, 1]],
            ["acme/b", [2]],
        ]);
    });
});

describe("listLayout by repo", () => {
    // 10 <- 11 <- 12 is a stack whose bottom is a colleague's PR; 13 stands alone.
    const index = buildStackIndex(
        [
            pull(10, "base-work", "main", { user: { login: "bob" }, updated_at: "2026-11-10T00:00:00Z" }),
            pull(11, "mid", "base-work", { updated_at: "2026-11-12T00:00:00Z" }),
            pull(12, "tip", "mid", { updated_at: "2026-11-22T00:00:00Z" }),
            pull(13, "solo", "main", { updated_at: "2026-11-15T00:00:00Z" }),
        ],
        "acme/widgets",
    );
    const mine = [11, 12, 13].map((n) => listed(index.get(n) as StackNode));

    it("draws a stack once, tip first, with the colleague's PR as context", () => {
        const layout = listLayout(mine, [...index.values()], "repo");
        expect(layout.features).toEqual([]);
        expect(layout.repos).toHaveLength(1);
        const body = layout.repos[0]?.body;
        expect(rowSummary(body?.rows ?? [])).toEqual([[12, 11, "ctx:10"], 13]);
        expect(body?.drawn.map((pr) => pr.number)).toEqual([12, 11, 13]);
    });

    it("shows a filtered-out member of the viewer's stack as context", () => {
        const layout = listLayout(
            mine.filter((pr) => pr.number !== 11),
            [...index.values()],
            "repo",
        );
        expect(rowSummary(layout.repos[0]?.body.rows ?? [])).toEqual([[12, "ctx:11", "ctx:10"], 13]);
    });
});

describe("feature grouping", () => {
    function single(repo: string, number: number, title: string, head: string, updated_at: string, login = "alice") {
        const pr = pull(number, head, "main", { title, updated_at, user: { login } });
        pr.html_url = `https://github.com/${repo}/pull/${number}`;
        return buildStackIndex([pr], repo).get(number) as StackNode;
    }

    const api = single("acme/api", 1, "GEAR-5: add the endpoint", "gear-5-endpoint", "2026-11-20T00:00:00Z");
    const web = single("acme/web", 2, "GEAR-5: call the endpoint", "gear-5-call", "2026-11-21T00:00:00Z");
    const lone = single("acme/web", 3, "GEAR-6: unrelated", "gear-6", "2026-11-22T00:00:00Z");
    const colleague = single("acme/infra", 4, "GEAR-5: provision", "gear-5-infra", "2026-11-19T00:00:00Z", "bob");
    const mine = [api, web, lone].map(listed);

    it("groups a key the viewer holds in two repositories, with colleagues' parts as context", () => {
        const groups = buildFeatureGroups(mine, [api, web, lone, colleague]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ key: "ticket:GEAR-5", label: "GEAR-5", kind: "ticket" });
        expect(groups[0]?.prs.map((pr) => pr.number)).toEqual([1, 2]);
        expect(groups[0]?.context.map((node) => node.number)).toEqual([4]);
        expect([...(groups[0]?.repos ?? [])]).toEqual(["acme/api", "acme/web", "acme/infra"]);
    });

    it("does not form a group from one repository", () => {
        expect(buildFeatureGroups([listed(lone)], [lone])).toEqual([]);
    });

    it("puts the groups first and the rest by repo when grouping by feature", () => {
        const layout = listLayout(mine, [api, web, lone, colleague], "feature");
        expect(layout.features).toHaveLength(1);
        const block = layout.features[0];
        expect(block?.sections.map((section) => section.repo)).toEqual(["acme/web", "acme/api", "acme/infra"]);
        expect(block?.sections[2]?.context.map((node) => node.number)).toEqual([4]);
        expect(block?.prCount).toBe(3);
        expect(block?.drawn.map((pr) => pr.number)).toEqual([2, 1]);
        expect(layout.repos.map(({ repo, body }) => [repo, rowSummary(body.rows)])).toEqual([["acme/web", [3]]]);
        expect(layout.featureSpan.get("ticket:GEAR-5")).toBe(3);
    });

    it("keeps every PR in the repo view when grouping by repo, with the span for the badge", () => {
        const layout = listLayout(mine, [api, web, lone, colleague], "repo");
        expect(layout.features).toEqual([]);
        expect(layout.repos.map(({ repo }) => repo)).toEqual(["acme/web", "acme/api"]);
        expect(layout.featureSpan.get("ticket:GEAR-5")).toBe(3);
    });

    it("reads the same key from a Part-of line in different repositories", () => {
        expect(featureKey("One", "x", "Part-of: Big Move")?.key).toBe(featureKey("Two", "y", "part-of: big move")?.key);
    });
});

describe("unresolvedTotal", () => {
    it("adds up what each PR owes", () => {
        expect(unresolvedTotal([{ unresolved: 2 }, {}, { unresolved: 1 }])).toBe(3);
    });
});

import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChangeFingerprint } from "../logic/fingerprint.ts";
import { listLayout } from "../logic/layout.ts";
import { waitingState } from "../logic/reviews.ts";
import { createGitHubClient } from "./client.ts";
import { fetchViewerLogin, loadDashboard } from "./dashboard.ts";
import { batchPullRequest, pullJson, review, searchHit, thread } from "./testFixtures.ts";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);

// alice's own PRs: a stack 11 <- 12 in widgets on top of bob's 10, and GEAR-5 spread over widgets
// (13) and gadgets (21). She was asked to review bob's gadgets#30 and reviewed carol's widgets#40.
const mineHits = [
    searchHit("acme/widgets", 12, { updated_at: "2026-11-26T10:00:00Z" }),
    searchHit("acme/widgets", 11),
    searchHit("acme/widgets", 13, { title: "GEAR-5: add the endpoint" }),
    searchHit("acme/gadgets", 21, { title: "GEAR-5: call the endpoint" }),
];
const pulls: Record<string, ReturnType<typeof pullJson>> = {
    "acme/widgets#10": pullJson("acme/widgets", 10, "base-work", "main", { user: { login: "bob" } }),
    "acme/widgets#11": pullJson("acme/widgets", 11, "mid", "base-work"),
    "acme/widgets#12": pullJson("acme/widgets", 12, "tip", "mid", { auto_merge: { merge_method: "squash" } }),
    "acme/widgets#13": pullJson("acme/widgets", 13, "gear-5-endpoint", "main", { title: "GEAR-5: add the endpoint" }),
    "acme/gadgets#30": pullJson("acme/gadgets", 30, "bobs-fix", "main", { user: { login: "bob" } }),
    "acme/widgets#40": pullJson("acme/widgets", 40, "carols-fix", "main", { user: { login: "carol" }, draft: true }),
};
const reviews: Record<string, ReturnType<typeof review>[]> = {
    "acme/widgets#11": [review("bob", "APPROVED", "mid-sha")],
    "acme/gadgets#30": [review("alice", "CHANGES_REQUESTED", "older-sha")],
    "acme/widgets#40": [review("alice", "COMMENTED", "carols-fix-sha"), review("alice", "APPROVED", "carols-fix-sha")],
};
const threads: Record<string, ReturnType<typeof thread>[]> = {
    "acme/widgets#12": [thread(false, "bob", "bob"), thread(true, "bob", "bob")],
    "acme/gadgets#30": [thread(false, "alice", "bob")],
};

// Every REST read of a PR's details or reviews, which the batched query is meant to keep down.
const restReads: string[] = [];

const server = setupServer(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "alice" })),
    http.get(`${API}/search/issues`, ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams.get("q") ?? "";
        if (q.includes("author:alice") && !q.includes("-author")) {
            // Two pages, to show the search follows GitHub's Link header.
            const page = Number(url.searchParams.get("page") ?? 1);
            const items = page === 1 ? mineHits.slice(0, 3) : mineHits.slice(3);
            const next = new URL(url);
            next.searchParams.set("page", "2");
            return HttpResponse.json(
                { total_count: mineHits.length, incomplete_results: false, items },
                page === 1 ? { headers: { link: `<${next}>; rel="next"` } } : {},
            );
        }
        if (q.includes("review-requested:alice") && !q.includes("-review-requested")) {
            return HttpResponse.json({
                total_count: 1,
                incomplete_results: false,
                items: [searchHit("acme/gadgets", 30)],
            });
        }
        return HttpResponse.json({ total_count: 1, incomplete_results: false, items: [searchHit("acme/widgets", 40)] });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ params }) => {
        restReads.push(`details ${params.owner}/${params.repo}#${params.number}`);
        const found = pulls[`${params.owner}/${params.repo}#${params.number}`];
        return found ? HttpResponse.json(found) : HttpResponse.json({ message: "Server Error" }, { status: 500 });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews`, ({ params }) => {
        restReads.push(`reviews ${params.owner}/${params.repo}#${params.number}`);
        return HttpResponse.json(reviews[`${params.owner}/${params.repo}#${params.number}`] ?? []);
    }),
    http.get(`${API}/repos/:owner/:repo/pulls`, ({ params, request }) => {
        const head = new URL(request.url).searchParams.get("head");
        const repo = `${params.owner}/${params.repo}`;
        return HttpResponse.json(
            Object.values(pulls).filter((pr) => pr.head.label === head && pr.html_url.includes(repo)),
        );
    }),
    github.query("OutstandingWorkBatch", ({ variables }) => {
        const data: Record<string, unknown> = {};
        for (let n = 0; `number${n}` in variables; n++) {
            const key = `${variables[`owner${n}`]}/${variables[`name${n}`]}#${variables[`number${n}`]}`;
            const viewer = variables.withViewer ? String(variables.viewer) : null;
            data[`pr${n}`] = {
                pullRequest: batchPullRequest(pulls[key], reviews[key] ?? [], threads[key] ?? [], viewer),
            };
        }
        return HttpResponse.json({ data });
    }),
    github.query("ChangeProbe", () =>
        HttpResponse.json({
            data: {
                mine: { issueCount: 0, nodes: [] },
                requested: { issueCount: 0, nodes: [] },
                reviewed: { issueCount: 0, nodes: [] },
            },
        }),
    ),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
    restReads.length = 0;
    server.resetHandlers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("fetchViewerLogin", () => {
    it("reads the token's user", async () => {
        expect(await fetchViewerLogin(createGitHubClient({ token: "t" }))).toBe("alice");
    });
});

describe("loadDashboard", () => {
    it("loads all three tabs with stacks, reviews and unresolved counts", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const messages: string[] = [];
        const data = await loadDashboard(createGitHubClient({ token: "t" }), "alice", {
            onProgress: (message) => messages.push(message),
            fingerprint: new ChangeFingerprint(),
        });

        expect(data.mine.map((pr) => `${pr.repoFullName}#${pr.number}`)).toEqual([
            "acme/widgets#12",
            "acme/widgets#11",
            "acme/widgets#13",
            "acme/gadgets#21",
        ]);
        const [tip, mid, endpoint, call] = data.mine;
        expect(tip?.stackNode?.stack?.ordered.map((node) => node.number)).toEqual([10, 11, 12]);
        expect(tip).toMatchObject({
            reviewState: "PENDING",
            autoMerge: { method: "squash", enabledBy: "" },
            unresolved: 1,
            unresolvedThreads: 1,
            mergeQueue: null,
        });
        expect(mid).toMatchObject({ reviewState: "APPROVED", unresolved: 0 });
        expect(data.repoNodes.find((node) => node.number === 10)?.author).toBe("bob");

        // gadgets#21's details failed: it leaves the stacks but keeps its title's feature key.
        expect(call).toMatchObject({ stackNode: null, feature: { key: "ticket:GEAR-5" } });
        expect(warn).toHaveBeenCalledWith("Failed to fetch details for acme/gadgets#21:", expect.anything());
        const layout = listLayout(data.mine, data.repoNodes, "feature");
        expect(layout.features[0]?.sections.map((section) => section.repo)).toEqual(["acme/widgets", "acme/gadgets"]);
        expect(endpoint?.feature?.label).toBe("GEAR-5");

        expect(data.waiting).toHaveLength(1);
        const waiting = data.waiting[0];
        expect(waiting).toMatchObject({
            myVerdict: "CHANGES_REQUESTED",
            updatedSinceReview: true,
            lastReviewSha: "older-sha",
            headSha: "bobs-fix-sha",
            threadsLoaded: true,
            myOpenThreads: 1,
            myReplies: 1,
        });
        expect(waiting && waitingState(waiting)).toBe("rereview");

        expect(data.reviewed).toHaveLength(1);
        expect(data.reviewed[0]).toMatchObject({ myVerdict: "APPROVED", updatedSinceReview: false, isDraft: true });

        expect(data.fingerprint).toBe(
            JSON.stringify([
                [0, []],
                [0, []],
                [0, []],
            ]),
        );
        expect(messages[0]).toBe("Searching pull requests…");
        expect(messages).toContain("Loading… repositories 0/2 · comments 0/4");

        // REST reads only the details stacks need; reviews, draft state and heads come with the batch.
        expect(restReads.sort()).toEqual([
            "details acme/gadgets#21",
            "details acme/widgets#11",
            "details acme/widgets#12",
            "details acme/widgets#13",
        ]);
    });

    it("loads without unresolved counts when GraphQL fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        server.use(http.post(`${API}/graphql`, () => HttpResponse.json({ message: "Bad gateway" }, { status: 502 })));
        const data = await loadDashboard(createGitHubClient({ token: "t" }), "alice");
        expect(data.mine.every((pr) => pr.unresolved === 0)).toBe(true);
        expect(data.waiting[0]).toMatchObject({ threadsLoaded: false, myOpenThreads: 0, myVerdict: "UNKNOWN" });
        expect(data.reviewed[0]).toMatchObject({ myVerdict: "UNKNOWN" });
        expect(data.fingerprint).toBeNull();
        expect(warn).toHaveBeenCalledWith("Failed to read unresolved review state:", expect.anything());
    });

    it("fails when a search fails", async () => {
        server.use(
            http.get(`${API}/search/issues`, () =>
                HttpResponse.json({ message: "Validation Failed" }, { status: 422 }),
            ),
        );
        await expect(loadDashboard(createGitHubClient({ token: "t" }), "alice")).rejects.toMatchObject({ status: 422 });
    });
});

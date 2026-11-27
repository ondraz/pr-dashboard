// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthApi } from "../app/auth.ts";
import { pullRequestFields, pullRequestResponse, reviewThread } from "../github/prFixtures.ts";
import type { PullRequestFields, ReviewThread } from "../github/pullRequest.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const HEAD = "c0ffee00c0ffee";
const BATCH = "draft:acme/widgets#12:suggestions";

const GEARS = "const teeth = 12;\nconst ratio = 3;\nconst spin = true;\nexport { teeth };\n";

const signedIn: AuthApi = {
    token: async () => ({ status: "signed-in", accessToken: "ghu_test", expiresAt: Date.now() + 8 * 3_600_000 }),
    start: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    signOut: async () => {},
};

let fields: PullRequestFields;
let threads: ReviewThread[];
let refUpdate: { status: number; message?: string };
const calls: { name: string; body: unknown }[] = [];

/** A thread on `line` (from `startLine`) of src/gears.ts whose one comment suggests `lines`. */
function suggesting(
    id: string,
    line: number,
    startLine: number | null,
    lines: string[],
    extra: Partial<ReviewThread> = {},
) {
    const body = `Maybe:\n\`\`\`suggestion\n${lines.join("\n")}\n\`\`\``;
    const thread = reviewThread(id, "PRR_carol", [{ login: "carol", bodyHTML: "<p>Maybe:</p>" }], {
        line,
        originalLine: line,
        startLine,
        ...extra,
    });
    const [comment] = thread.comments.nodes ?? [];
    return { ...thread, comments: { ...thread.comments, nodes: comment ? [{ ...comment, body }] : [] } };
}

const server = setupServer(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "bob" })),
    http.get(`${API}/search/issues`, () => HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] })),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
    ),
    github.query("ChangeProbe", () =>
        HttpResponse.json({
            data: {
                mine: { issueCount: 0, nodes: [] },
                requested: { issueCount: 0, nodes: [] },
                reviewed: { issueCount: 0, nodes: [] },
            },
        }),
    ),
    github.query("PullRequestDetail", () => HttpResponse.json(pullRequestResponse(fields, [], threads))),
    github.query("SuggestionTree", ({ variables }) => {
        calls.push({ name: "SuggestionTree", body: variables });
        return HttpResponse.json({
            data: {
                repository: {
                    commit: { tree: { oid: "tree-sha", entries: [{ name: "src", mode: 0o40000 }] } },
                    dir: { entries: [{ name: "gears.ts", mode: 0o100644 }] },
                },
            },
        });
    }),
    http.get(`${API}/repos/:owner/:repo/contents/*`, ({ request }) => {
        const url = new URL(request.url);
        calls.push({
            name: "GET contents",
            body: `${url.pathname.split("/contents/")[1]}@${url.searchParams.get("ref")}`,
        });
        return HttpResponse.text(GEARS);
    }),
    http.post(`${API}/repos/:owner/:repo/git/trees`, async ({ request }) => {
        calls.push({ name: "POST trees", body: await request.json() });
        return HttpResponse.json({ sha: "new-tree" }, { status: 201 });
    }),
    http.post(`${API}/repos/:owner/:repo/git/commits`, async ({ request }) => {
        calls.push({ name: "POST commits", body: await request.json() });
        return HttpResponse.json({ sha: "new-commit" }, { status: 201 });
    }),
    http.patch(`${API}/repos/:owner/:repo/git/refs/*`, async ({ request }) => {
        calls.push({ name: `PATCH ${new URL(request.url).pathname.split("/git/")[1]}`, body: await request.json() });
        if (refUpdate.status !== 200) {
            return HttpResponse.json({ message: refUpdate.message }, { status: refUpdate.status });
        }
        fields = { ...fields, headRefOid: "new-commit" };
        threads = threads.map((thread) => ({ ...thread, isOutdated: true, line: null }));
        return HttpResponse.json({ ref: "refs/heads/tip", object: { sha: "new-commit" } });
    }),
    github.mutation("ResolveThread", ({ variables }) => {
        calls.push({ name: "ResolveThread", body: variables });
        return HttpResponse.json({ data: { resolveReviewThread: { thread: { id: String(variables.threadId) } } } });
    }),
);

const queryClients: QueryClient[] = [];

function open(auth: AuthApi = signedIn) {
    const app = renderApp("/acme/widgets/pull/12", {
        auth,
        fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }),
    });
    queryClients.push(app.queryClient);
    return app;
}

const callsOf = (name: string) => calls.filter((call) => call.name === name).map((call) => call.body);
const threadAt = async (where: string) =>
    (await screen.findByText(`src/gears.ts${where}`)).closest("details") as HTMLElement;

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    fields = pullRequestFields({ headRefOid: HEAD, headRefName: "feature/gears" });
    threads = [
        suggesting("T_1", 3, 2, ["const ratio = 4;", "const spin = false;"]),
        suggesting("T_2", 4, null, ["export { teeth, ratio };"]),
    ];
    refUpdate = { status: 200 };
    calls.length = 0;
});
afterEach(async () => {
    await waitFor(() => expect(queryClients.every((client) => client.isFetching() === 0)).toBe(true));
    for (const client of queryClients.splice(0)) client.clear();
    cleanup();
    server.resetHandlers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("committing suggestions", () => {
    it("commits one suggestion on top of the head the page shows, then resolves its thread", async () => {
        open();
        const thread = await threadAt(":2-3");
        fireEvent.click(within(thread).getByRole("button", { name: "Commit suggestion" }));
        const form = within(thread).getByRole("form", { name: "Commit suggestion" });
        expect((within(form).getByRole("textbox", { name: "Commit headline" }) as HTMLInputElement).value).toBe(
            "Update gears.ts",
        );
        expect(callsOf("POST trees")).toEqual([]);
        fireEvent.click(within(form).getByRole("button", { name: "Commit changes" }));

        await waitFor(() => expect(callsOf("ResolveThread")).toEqual([{ threadId: "T_1" }]));
        expect(callsOf("SuggestionTree")).toEqual([
            { owner: "acme", name: "widgets", commit: HEAD, dir: `${HEAD}:src`, nested: true },
        ]);
        expect(callsOf("GET contents")).toEqual([`src/gears.ts@${HEAD}`]);
        expect(callsOf("POST trees")).toEqual([
            {
                base_tree: "tree-sha",
                tree: [
                    {
                        path: "src/gears.ts",
                        mode: "100644",
                        type: "blob",
                        content: "const teeth = 12;\nconst ratio = 4;\nconst spin = false;\nexport { teeth };\n",
                    },
                ],
            },
        ]);
        expect(callsOf("POST commits")).toEqual([{ message: "Update gears.ts", tree: "new-tree", parents: [HEAD] }]);
        expect(callsOf("PATCH refs/heads/feature/gears")).toEqual([{ sha: "new-commit", force: false }]);
        await waitFor(() => expect(screen.queryByRole("button", { name: "Commit suggestion" })).toBeNull());
    });

    it("gathers suggestions into a batch that survives a reload, and commits them as one", async () => {
        open();
        fireEvent.click(within(await threadAt(":2-3")).getByRole("button", { name: "Add suggestion to batch" }));
        const second = await threadAt(":4");
        expect(within(second).queryByRole("button", { name: "Commit suggestion" })).toBeNull();
        fireEvent.click(within(second).getByRole("button", { name: "Add suggestion to batch" }));
        cleanup();

        open();
        const batch = await screen.findByRole("region", { name: "Suggestion batch" });
        expect(within(batch).getByText("2 suggestions in a batch")).toBeTruthy();
        expect(within(await threadAt(":4")).getByRole("button", { name: "Remove from batch" })).toBeTruthy();
        fireEvent.click(within(batch).getByRole("button", { name: "Commit suggestions" }));
        const form = within(batch).getByRole("form", { name: "Commit 2 suggestions" });
        const headline = within(form).getByRole("textbox", { name: "Commit headline" }) as HTMLInputElement;
        expect(headline.value).toBe("Apply suggestions from code review");
        fireEvent.change(within(form).getByRole("textbox", { name: "Extended description" }), {
            target: { value: "Both from review." },
        });
        fireEvent.click(within(form).getByRole("button", { name: "Commit changes" }));

        await waitFor(() => expect(callsOf("ResolveThread")).toHaveLength(2));
        expect(callsOf("GET contents")).toHaveLength(1);
        expect(callsOf("POST trees")).toEqual([
            expect.objectContaining({
                tree: [
                    expect.objectContaining({
                        content: "const teeth = 12;\nconst ratio = 4;\nconst spin = false;\nexport { teeth, ratio };\n",
                    }),
                ],
            }),
        ]);
        expect(callsOf("POST commits")).toEqual([
            expect.objectContaining({ message: "Apply suggestions from code review\n\nBoth from review." }),
        ]);
        await waitFor(() => expect(screen.queryByRole("region", { name: "Suggestion batch" })).toBeNull());
        expect(localStorage.getItem(BATCH)).toBeNull();
    });

    it("drops a batched suggestion whose thread was resolved since, and commits the rest alone again", async () => {
        threads = [suggesting("T_1", 3, 2, ["x"], { isResolved: true }), suggesting("T_2", 4, null, ["y"])];
        localStorage.setItem(BATCH, JSON.stringify(["T_1_c0"]));
        open();
        const thread = await threadAt(":4");
        expect(within(thread).getByRole("button", { name: "Commit suggestion" })).toBeTruthy();
        expect(screen.queryByRole("region", { name: "Suggestion batch" })).toBeNull();
        fireEvent.click(within(thread).getByRole("button", { name: "Add suggestion to batch" }));
        expect(localStorage.getItem(BATCH)).toBe(JSON.stringify(["T_2_c0"]));
    });

    it("leaves the branch alone and keeps the batch when someone pushed meanwhile", async () => {
        refUpdate = { status: 422, message: "Update is not a fast forward" };
        localStorage.setItem(BATCH, JSON.stringify(["T_1_c0"]));
        open();
        const batch = await screen.findByRole("region", { name: "Suggestion batch" });
        fireEvent.click(within(batch).getByRole("button", { name: "Commit suggestions" }));
        fireEvent.click(within(batch).getByRole("button", { name: "Commit changes" }));

        expect(await within(batch).findByText(/Update is not a fast forward/)).toBeTruthy();
        expect(callsOf("ResolveThread")).toEqual([]);
        expect(localStorage.getItem(BATCH)).toBe(JSON.stringify(["T_1_c0"]));
        expect(screen.queryByText(/GitHub refused a change/)).toBeNull();
    });

    it("offers nothing to commit from outdated or resolved threads, a fork, or a read-only token", async () => {
        threads = [
            suggesting("T_1", 3, 2, ["x"], { isResolved: true }),
            suggesting("T_2", 4, null, ["y"], { isOutdated: true }),
        ];
        const { unmount } = open();
        await threadAt(":4");
        expect(screen.queryByRole("button", { name: /suggestion/ })).toBeNull();
        unmount();

        threads = [suggesting("T_1", 3, 2, ["x"])];
        fields = { ...fields, isCrossRepository: true };
        const fork = open();
        await threadAt(":2-3");
        expect(screen.queryByRole("button", { name: /suggestion/ })).toBeNull();
        fork.unmount();

        fields = { ...fields, isCrossRepository: false };
        sessionStorage.setItem("gh_token", "ghp_test");
        open({ ...signedIn, token: async () => ({ status: "signed-out", configured: true }) });
        await threadAt(":2-3");
        expect(screen.queryByRole("button", { name: /suggestion/ })).toBeNull();
    });
});

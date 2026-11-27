// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrSession } from "../../../shared/sessions.ts";
import type { Services } from "../app/services.tsx";
import {
    actor,
    checkAnnotation,
    checkRun,
    commitChecksResponse,
    pullCommit,
    pullRequestFields,
    pullRequestResponse,
    reviewThread,
    statusContext,
    timeline,
} from "../github/prFixtures.ts";
import { pullJson, searchHit } from "../github/testFixtures.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const NOW = new Date("2026-11-27T12:00:00Z");
const PR_URL = "https://github.com/acme/widgets/pull/12";

// alice's widgets#12: bob asked for changes in two threads, one since resolved, and alice answered
// the other; carol commented after alice force-pushed. It sits on bob's #11 and carol's #14 sits on
// it; alice's gadgets#13 comes after it in the list.
const fields = pullRequestFields({
    bodyHTML: '<p>Turns them.</p><script>window.stolen = true</script><a href="https://example.com/spec">spec</a>',
    autoMergeRequest: { mergeMethod: "SQUASH", enabledBy: { login: "alice" } },
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    reviewDecision: "CHANGES_REQUESTED",
    reviewRequests: { nodes: [{ requestedReviewer: { login: "dave" } }] },
    latestReviews: {
        nodes: [{ id: "PRR_1", state: "CHANGES_REQUESTED", submittedAt: "2026-11-25T11:00:00Z", author: actor("bob") }],
    },
    closingIssuesReferences: {
        nodes: [
            {
                number: 7,
                title: "Gears slip",
                url: "https://github.com/acme/widgets/issues/7",
                state: "OPEN",
                repository: { nameWithOwner: "acme/widgets" },
            },
        ],
    },
});
const restPulls = {
    11: pullJson("acme/widgets", 11, "mid", "main", { title: "Mount the gears", user: { login: "bob" } }),
    12: pullJson("acme/widgets", 12, "tip", "mid", { title: "Turn the gears" }),
    14: pullJson("acme/widgets", 14, "paint", "tip", { title: "Paint the gears", user: { login: "carol" } }),
};
const openThread = reviewThread("T_1", "PRR_1", [
    { login: "bob", bodyHTML: "<p>Why 3?</p>" },
    { login: "alice", bodyHTML: "<p>It meshes.</p>", reviewId: "PRR_2" },
]);
const resolvedThread = reviewThread("T_2", "PRR_1", [{ login: "bob", bodyHTML: "<p>Typo.</p>" }], {
    isResolved: true,
    path: "README.md",
    line: 3,
});
const firstTimelinePage = [
    timeline.reviewRequested("RR_1", "bob"),
    timeline.labeled("LE_1", "backend"),
    timeline.commit("aaaaaaa1111", "Cut the teeth"),
    timeline.commit("bbbbbbb2222", "Oil the axle"),
    timeline.review("PRR_1", "bob", "CHANGES_REQUESTED", "<p>A few things.</p>"),
];
const secondTimelinePage = [
    timeline.review("PRR_2", "alice", "COMMENTED"),
    timeline.forcePush("FP_1", "bbbbbbb", "ccccccc"),
    timeline.comment("IC_1", "carol", "<p>Looks close.</p>"),
    timeline.renamed("RT_1", "Turn gears", "Turn the gears"),
];

const madeSession: PrSession = {
    id: "local_0f0f0f0f-0000-4000-8000-000000000000",
    title: "Gear work",
    archived: false,
    lastActivityAt: Date.parse("2026-11-26T12:00:00Z"),
};
const olderSession: PrSession = {
    id: "local_0e0e0e0e-0000-4000-8000-000000000000",
    title: "Gear spike",
    archived: true,
    lastActivityAt: Date.parse("2026-11-20T12:00:00Z"),
};
const reviewSession: PrSession = {
    id: "dddddddd-0000-4000-8000-000000000000",
    kind: "cli",
    title: "Review the gears",
    archived: false,
    lastActivityAt: Date.parse("2026-11-27T09:00:00Z"),
};

const otherRepoSession: PrSession = {
    id: "local_0d0d0d0d-0000-4000-8000-000000000000",
    title: "Axle work",
    archived: false,
    lastActivityAt: Date.parse("2026-11-27T11:00:00Z"),
};

let detailRequests = 0;
const checkRequests: Record<string, unknown>[] = [];

// tip-sha: the tests failed with an annotation, lint is still running, the build passed, the docs were
// skipped, and a required deploy status passed; the build and the status come on the second page.
const checksFirstPage = [
    checkRun("test", "FAILURE", { title: "1 test failed", summary: "gears.test.ts: turns once", isRequired: true }, [
        checkAnnotation("src/gears.ts", 12, "Expected 3 to be 4"),
    ]),
    checkRun("lint", null),
    checkRun("docs", "SKIPPED"),
];
const checksSecondPage = [checkRun("build", "SUCCESS"), statusContext("deploy", "SUCCESS")];

const handlers = [
    http.get(`${API}/user`, () => HttpResponse.json({ login: "alice" })),
    http.get(`${API}/search/issues`, ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        const items = q.startsWith("is:pr is:open author:alice")
            ? [
                  searchHit("acme/widgets", 12, { title: "Turn the gears" }),
                  searchHit("acme/gadgets", 13, { title: "Polish the knobs", updated_at: "2026-11-24T10:00:00Z" }),
              ]
            : [];
        return HttpResponse.json({ total_count: items.length, incomplete_results: false, items });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ params }) => {
        const found = params.repo === "widgets" && restPulls[Number(params.number) as keyof typeof restPulls];
        return found ? HttpResponse.json(found) : HttpResponse.json({ message: "Not Found" }, { status: 404 });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls`, ({ params, request }) => {
        const query = new URL(request.url).searchParams;
        const head = query.get("head");
        const base = query.get("base");
        const open = params.repo === "widgets" ? Object.values(restPulls) : [];
        return HttpResponse.json(
            open.filter((pr) => (head ? pr.head.label === head : true) && (base ? pr.base.ref === base : true)),
        );
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews`, () => HttpResponse.json([])),
    github.query("OutstandingWorkBatch", () => HttpResponse.json({ data: {} })),
    github.query("ChangeProbe", () =>
        HttpResponse.json({
            data: {
                mine: { issueCount: 0, nodes: [] },
                requested: { issueCount: 0, nodes: [] },
                reviewed: { issueCount: 0, nodes: [] },
            },
        }),
    ),
    github.query("PullRequestDetail", ({ variables }) => {
        detailRequests++;
        if (variables.number !== 12) {
            return HttpResponse.json({
                data: { repository: { pullRequest: null } },
                errors: [{ message: "Could not resolve to a PullRequest" }],
            });
        }
        return HttpResponse.json(
            pullRequestResponse(fields, firstTimelinePage, [openThread], {
                timelineCursor: "T2",
                threadCursor: "R2",
            }),
        );
    }),
    github.query("PullRequestTimelinePage", ({ variables }) => {
        expect(variables.after).toBe("T2");
        return HttpResponse.json({
            data: {
                repository: {
                    pullRequest: {
                        timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: secondTimelinePage },
                    },
                },
            },
        });
    }),
    github.query("ReviewThreadDetailPage", ({ variables }) => {
        expect(variables.after).toBe("R2");
        return HttpResponse.json({
            data: {
                repository: {
                    pullRequest: {
                        reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [resolvedThread] },
                    },
                },
            },
        });
    }),
    github.query("CommitChecks", ({ variables }) => {
        checkRequests.push(variables);
        return HttpResponse.json(
            variables.after === null
                ? commitChecksResponse(checksFirstPage, "FAILURE", "C2")
                : commitChecksResponse(checksSecondPage, "FAILURE"),
        );
    }),
    github.query("PullRequestCommits", () =>
        HttpResponse.json({
            data: {
                repository: {
                    pullRequest: {
                        commits: {
                            totalCount: 2,
                            pageInfo: { hasNextPage: false, endCursor: null },
                            nodes: [
                                { commit: pullCommit("aaaaaaa1111", "Cut the teeth") },
                                { commit: pullCommit("bbbbbbb2222", "Oil the axle", "bob") },
                            ],
                        },
                    },
                },
            },
        }),
    ),
];

const server = setupServer(...handlers);
const queryClients: QueryClient[] = [];

function open(path: string, services: Partial<Services> = {}) {
    const app = renderApp(path, {
        fetchSessions: async () => ({
            made: new Map([[PR_URL, [madeSession, olderSession]]]),
            reviewed: new Map([[PR_URL, [reviewSession]]]),
            // The repository's own sessions: the one that made the PR again, and another one.
            repos: new Map([["acme/widgets", { folder: "/work/widgets", sessions: [madeSession, otherRepoSession] }]]),
        }),
        ...services,
    });
    queryClients.push(app.queryClient);
    return app;
}

const heading = () => screen.findByRole("heading", { level: 1, name: /Turn the gears/ });

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    sessionStorage.setItem("gh_token", "ghp_test");
    detailRequests = 0;
    checkRequests.length = 0;
});
afterEach(async () => {
    await waitFor(() => expect(queryClients.every((client) => client.isFetching() === 0)).toBe(true));
    for (const client of queryClients.splice(0)) client.clear();
    cleanup();
    server.resetHandlers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("PR page", () => {
    it("opens a PR at its GitHub path with its header and every badge the list gives it", async () => {
        open("/acme/widgets/pull/12");
        const title = await heading();
        expect(title.textContent).toContain("#12");
        expect(within(title).getByRole("link", { name: "Open #12 on GitHub" }).getAttribute("href")).toBe(PR_URL);

        const subhead = document.querySelector(".pr-subhead") as HTMLElement;
        expect(within(subhead).getByText("Open").className).toBe("state-pill open");
        expect(subhead.textContent).toContain("alice wants to merge 2 commits into mid from tip");
        expect(within(subhead).getByText("Auto-merge").title).toBe(
            "Auto-merge enabled (squash) by alice - merges on its own once checks and reviews pass",
        );
        expect(within(subhead).getByText("Conflicts")).toBeTruthy();
        expect((await within(subhead).findByTitle("Level 2 of 3 in this stack")).textContent).toBe("2/3");
        // Only the open thread counts; the resolved one came on the second page.
        await waitFor(() => expect(within(subhead).getByText("1 unresolved")).toBeTruthy());
        expect(
            (
                await within(subhead).findByRole("link", { name: /Open the Claude session that made this PR/ })
            ).getAttribute("href"),
        ).toBe(`claude://claude.ai/epitaxy/${madeSession.id}`);

        expect(screen.getByRole("link", { name: "Conversation" }).getAttribute("aria-current")).toBe("page");
        const checksTab = screen.getByRole("link", { name: /Checks/ });
        expect(checksTab.getAttribute("href")).toBe("/acme/widgets/pull/12/checks");
        expect(checksTab.textContent).toBe("Checks 4");
        expect(screen.getByRole("link", { name: /Files changed/ }).getAttribute("href")).toBe(
            "/acme/widgets/pull/12/files",
        );
    });

    it("shows the description and the whole timeline, with each review's threads", async () => {
        open("/acme/widgets/pull/12");
        await heading();
        const conversation = document.querySelector(".conversation") as HTMLElement;

        // The description is sanitised, and its links leave the app.
        expect(within(conversation).getByText("Turns them.")).toBeTruthy();
        expect(conversation.querySelector("script")).toBeNull();
        expect(within(conversation).getByRole("link", { name: "spec" }).getAttribute("target")).toBe("_blank");

        const events = [...conversation.querySelectorAll(".timeline-event")].map((event) =>
            event.textContent?.replace(/\s+/g, " ").trim(),
        );
        expect(events).toEqual([
            "alice requested a review from bob 2d ago",
            "alice added the backend label 2d ago",
            "alice added 2 commits",
            "bob requested changes 2d ago",
            "alice force-pushed the branch from bbbbbbb to ccccccc 2d ago",
            "alice changed the title Turn gears Turn the gears 2d ago",
        ]);

        const review = conversation.querySelector(".timeline-review") as HTMLElement;
        expect(within(review).getByText("A few things.")).toBeTruthy();
        const threads = review.querySelectorAll("details.thread");
        expect(threads).toHaveLength(2);
        const [unresolved, resolved] = threads as unknown as HTMLDetailsElement[];
        expect(unresolved?.open).toBe(true);
        expect(unresolved?.querySelector("summary")?.textContent).toBe("src/gears.ts:12");
        expect(within(unresolved as HTMLElement).getByText("It meshes.")).toBeTruthy();
        expect(unresolved?.querySelector(".hunk-add")?.textContent).toBe("+const b = 3;");
        expect(resolved?.open).toBe(false);
        expect(resolved?.querySelector("summary")?.textContent).toBe("README.md:3Resolved");
        // alice's reply shows in its thread, not as a review of its own.
        expect(conversation.querySelectorAll(".timeline-review")).toHaveLength(1);

        const comment = within(conversation).getByText("Looks close.").closest(".timeline-card") as HTMLElement;
        expect(comment.textContent).toContain("carol commented");
    });

    it("shows what is unresolved, the checks, reviewers and linked issues in the sidebar", async () => {
        open("/acme/widgets/pull/12");
        await heading();
        const section = (name: string) => screen.getByRole("region", { name });
        const sections = [...document.querySelectorAll(".pr-sidebar > section")].map((s) =>
            s.getAttribute("aria-label"),
        );
        expect(sections.slice(0, 4)).toEqual(["Unresolved comments", "Checks", "Reviewers", "Linked issues"]);
        for (const gone of ["Assignees", "Labels", "Milestone"])
            expect(screen.queryByRole("region", { name: gone })).toBeNull();
        const reviewers = [...section("Reviewers").querySelectorAll("li")].map((row) => row.textContent);
        expect(reviewers).toEqual(["bobChanges requested", "daveAwaiting review"]);
        expect(within(section("Linked issues")).getByRole("link", { name: "#7 Gears slip" }).getAttribute("href")).toBe(
            "https://github.com/acme/widgets/issues/7",
        );

        // Only the open thread: the resolved one is done.
        const unresolved = section("Unresolved comments");
        expect(unresolved.querySelector(".tab-count")?.textContent).toBe("1");
        const rows = within(unresolved).getAllByRole("button");
        expect(rows).toHaveLength(1);
        const row = rows[0] as HTMLElement;
        expect(row.querySelector(".unresolved-where code")?.textContent).toBe("gears.ts:12");
        expect(row.querySelector(".unresolved-where code")?.getAttribute("title")).toBe("src/gears.ts");
        expect(row.querySelector(".unresolved-text")?.textContent).toBe("bob Why 3?");
        expect(row.querySelector(".unresolved-replies")?.textContent).toBe("1 reply");

        // The checks that need someone come first, each with where it stands.
        const checks = section("Checks");
        await within(checks).findByText("CI / test");
        expect(checks.querySelector(".sidebar-check-counts")?.textContent).toBe(
            "1 failing, 1 pending, 2 successful, 1 skipped",
        );
        const checkRows = [...checks.querySelectorAll(".sidebar-check")].map((row) => [
            row.querySelector(".merge-mark")?.textContent,
            row.querySelector(".sidebar-check-name")?.textContent,
            row.querySelector(".sidebar-check-state")?.textContent,
        ]);
        expect(checkRows.map(([mark]) => mark)).toEqual(["✕", "●", "✓", "✓", "–"]);
        expect(checkRows[0]?.slice(1)).toEqual(["CI / test", "Failure"]);
        expect(within(checks).getByRole("link", { name: "All checks" }).getAttribute("href")).toBe(
            "/acme/widgets/pull/12/checks",
        );
    });

    it("jumps from an unresolved comment in the sidebar to its thread in the conversation", async () => {
        const { router } = open("/acme/widgets/pull/12/commits");
        await heading();
        const scrolled: Element[] = [];
        Element.prototype.scrollIntoView = function (this: Element) {
            scrolled.push(this);
        };
        const unresolved = screen.getByRole("region", { name: "Unresolved comments" });
        fireEvent.click(within(unresolved).getByRole("button", { name: /gears\.ts:12/ }));
        await waitFor(() => expect(router.state.location.pathname).toBe("/acme/widgets/pull/12"));
        const target = await waitFor(() => {
            const found = document.getElementById("conversation-T_1");
            if (!found || !scrolled.includes(found)) throw new Error("not revealed yet");
            return found as HTMLDetailsElement;
        });
        expect(target.open).toBe(true);
        expect(target.classList.contains("revealed")).toBe(true);
        expect(document.activeElement).toBe(target.querySelector("summary"));
    });

    it("shows the stack the PR sits in, each member opening here", async () => {
        const { router } = open("/acme/widgets/pull/12");
        await heading();
        const stack = await screen.findByRole("region", { name: "Stack of 3" });
        // Tip first: carol's PR on top, bob's at the bottom on main.
        expect([...stack.querySelectorAll(".stack-member")].map((row) => row.textContent)).toEqual([
            "#14 Paint the gearscarol",
            "#12 Turn the gearsalice",
            "#11 Mount the gearsbob",
        ]);
        expect(stack.querySelector('[aria-current="page"]')?.textContent).toContain("#12");
        expect(within(stack).getByText("onto main")).toBeTruthy();
        expect(screen.getByTitle("Level 2 of 3 in this stack").textContent).toBe("2/3");

        fireEvent.click(within(stack).getByRole("link", { name: "#11 Mount the gears" }));
        await waitFor(() => expect(router.state.location.pathname).toBe("/acme/widgets/pull/11"));
    });

    it("lists every Claude session behind the PR, the most recent first", async () => {
        open("/acme/widgets/pull/12");
        await heading();
        const sessions = await screen.findByRole("region", { name: "Sessions" });
        await waitFor(() => expect(sessions.querySelectorAll("li")).toHaveLength(3));
        const rows = [...sessions.querySelectorAll("li")];
        expect(rows.map((row) => row.querySelector(".session-title")?.textContent)).toEqual([
            "Review the gears",
            "Gear work",
            "Gear spike",
        ]);
        expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe(
            `vscode://anthropic.claude-code/open?session=${reviewSession.id}`,
        );
        expect(rows[2]?.className).toBe("archived");
        expect(rows[2]?.querySelector(".session-meta")?.textContent).toBe("made · 7d ago · archived");
    });

    it("says in the merge box what stands in the way", async () => {
        open("/acme/widgets/pull/12");
        await heading();
        const box = screen.getByRole("region", { name: "Merge status" });
        expect([...box.querySelectorAll(".merge-row")].map((row) => row.textContent)).toEqual([
            "✕Changes requested",
            "✓All checks have passed4 successful",
            "✕This branch has conflicts that must be resolvedwith mid",
            "✓Auto-merge enabled (squash) by alicemerges once checks and reviews pass",
        ]);
        expect(within(box).getByRole("link", { name: "All checks have passed" }).getAttribute("href")).toBe(
            "/acme/widgets/pull/12/checks",
        );
    });

    it("steps to the next and previous PR in the list with ] and [", async () => {
        const { router } = open("/acme/widgets/pull/12");
        await heading();
        const next = await screen.findByRole("link", { name: "Next ›" });
        expect(next.getAttribute("href")).toBe("/acme/gadgets/pull/13");
        expect(screen.getByText("‹ Previous").getAttribute("aria-disabled")).toBe("true");

        fireEvent.keyDown(document.body, { key: "]" });
        await waitFor(() => expect(router.state.location.pathname).toBe("/acme/gadgets/pull/13"));
        fireEvent.keyDown(document.body, { key: "[" });
        await waitFor(() => expect(router.state.location.pathname).toBe("/acme/widgets/pull/12"));
    });

    it("reads the PR again in live mode once its own change check moves", async () => {
        localStorage.setItem("refresh_interval", "live");
        let probes = 0;
        server.use(
            github.query("PullRequestProbe", () => {
                probes++;
                return HttpResponse.json({
                    data: { repository: { pullRequest: { ...fields, updatedAt: "2026-11-27T11:00:00Z" } } },
                });
            }),
        );
        open("/acme/widgets/pull/12");
        await heading();
        expect(detailRequests).toBe(1);

        document.dispatchEvent(new Event("visibilitychange"));
        await waitFor(() => expect(detailRequests).toBe(2));
        expect(probes).toBe(1);
    });

    it("reads the commits over REST when GitHub withholds them, and shows them in the conversation", async () => {
        // A token without Contents read access: GitHub answers the commits with null and an error each.
        const withheld = { type: "FORBIDDEN", message: "Resource not accessible by personal access token" };
        const restCommit = (sha: string, message: string, date: string) => ({
            sha,
            html_url: `https://github.com/acme/widgets/commit/${sha}`,
            author: { login: "alice", avatar_url: "https://avatars.example/alice" },
            commit: { message, author: { name: "Alice", date }, committer: { name: "Alice", date } },
        });
        const restRequests: string[] = [];
        server.use(
            github.query("PullRequestDetail", () =>
                HttpResponse.json({
                    ...pullRequestResponse(
                        fields,
                        [
                            timeline.reviewRequested("RR_1", "bob"),
                            null,
                            timeline.comment("IC_1", "carol", "<p>Looks close.</p>"),
                            null,
                        ] as never,
                        [],
                    ),
                    errors: [withheld, withheld],
                }),
            ),
            github.query("PullRequestCommits", () =>
                HttpResponse.json({
                    data: {
                        repository: {
                            pullRequest: {
                                commits: {
                                    totalCount: 2,
                                    pageInfo: { hasNextPage: false, endCursor: null },
                                    nodes: [null, null],
                                },
                            },
                        },
                    },
                    errors: [withheld, withheld],
                }),
            ),
            http.get(`${API}/repos/:owner/:repo/pulls/:number/commits`, ({ request }) => {
                restRequests.push(new URL(request.url).pathname);
                return HttpResponse.json([
                    restCommit("aaaaaaa1111", "Cut the teeth\n\nSharper now.", "2026-11-25T09:00:00Z"),
                    restCommit("bbbbbbb2222", "Oil the axle", "2026-11-26T09:00:00Z"),
                ]);
            }),
        );
        open("/acme/widgets/pull/12");
        await heading();
        const conversation = document.querySelector(".conversation") as HTMLElement;
        await within(conversation).findByText("Oil the axle");
        const events = [...conversation.querySelectorAll(".timeline-event")].map((event) =>
            event.textContent?.replace(/\s+/g, " ").trim(),
        );
        expect(events).toEqual([
            "alice requested a review from bob 2d ago",
            "alice added a commit",
            "alice added a commit",
        ]);
        expect([...conversation.querySelectorAll(".commit-headline")].map((row) => row.textContent)).toEqual([
            "Cut the teeth",
            "Oil the axle",
        ]);
        expect(restRequests).toEqual(["/repos/acme/widgets/pulls/12/commits"]);

        fireEvent.click(screen.getByRole("link", { name: /Commits/ }));
        await screen.findAllByText(/Commits on/);
        expect(document.querySelectorAll(".commits-tab .commit-row")).toHaveLength(2);
    });

    it("lists the commits by day", async () => {
        open("/acme/widgets/pull/12");
        await heading();
        fireEvent.click(screen.getByRole("link", { name: /Commits/ }));
        const tab = await screen.findByText(/Commits on/);
        const day = tab.closest(".commit-day") as HTMLElement;
        expect([...day.querySelectorAll(".commit-headline")].map((row) => row.textContent)).toEqual([
            "Cut the teeth",
            "Oil the axle",
        ]);
        expect(within(day).getByRole("link", { name: "aaaaaaa" }).getAttribute("href")).toBe(
            "/acme/widgets/pull/12/commits/aaaaaaa1111",
        );
        expect(day.textContent).toContain("bob committed");
    });

    it("opens from the list, and steps back through history to it", async () => {
        const { router } = open("/");
        fireEvent.click(await screen.findByRole("link", { name: "Turn the gears" }));
        await heading();
        expect(router.state.location.pathname).toBe("/acme/widgets/pull/12");
        fireEvent.click(screen.getByRole("link", { name: /Commits/ }));
        await screen.findByText(/Commits on/);

        fireEvent.click(screen.getByRole("link", { name: "Pull requests" }));
        await screen.findByRole("tab", { name: /My PRs/ });
        expect(router.state.location.pathname).toBe("/");
        // The list's own entry, not a new one, so it comes back scrolled where it was.
        expect(router.history.location.state.__TSR_index).toBe(0);
    });

    it("goes to a fresh list once the list's history entry was replaced", async () => {
        const { router } = open("/acme/widgets/pull/12");
        await heading();
        fireEvent.click(screen.getByRole("link", { name: "Pull requests" }));
        await screen.findByRole("tab", { name: /My PRs/ });
        router.history.back();
        await heading();
        // Opening a tab now takes the list's place in history.
        fireEvent.click(screen.getByRole("link", { name: /Commits/ }));
        await screen.findByText(/Commits on/);
        fireEvent.click(screen.getByRole("link", { name: "Conversation" }));
        await screen.findByText("Turns them.");

        fireEvent.click(screen.getByRole("link", { name: "Pull requests" }));
        await screen.findByRole("tab", { name: /My PRs/ });
        expect(router.state.location.pathname).toBe("/");
    });

    it("goes to the list from a PR opened by its link", async () => {
        const { router } = open("/acme/widgets/pull/12");
        await heading();
        fireEvent.click(screen.getByRole("link", { name: "Pull requests" }));
        await screen.findByRole("tab", { name: /My PRs/ });
        expect(router.state.location.pathname).toBe("/");
    });

    it("opens GitHub instead on Cmd or Ctrl-click", async () => {
        const opened = vi.spyOn(window, "open").mockImplementation(() => null);
        const { router } = open("/");
        fireEvent.click(await screen.findByRole("link", { name: "Turn the gears" }), { metaKey: true });
        expect(opened).toHaveBeenCalledWith(PR_URL, "_blank", "noopener,noreferrer");
        expect(router.state.location.pathname).toBe("/");
        expect(detailRequests).toBe(0);
    });

    it("says so when the PR cannot be found", async () => {
        open("/acme/widgets/pull/99");
        expect(
            (await screen.findByText("acme/widgets#99 was not found, or this sign-in cannot see it.")).className,
        ).toBe("error");
    });

    it("asks to sign in first", async () => {
        sessionStorage.clear();
        open("/acme/widgets/pull/12");
        expect(await screen.findByText("Sign in to open this pull request.")).toBeTruthy();
        expect(screen.getByLabelText(/Fine-grained GitHub token/)).toBeTruthy();
        expect(detailRequests).toBe(0);
    });

    it("lists the head commit's checks, failing first, with their logs and annotations", async () => {
        open("/acme/widgets/pull/12/checks");
        await heading();
        expect(screen.getByRole("link", { name: /Checks/ }).getAttribute("aria-current")).toBe("page");
        expect(await screen.findByRole("heading", { name: "Some checks were not successful" })).toBeTruthy();
        expect(document.querySelector(".checks-summary")?.textContent).toContain(
            "1 failing, 1 pending, 2 successful, 1 skipped on tip-sha",
        );
        // The commit is named by its id, and every page reads the same one.
        expect(checkRequests).toEqual([
            { owner: "acme", name: "widgets", oid: "tip-sha", number: 12, after: null },
            { owner: "acme", name: "widgets", oid: "tip-sha", number: 12, after: "C2" },
        ]);

        const groups = screen.getAllByRole("region").filter((region) => region.classList.contains("check-group"));
        expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
            "Failing",
            "In progress",
            "Successful",
            "Skipped",
        ]);
        const failing = within(groups[0] as HTMLElement);
        expect(groups[0]?.querySelector(".check-name")?.textContent).toBe("CI / test");
        expect(failing.getByText("Required")).toBeTruthy();
        expect(failing.getByText("Failure · 1m 05s · GitHub Actions")).toBeTruthy();
        expect(failing.getByText("1 test failed")).toBeTruthy();
        expect(failing.getByRole("link", { name: "Logs" }).getAttribute("href")).toBe(
            "https://github.com/acme/widgets/actions/runs/1/job/4004",
        );
        // A failing check's summary and annotations are open from the start.
        expect((failing.getByText("Summary and 1 annotation").parentElement as HTMLDetailsElement).open).toBe(true);
        expect(failing.getByText("gears.test.ts: turns once")).toBeTruthy();
        const annotation = failing.getByRole("note", { name: "Failure: CI / test" });
        expect(within(annotation).getByText("Expected 3 to be 4")).toBeTruthy();
        expect(within(annotation).getByRole("link", { name: "src/gears.ts:12" }).getAttribute("href")).toBe(
            "https://github.com/acme/widgets/blob/tip-sha/src/gears.ts#L12",
        );

        const successful = within(groups[2] as HTMLElement);
        expect(successful.getAllByRole("listitem").map((row) => row.querySelector(".check-name")?.textContent)).toEqual(
            ["CI / build", "deploy"],
        );
        expect(successful.getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
            "https://ci.example.com/deploy",
        );
        expect(screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe(`${PR_URL}/checks`);
    });

    it("says so when no check ran on the head commit", async () => {
        server.use(github.query("CommitChecks", () => HttpResponse.json(commitChecksResponse(null))));
        open("/acme/widgets/pull/12/checks");
        expect(await screen.findByText("No checks ran on tip-sha.")).toBeTruthy();
    });

    it("says the checks could not be read rather than that none ran", async () => {
        server.use(
            github.query("CommitChecks", () =>
                HttpResponse.json({
                    ...commitChecksResponse(null),
                    errors: [{ message: "Resource not accessible by personal access token" }],
                }),
            ),
        );
        open("/acme/widgets/pull/12/checks");
        expect(await screen.findByText("Resource not accessible by personal access token")).toBeTruthy();
        expect(screen.queryByText("No checks ran on tip-sha.")).toBeNull();
    });

    describe("with Claude", () => {
        let writeText: ReturnType<typeof vi.fn>;
        // The links open other apps, which jsdom cannot.
        const stayOnPage = (event: Event) => event.preventDefault();
        beforeEach(() => {
            writeText = vi.fn(async (_text: string) => {});
            Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
            document.addEventListener("click", stayOnPage);
        });
        afterEach(() => document.removeEventListener("click", stayOnPage));

        it("builds a fix from the failing checks and open threads, and hands it to the session that made the PR", async () => {
            open("/acme/widgets/pull/12");
            await heading();
            fireEvent.click(screen.getByRole("button", { name: "Fix with Claude" }));
            const panel = screen.getByRole("region", { name: "Fix with Claude" });
            const prompt = (await within(panel).findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement;
            await waitFor(() => expect(prompt.value).toContain("bob: Why 3?"));
            expect(prompt.value).toContain('Fix pull request acme/widgets#12, "Turn the gears"');
            expect(prompt.value).toContain("- CI / test (failure): 1 test failed");
            expect(prompt.value).toContain("  - src/gears.ts:12: Expected 3 to be 4");
            // The resolved thread is done with.
            expect(prompt.value).not.toContain("Typo.");
            expect(within(panel).getByText("1 failing check and 1 unresolved thread go into the prompt.")).toBeTruthy();

            // The sessions that made the PR first, then the repository's other ones, each once.
            const rows = [...panel.querySelectorAll(".agent-sessions li")].map((row) => [
                row.querySelector(".session-title")?.textContent,
                row.querySelector(".session-meta")?.textContent,
            ]);
            expect(rows).toEqual([
                ["Gear work", "made this PR · 1d ago"],
                ["Gear spike", "made this PR · 7d ago · archived"],
                ["Axle work", "in acme/widgets · 1h ago"],
            ]);
            // The desktop app opens a session without a prompt, so it is copied, with a word to paste it.
            const copyAndOpen = within(panel).getByRole("link", {
                name: "Copy the prompt and open Gear work in Claude",
            });
            expect(copyAndOpen.textContent).toBe("Copy & open");
            expect(copyAndOpen.getAttribute("href")).toBe(`claude://claude.ai/epitaxy/${madeSession.id}`);
            fireEvent.click(copyAndOpen);
            expect(writeText).toHaveBeenCalledWith(prompt.value);
            expect(
                await within(panel).findByText("Prompt copied: paste it into the session's box and press Enter."),
            ).toBeTruthy();
            expect(
                within(panel).getByRole("link", { name: "Copy the prompt and open Axle work in Claude" }),
            ).toBeTruthy();

            // A new desktop session opens in the repository's checkout.
            const fresh = new URL(
                within(panel)
                    .getByRole("link", { name: /New session in Claude/ })
                    .getAttribute("href") ?? "",
            );
            expect(`${fresh.protocol}//${fresh.host}${fresh.pathname}`).toBe("claude://code/new");
            expect(fresh.searchParams.get("q")).toBe(prompt.value);
            expect(fresh.searchParams.get("folder")).toBe("/work/widgets");
            expect(within(panel).getByText("/work/widgets")).toBeTruthy();

            fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
            expect(screen.queryByRole("region", { name: "Fix with Claude" })).toBeNull();
        });

        it("asks the session that reviewed the PR for another review, with the prompt in its link", async () => {
            open("/acme/widgets/pull/12");
            await heading();
            fireEvent.click(screen.getByRole("button", { name: "Review with Claude" }));
            const panel = screen.getByRole("region", { name: "Review with Claude" });
            const prompt = (await within(panel).findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement;
            expect(prompt.value.startsWith('Review pull request acme/widgets#12, "Turn the gears"')).toBe(true);
            const link = within(panel).getByRole("link", { name: "Send to Review the gears in VS Code" });
            expect(link.getAttribute("href")).toBe(
                `vscode://anthropic.claude-code/open?session=${reviewSession.id}&prompt=${encodeURIComponent(prompt.value)}`,
            );
            expect(within(panel).getByText("Review the gears")).toBeTruthy();
        });

        it("builds the prompt from the threads when the sign-in cannot read the checks", async () => {
            server.use(
                github.query("CommitChecks", () =>
                    HttpResponse.json({
                        ...commitChecksResponse(null),
                        errors: [{ message: "Resource not accessible by personal access token" }],
                    }),
                ),
            );
            open("/acme/widgets/pull/12");
            await heading();
            fireEvent.click(screen.getByRole("button", { name: "Fix with Claude" }));
            const panel = screen.getByRole("region", { name: "Fix with Claude" });
            const prompt = (await within(panel).findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement;
            expect(prompt.value).toContain("bob: Why 3?");
            expect(prompt.value).toContain("gh pr checks 12 --repo acme/widgets");
            expect(panel.textContent).toContain(
                "The checks could not be read (Resource not accessible by personal access token)",
            );
        });

        it("offers only a new session when no session worked in the repository, and says when the copy failed", async () => {
            writeText.mockRejectedValue(new Error("denied"));
            open("/acme/widgets/pull/12", {
                fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }),
            });
            await heading();
            fireEvent.click(screen.getByRole("button", { name: "Fix with Claude" }));
            const panel = screen.getByRole("region", { name: "Fix with Claude" });
            await within(panel).findByRole("textbox", { name: "Prompt" });
            expect(
                within(panel).getByText("No Claude session on this computer has worked in acme/widgets."),
            ).toBeTruthy();
            expect(
                within(panel).getByText(
                    "No checkout of acme/widgets is known here, so the desktop app asks for its folder.",
                ),
            ).toBeTruthy();
            expect(
                within(panel)
                    .getByRole("link", { name: /New session in Claude/ })
                    .getAttribute("href")
                    ?.includes("folder="),
            ).toBe(false);
            fireEvent.click(within(panel).getByRole("button", { name: "Copy prompt" }));
            expect(await within(panel).findByText("Could not copy; select the prompt and copy it.")).toBeTruthy();
        });
    });

    it("answers a path that is not a PR with a way back to the list", async () => {
        open("/acme/widgets/pull/twelve");
        expect(await screen.findByRole("link", { name: "Back to the list" })).toBeTruthy();
    });
});

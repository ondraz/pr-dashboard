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
    pullCommit,
    pullRequestFields,
    pullRequestResponse,
    reviewThread,
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
        nodes: [{ state: "CHANGES_REQUESTED", submittedAt: "2026-11-25T11:00:00Z", author: actor("bob") }],
    },
    assignees: { nodes: [actor("alice")] },
    labels: { nodes: [{ name: "backend" }] },
    milestone: { title: "Gearbox v2", url: "https://github.com/acme/widgets/milestone/2" },
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

let detailRequests = 0;

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

        const subhead = title.nextElementSibling as HTMLElement;
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
        expect(screen.getByRole("link", { name: /Files changed/ }).getAttribute("href")).toBe(`${PR_URL}/files`);
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

    it("shows reviewers, assignees, labels, linked issues and the milestone in the sidebar", async () => {
        open("/acme/widgets/pull/12");
        await heading();
        const section = (name: string) => screen.getByRole("region", { name });
        const reviewers = [...section("Reviewers").querySelectorAll("li")].map((row) => row.textContent);
        expect(reviewers).toEqual(["bobChanges requested", "daveAwaiting review"]);
        expect(within(section("Assignees")).getByRole("link", { name: "alice" })).toBeTruthy();
        expect(within(section("Labels")).getByText("backend")).toBeTruthy();
        expect(within(section("Linked issues")).getByRole("link", { name: "#7 Gears slip" }).getAttribute("href")).toBe(
            "https://github.com/acme/widgets/issues/7",
        );
        expect(within(section("Milestone")).getByRole("link", { name: "Gearbox v2" })).toBeTruthy();
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
            `${PR_URL}/commits/aaaaaaa1111`,
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

    it("points to GitHub for the views it does not show yet", async () => {
        open("/acme/widgets/pull/12/commits/aaaaaaa1111");
        await heading();
        expect(screen.getByRole("link", { name: "Open it on GitHub" }).getAttribute("href")).toBe(
            `${PR_URL}/commits/aaaaaaa1111`,
        );
    });

    it("answers a path that is not a PR with a way back to the list", async () => {
        open("/acme/widgets/pull/twelve");
        expect(await screen.findByRole("link", { name: "Back to the list" })).toBeTruthy();
    });
});

// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrSession } from "../../../shared/sessions.ts";
import type { Services } from "../app/services.tsx";
import { pullCommit, pullRequestFields, pullRequestResponse, reviewThread, timeline } from "../github/prFixtures.ts";
import { searchHit } from "../github/testFixtures.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const NOW = new Date("2026-11-27T12:00:00Z");
const PR_URL = "https://github.com/acme/widgets/pull/12";

// alice's widgets#12: bob asked for changes in two threads, one since resolved, and alice answered
// the other; carol commented after alice force-pushed.
const fields = pullRequestFields({
    bodyHTML: '<p>Turns them.</p><script>window.stolen = true</script><a href="https://example.com/spec">spec</a>',
    autoMergeRequest: { mergeMethod: "SQUASH", enabledBy: { login: "alice" } },
    mergeable: "CONFLICTING",
});
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
    lastActivityAt: 1,
};

let detailRequests = 0;

const handlers = [
    http.get(`${API}/user`, () => HttpResponse.json({ login: "alice" })),
    http.get(`${API}/search/issues`, ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        const items = q.startsWith("is:pr is:open author:alice")
            ? [searchHit("acme/widgets", 12, { title: "Turn the gears" })]
            : [];
        return HttpResponse.json({ total_count: items.length, incomplete_results: false, items });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
    ),
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
            made: new Map([[PR_URL, madeSession]]),
            reviewed: new Map<string, PrSession>(),
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

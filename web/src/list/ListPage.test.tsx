// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceCodePayload, PollPayload, TokenPayload } from "../../../shared/auth.ts";
import type { PrSession } from "../../../shared/sessions.ts";
import { AuthProvider } from "../app/AuthProvider.tsx";
import type { AuthApi } from "../app/auth.ts";
import { defaultServices, ServicesContext } from "../app/services.tsx";
import { outstanding, pullJson, review, searchHit, thread } from "../github/testFixtures.ts";
import { CollapseProvider } from "./collapse.tsx";
import { ListPage } from "./ListPage.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const NOW = new Date("2026-11-27T12:00:00Z");

// alice's own PRs: the stack 10 <- 11 <- 12 in widgets sits on bob's 10 and is named by 11's
// "Stack:" line; GEAR-5 spans widgets#13 and gadgets#21; gadgets#22 was last touched in October.
// She is asked to review bob's gadgets#30 again, and approved carol's widgets#40.
const mineHits = [
    searchHit("acme/widgets", 12, { title: "Turn the gears", updated_at: "2026-11-26T10:00:00Z" }),
    searchHit("acme/widgets", 11, { title: "Mount the gears" }),
    searchHit("acme/widgets", 13, { title: "GEAR-5: add the endpoint", labels: [{ name: "backend" }] }),
    searchHit("acme/gadgets", 21, { title: "GEAR-5: call the endpoint", draft: true }),
    searchHit("acme/gadgets", 22, { title: "Polish the knobs", updated_at: "2026-10-01T10:00:00Z" }),
];
const pulls: Record<string, ReturnType<typeof pullJson>> = {
    "acme/widgets#10": pullJson("acme/widgets", 10, "base-work", "main", {
        title: "Cast the gears",
        user: { login: "bob" },
    }),
    "acme/widgets#11": pullJson("acme/widgets", 11, "mid", "base-work", {
        title: "Mount the gears",
        body: "Mounts them.\n\nStack: Gear train\n",
    }),
    "acme/widgets#12": pullJson("acme/widgets", 12, "tip", "mid", {
        title: "Turn the gears",
        auto_merge: { merge_method: "squash", enabled_by: { login: "alice" } },
    }),
    "acme/widgets#13": pullJson("acme/widgets", 13, "gear-5-endpoint", "main", {
        title: "GEAR-5: add the endpoint",
        mergeable: false,
    }),
    "acme/gadgets#21": pullJson("acme/gadgets", 21, "gear-5-call", "main", {
        title: "GEAR-5: call the endpoint",
        draft: true,
    }),
    "acme/gadgets#22": pullJson("acme/gadgets", 22, "knobs", "main", { title: "Polish the knobs" }),
    "acme/gadgets#30": pullJson("acme/gadgets", 30, "bobs-fix", "main", { user: { login: "bob" } }),
    "acme/widgets#40": pullJson("acme/widgets", 40, "carols-fix", "main", { user: { login: "carol" } }),
};
const reviews: Record<string, unknown[]> = {
    "acme/widgets#11": [review("bob", "APPROVED", "mid-sha")],
    "acme/gadgets#30": [review("alice", "CHANGES_REQUESTED", "older-sha")],
    "acme/widgets#40": [review("alice", "APPROVED", "carols-fix-sha")],
};
const threads: Record<string, ReturnType<typeof outstanding>> = {
    "acme/widgets#12": outstanding([thread(false, "bob", "bob", "PRR_1", 3), thread(true, "bob", "alice")]),
};

const handlers = [
    http.get(`${API}/user`, () => HttpResponse.json({ login: "alice" })),
    http.get(`${API}/search/issues`, ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        const items =
            q.includes("review-requested:alice") && !q.includes("-review-requested")
                ? [searchHit("acme/gadgets", 30, { title: "Fix the gadget", user: { login: "bob" } })]
                : q.includes("reviewed-by:alice")
                  ? [searchHit("acme/widgets", 40, { title: "Fix the widget", user: { login: "carol" } })]
                  : mineHits;
        return HttpResponse.json({ total_count: items.length, incomplete_results: false, items });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ params }) => {
        const found = pulls[`${params.owner}/${params.repo}#${params.number}`];
        return found ? HttpResponse.json(found) : HttpResponse.json({ message: "Not Found" }, { status: 404 });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews`, ({ params }) =>
        HttpResponse.json(reviews[`${params.owner}/${params.repo}#${params.number}`] ?? []),
    ),
    http.get(`${API}/repos/:owner/:repo/pulls`, ({ params, request }) => {
        const head = new URL(request.url).searchParams.get("head");
        const repo = `${params.owner}/${params.repo}`;
        return HttpResponse.json(
            Object.values(pulls).filter((pr) => pr.head.label === head && pr.html_url.includes(`/${repo}/`)),
        );
    }),
    github.query("OutstandingWorkBatch", ({ variables }) => {
        const data: Record<string, unknown> = {};
        for (let n = 0; `number${n}` in variables; n++) {
            const key = `${variables[`owner${n}`]}/${variables[`name${n}`]}#${variables[`number${n}`]}`;
            data[`pr${n}`] = { pullRequest: threads[key] ?? outstanding([]) };
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
];

const server = setupServer(...handlers);

const madeSession: PrSession = {
    id: "local_0f0f0f0f-0000-4000-8000-000000000000",
    title: "Gear work",
    archived: false,
    lastActivityAt: 1,
};

/** The local server's sign-in routes, with GitHub's side scripted. */
class FakeAuthApi implements AuthApi {
    configured = true;
    /** The access token the server holds, or null when signed out. */
    accessToken: string | null = null;
    /** What the server renews a refused token with; null signs out. */
    renewed: string | null = null;
    polls: PollPayload[] = [];
    readonly refused: string[] = [];
    signOuts = 0;

    async token(refused?: string): Promise<TokenPayload> {
        if (refused) {
            this.refused.push(refused);
            if (refused === this.accessToken) this.accessToken = this.renewed;
        }
        return this.accessToken
            ? { status: "signed-in", accessToken: this.accessToken, expiresAt: NOW.getTime() + 8 * 3_600_000 }
            : { status: "signed-out", configured: this.configured };
    }

    async start(): Promise<DeviceCodePayload> {
        return {
            userCode: "WDJB-MJHT",
            verificationUri: "https://github.com/login/device",
            expiresAt: NOW.getTime() + 900_000,
            interval: 0,
        };
    }

    async poll(): Promise<PollPayload> {
        const next = this.polls.shift() ?? { status: "expired" };
        if (next.status === "signed-in") this.accessToken = "ghu_first";
        return next;
    }

    async signOut(): Promise<void> {
        this.signOuts++;
        this.accessToken = null;
    }
}

const queryClients: QueryClient[] = [];

function renderPage(auth: AuthApi = Object.assign(new FakeAuthApi(), { configured: false })) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClients.push(queryClient);
    const services = {
        ...defaultServices,
        auth,
        fetchSessions: async () => ({
            made: new Map([["https://github.com/acme/widgets/pull/12", madeSession]]),
            reviewed: new Map<string, PrSession>(),
        }),
    };
    return render(
        <QueryClientProvider client={queryClient}>
            <ServicesContext value={services}>
                <AuthProvider>
                    <CollapseProvider>
                        <ListPage />
                    </CollapseProvider>
                </AuthProvider>
            </ServicesContext>
        </QueryClientProvider>,
    );
}

const rowOf = (title: string) => {
    const row = screen.getByRole("link", { name: title }).closest(".pr-item");
    if (!(row instanceof HTMLElement)) throw new Error(`No row for ${title}`);
    return row;
};

const tab = (name: RegExp) => screen.getByRole("tab", { name });

async function loaded() {
    await screen.findByRole("link", { name: "Turn the gears" });
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    // Live mode's 15-second check is covered by the LiveCheck tests; here it would only add noise.
    localStorage.setItem("refresh_interval", "0");
});
afterEach(async () => {
    // A refresh still running would carry its requests into the next test.
    await waitFor(() => expect(queryClients.every((client) => client.isFetching() === 0)).toBe(true));
    for (const client of queryClients.splice(0)) client.clear();
    cleanup();
    server.resetHandlers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("ListPage without a token", () => {
    it("asks for one, keeps it for the session only unless told otherwise, and loads", async () => {
        renderPage();
        expect(await screen.findByText("Enter a GitHub token to load your open PRs.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull();

        fireEvent.change(screen.getByLabelText(/Fine-grained GitHub token/), { target: { value: " ghp_test " } });
        fireEvent.click(screen.getByRole("button", { name: "Save & Load" }));

        await loaded();
        expect(sessionStorage.getItem("gh_token")).toBe("ghp_test");
        expect(localStorage.getItem("gh_token")).toBeNull();
        expect(screen.queryByLabelText(/Fine-grained GitHub token/)).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Clear token" }));
        expect(sessionStorage.getItem("gh_token")).toBeNull();
        expect(screen.getByText("Enter a GitHub token to load your open PRs.")).toBeTruthy();
    });

    it("remembers it across sessions when asked", async () => {
        renderPage();
        fireEvent.change(await screen.findByLabelText(/Fine-grained GitHub token/), { target: { value: "ghp_test" } });
        fireEvent.click(screen.getByRole("checkbox", { name: /Remember across sessions/ }));
        fireEvent.click(screen.getByRole("button", { name: "Save & Load" }));
        await loaded();
        expect(localStorage.getItem("gh_token")).toBe("ghp_test");
        expect(sessionStorage.getItem("gh_token")).toBeNull();
    });
});

describe("ListPage", () => {
    beforeEach(() => sessionStorage.setItem("gh_token", "ghp_test"));

    it("shows the viewer's PRs by repository, with stacks and every badge", async () => {
        renderPage();
        await loaded();

        expect(screen.getByText("Updated just now")).toBeTruthy();
        expect(tab(/My PRs/).textContent).toContain("4");
        expect(tab(/Waiting for my review/).textContent).toContain("1");
        expect(tab(/Reviewed by me/).textContent).toContain("1");
        // The header counts every open PR of the viewer's, filtered or not.
        expect(screen.getByTitle("Your open pull requests").textContent).toBe("5");

        const stack = screen.getByText("Stack of 3").closest(".stack-group");
        if (!(stack instanceof HTMLElement)) throw new Error("No stack");
        expect(within(stack).getByText("Gear train").className).toBe("stack-name");
        expect(within(stack).getByText("onto main")).toBeTruthy();
        // Tip first, the colleague's base PR last and muted.
        expect([...stack.querySelectorAll(".pr-title a")].map((link) => link.textContent)).toEqual([
            "Turn the gears",
            "Mount the gears",
            "Cast the gears",
        ]);
        expect(rowOf("Cast the gears").classList).toContain("pr-context");
        expect(rowOf("Cast the gears").textContent).toContain("#10 by bob");

        const tip = rowOf("Turn the gears");
        expect(within(tip).getByText("3/3")).toBeTruthy();
        expect(within(tip).getByText("Auto-merge").title).toBe(
            "Auto-merge enabled (squash) by alice - merges on its own once checks and reviews pass",
        );
        const unresolved = within(tip).getByRole("link", { name: /1 unresolved/ });
        expect(unresolved.getAttribute("href")).toBe("https://github.com/acme/widgets/pull/12/files");
        expect(unresolved.title).toBe("1 unresolved review thread (3 comments)");
        expect(
            within(tip)
                .getByRole("link", { name: /Open the Claude session that made this PR/ })
                .getAttribute("href"),
        ).toBe(`claude://claude.ai/epitaxy/${madeSession.id}`);
        expect(within(tip).getByText("Review pending")).toBeTruthy();
        expect(within(tip).getByRole("link", { name: "#11" })).toBeTruthy();
        expect(within(rowOf("Mount the gears")).getByText("Approved")).toBeTruthy();

        const endpoint = rowOf("GEAR-5: add the endpoint");
        expect(
            within(endpoint)
                .getByRole("link", { name: /Conflicts/ })
                .getAttribute("href"),
        ).toBe("https://github.com/acme/widgets/pull/13#partial-pull-merging");
        expect(within(endpoint).getByText("backend")).toBeTruthy();
        expect(within(endpoint).getByRole("button", { name: "GEAR-5 · 2 repos" })).toBeTruthy();
        expect(within(rowOf("GEAR-5: call the endpoint")).getByText("Draft")).toBeTruthy();

        // The repository header totals what is still owed in it.
        const widgets = screen.getByRole("link", { name: "widgets" }).closest(".repo-header");
        if (!(widgets instanceof HTMLElement)) throw new Error("No widgets header");
        expect(within(widgets).getByTitle("1 unresolved review thread in this group").textContent).toBe("1");
        expect(widgets.querySelector(".repo-pr-count")?.textContent).toBe("3");

        // Last touched in October, so outside "Recent".
        expect(screen.queryByText("Polish the knobs")).toBeNull();
    });

    it("jumps to the cross-repo group from a PR's feature badge", async () => {
        renderPage();
        await loaded();
        fireEvent.click(within(rowOf("GEAR-5: call the endpoint")).getByRole("button", { name: "GEAR-5 · 2 repos" }));

        expect(screen.getByRole("button", { name: "By feature" }).getAttribute("aria-pressed")).toBe("true");
        expect(localStorage.getItem("grouping")).toBe("feature");
        const group = document.getElementById("feature-ticket-GEAR-5");
        if (!group) throw new Error("No feature group");
        expect(within(group).getByText("shared ticket")).toBeTruthy();
        expect(within(group).getByText("2 repos · 2 PRs")).toBeTruthy();
        expect(within(group).getByRole("link", { name: "GEAR-5: call the endpoint" })).toBeTruthy();
        expect(screen.getByText("Single-repo work")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /GEAR-5 ·/ })).toBeNull();
    });

    it("collapses a section and remembers it", async () => {
        const { unmount } = renderPage();
        await loaded();
        const header = screen.getByRole("link", { name: "widgets" }).closest(".repo-header");
        if (!(header instanceof HTMLElement)) throw new Error("No header");
        expect(header.getAttribute("aria-expanded")).toBe("true");

        fireEvent.keyDown(header, { key: "Enter" });
        expect(header.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByText("Turn the gears")).toBeNull();
        expect(JSON.parse(localStorage.getItem("collapsed_groups") ?? "[]")).toEqual(["repo:acme/widgets"]);

        unmount();
        renderPage();
        await screen.findByText("GEAR-5: call the endpoint");
        expect(screen.queryByText("Turn the gears")).toBeNull();
        fireEvent.click(screen.getByRole("link", { name: "widgets" }).closest(".repo-header") as HTMLElement);
        expect(screen.getByText("Turn the gears")).toBeTruthy();
        expect(localStorage.getItem("collapsed_groups")).toBe("[]");
    });

    it("filters by draft state and age, and the tab counts follow", async () => {
        renderPage();
        await loaded();

        fireEvent.click(screen.getByRole("button", { name: "Draft" }));
        expect(screen.queryByText("Turn the gears")).toBeNull();
        expect(screen.getByText("GEAR-5: call the endpoint")).toBeTruthy();
        expect(tab(/My PRs/).textContent).toContain("1");
        expect(tab(/Reviewed by me/).textContent).toContain("0");

        fireEvent.click(screen.getByRole("button", { name: "Ready" }));
        fireEvent.click(screen.getByRole("button", { name: "All time" }));
        expect(screen.getByText("Polish the knobs")).toBeTruthy();
        expect(screen.queryByText("GEAR-5: call the endpoint")).toBeNull();
        expect(localStorage.getItem("status_filter")).toBe("open");
        expect(localStorage.getItem("age_filter")).toBe("all");
    });

    it("shows the review tabs with where the viewer's review stands", async () => {
        renderPage();
        await loaded();

        fireEvent.keyDown(tab(/My PRs/), { key: "ArrowRight" });
        expect(tab(/Waiting for my review/).getAttribute("aria-selected")).toBe("true");
        expect(localStorage.getItem("tab")).toBe("reviews");
        expect(screen.queryByRole("button", { name: "By repo" })).toBeNull();
        const waiting = within(rowOf("Fix the gadget"));
        expect(waiting.getByText(/#30 by bob opened/)).toBeTruthy();
        const rereview = waiting.getByRole("link", { name: /New commits since your review/ });
        expect(rereview.textContent).toBe("Re-review");
        expect(rereview.getAttribute("href")).toBe(
            "https://github.com/acme/gadgets/pull/30/files/older-sha..bobs-fix-sha",
        );

        fireEvent.click(tab(/Reviewed by me/));
        const section = screen.getByText("Approved, not merged").closest(".repo-group");
        if (!(section instanceof HTMLElement)) throw new Error("No section");
        expect(within(section).getByText("widgets #40 by carol")).toBeTruthy();
        expect(within(section).getByRole("link", { name: "Approved" }).className).toBe("review-status review-approved");
    });

    it("shows a failed load with the token form, and loads again with a new token", async () => {
        server.use(
            http.get(`${API}/user`, ({ request }) =>
                request.headers.get("authorization")?.includes("ghp_bad")
                    ? HttpResponse.json({ message: "Bad credentials" }, { status: 401 })
                    : HttpResponse.json({ login: "alice" }),
            ),
        );
        sessionStorage.setItem("gh_token", "ghp_bad");
        renderPage();

        expect((await screen.findByText("Bad credentials")).className).toBe("error");
        expect(screen.queryByRole("tab", { name: /My PRs/ })).toBeNull();
        expect(screen.getByRole("status").textContent).toMatch(/^Refresh failed: Bad credentials/);

        fireEvent.change(screen.getByLabelText(/Fine-grained GitHub token/), { target: { value: "ghp_test" } });
        fireEvent.click(screen.getByRole("button", { name: "Save & Load" }));
        await loaded();
        await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Pull requests updated: 5"));
    });

    it("refreshes in live mode once the change check sees a change", async () => {
        localStorage.setItem("refresh_interval", "live");
        let searches = 0;
        let probes = 0;
        const countSearches = ({ request }: { request: Request }) => {
            if (request.url.includes("/search/issues")) searches++;
        };
        server.events.on("request:start", countSearches);
        server.use(
            github.query("ChangeProbe", () => {
                probes++;
                // The baseline read with the first load sees one PR; every check after it sees two.
                const count = probes === 1 ? 1 : 2;
                return HttpResponse.json({
                    data: {
                        mine: { issueCount: count, nodes: [] },
                        requested: { issueCount: 0, nodes: [] },
                        reviewed: { issueCount: 0, nodes: [] },
                    },
                });
            }),
        );
        renderPage();
        await loaded();
        expect(searches).toBe(3);
        expect(probes).toBe(1);

        // Coming back to the tab checks at once, as the 15-second tick does.
        document.dispatchEvent(new Event("visibilitychange"));
        await waitFor(() => expect(searches).toBe(6));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false),
        );
        expect(probes).toBe(3);
        server.events.removeListener("request:start", countSearches);
    });

    it("switches the refresh mode and remembers it", async () => {
        renderPage();
        await loaded();
        fireEvent.click(screen.getByRole("button", { name: "5m" }));
        expect(screen.getByRole("button", { name: "5m" }).getAttribute("aria-pressed")).toBe("true");
        expect(localStorage.getItem("refresh_interval")).toBe("300000");
    });
});

describe("ListPage with the GitHub App", () => {
    // The page's own requests carry the app's token; anything else is refused as GitHub would.
    const acceptOnly = (accepted: string) =>
        http.get(`${API}/user`, ({ request }) =>
            request.headers.get("authorization") === `token ${accepted}`
                ? HttpResponse.json({ login: "alice" })
                : HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
        );

    it("signs in with a code entered on GitHub, and signs out", async () => {
        server.use(acceptOnly("ghu_first"));
        const auth = new FakeAuthApi();
        auth.polls = [{ status: "pending", interval: 0 }, { status: "signed-in" }];
        renderPage(auth);

        expect(await screen.findByText("Sign in with GitHub, or enter a token, to load your open PRs.")).toBeTruthy();
        expect(screen.getByLabelText(/Fine-grained GitHub token/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));

        expect((await screen.findByText("WDJB-MJHT")).className).toBe("device-code");
        expect(screen.getByRole("link", { name: "github.com/login/device" }).getAttribute("href")).toBe(
            "https://github.com/login/device",
        );

        await loaded();
        expect(sessionStorage.getItem("gh_token")).toBeNull();
        expect(localStorage.getItem("gh_token")).toBeNull();
        expect(screen.queryByRole("button", { name: "Clear token" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
        expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
        expect(auth.signOuts).toBe(1);
        expect(screen.queryByText("Turn the gears")).toBeNull();
    });

    it("says why the server could not tell whether the user is signed in", async () => {
        const auth = new FakeAuthApi();
        auth.token = () => Promise.reject(new Error("Sign-in failed: fetch failed"));
        renderPage(auth);
        expect((await screen.findByRole("alert")).textContent).toBe("Sign-in failed: fetch failed");
        expect(screen.getByLabelText(/Fine-grained GitHub token/)).toBeTruthy();
    });

    it("says so when the sign-in is cancelled on GitHub", async () => {
        const auth = new FakeAuthApi();
        auth.polls = [{ status: "denied" }];
        renderPage(auth);
        fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
        expect((await screen.findByRole("alert")).textContent).toBe("Sign-in was cancelled on GitHub.");
        expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
    });

    it("uses the app's token over a pasted one, and asks for a fresh one on a 401", async () => {
        server.use(acceptOnly("ghu_second"));
        sessionStorage.setItem("gh_token", "ghp_test");
        const auth = new FakeAuthApi();
        auth.accessToken = "ghu_first";
        auth.renewed = "ghu_second";
        renderPage(auth);

        await loaded();
        expect(auth.refused).toEqual(["ghu_first"]);
        expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    });

    it("falls back to the pasted token once the server can no longer renew the app's", async () => {
        server.use(
            http.get(`${API}/user`, ({ request }) =>
                request.headers.get("authorization") === "token ghp_test"
                    ? HttpResponse.json({ login: "alice" })
                    : HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
            ),
        );
        sessionStorage.setItem("gh_token", "ghp_test");
        const auth = new FakeAuthApi();
        auth.accessToken = "ghu_revoked";
        renderPage(auth);

        await loaded();
        expect(auth.refused).toEqual(["ghu_revoked"]);
        expect(screen.getByRole("button", { name: "Clear token" })).toBeTruthy();
    });
});

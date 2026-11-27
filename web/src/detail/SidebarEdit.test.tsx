// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthApi } from "../app/auth.ts";
import { actor, commitChecksResponse, pullRequestFields, pullRequestResponse } from "../github/prFixtures.ts";
import type { PullRequestFields } from "../github/pullRequest.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);

const signedIn: AuthApi = {
    token: async () => ({ status: "signed-in", accessToken: "ghu_test", expiresAt: Date.now() + 8 * 3_600_000 }),
    start: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    signOut: async () => {},
};

const USERS = ["alice", "carol", "dave", "erin"];

let fields: PullRequestFields;
const calls: { name: string; body: unknown }[] = [];

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
    github.query("PullRequestDetail", () => HttpResponse.json(pullRequestResponse(fields, [], []))),
    github.query("CommitChecks", () => HttpResponse.json(commitChecksResponse(null))),
    github.query("AssignableUsers", ({ variables }) => {
        calls.push({ name: "AssignableUsers", body: variables });
        const query = String(variables.query ?? "");
        const nodes = USERS.filter((login) => login.includes(query)).map((login) => ({
            id: `U_${login}`,
            login,
            avatarUrl: actor(login).avatarUrl,
        }));
        return HttpResponse.json({ data: { repository: { assignableUsers: { nodes } } } });
    }),
    http.post(`${API}/repos/:owner/:repo/pulls/:number/requested_reviewers`, async ({ request }) => {
        const body = (await request.json()) as { reviewers: string[] };
        calls.push({ name: "POST requested_reviewers", body });
        const nodes = [...(fields.reviewRequests?.nodes ?? [])];
        for (const login of body.reviewers) nodes.push({ requestedReviewer: { login } });
        fields = { ...fields, reviewRequests: { nodes } };
        return HttpResponse.json({}, { status: 201 });
    }),
    http.delete(`${API}/repos/:owner/:repo/pulls/:number/requested_reviewers`, async ({ request }) => {
        const body = (await request.json()) as { reviewers: string[]; team_reviewers?: string[] };
        calls.push({ name: "DELETE requested_reviewers", body });
        const nodes = (fields.reviewRequests?.nodes ?? []).filter((node) => {
            const reviewer = node?.requestedReviewer;
            if (!reviewer) return false;
            return "login" in reviewer
                ? !body.reviewers.includes(reviewer.login)
                : !(body.team_reviewers ?? []).includes(reviewer.combinedSlug.split("/")[1] ?? "");
        });
        fields = { ...fields, reviewRequests: { nodes } };
        return HttpResponse.json({});
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
const section = (name: string) => screen.findByRole("region", { name });
const checkbox = (picker: HTMLElement, name: string) =>
    within(picker).findByRole("checkbox", { name }) as Promise<HTMLInputElement>;

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    fields = pullRequestFields({
        reviewRequests: {
            nodes: [
                { requestedReviewer: { login: "dave" } },
                { requestedReviewer: { name: "Gearheads", combinedSlug: "acme/gearheads" } },
            ],
        },
    });
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

describe("editing the sidebar", () => {
    it("offers no editing with a read-only token", async () => {
        sessionStorage.setItem("gh_token", "ghp_test");
        open({ ...signedIn, token: async () => ({ status: "signed-out", configured: true }) });
        const reviewers = await section("Reviewers");
        expect(within(reviewers).queryByRole("button")).toBeNull();
        expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    });

    it("asks for reviews, never from the author, and withdraws requests of users and teams", async () => {
        open();
        const reviewers = await section("Reviewers");
        fireEvent.click(within(reviewers).getByRole("button", { name: "Edit reviewers" }));
        const picker = within(reviewers).getByRole("group", { name: "Pick reviewers" });
        expect((await checkbox(picker, "dave")).checked).toBe(true);
        await checkbox(picker, "carol");
        expect(within(picker).queryByRole("checkbox", { name: "alice" })).toBeNull();

        fireEvent.click(await checkbox(picker, "carol"));
        await waitFor(() => expect(callsOf("POST requested_reviewers")).toEqual([{ reviewers: ["carol"] }]));
        await waitFor(async () => expect((await checkbox(picker, "dave")).disabled).toBe(false));
        fireEvent.click(await checkbox(picker, "dave"));
        await waitFor(() => expect(callsOf("DELETE requested_reviewers")).toEqual([{ reviewers: ["dave"] }]));

        const team = within(reviewers).getByText("acme/gearheads").closest("li") as HTMLElement;
        fireEvent.click(within(team).getByRole("button", { name: "Remove" }));
        await waitFor(() =>
            expect(callsOf("DELETE requested_reviewers").at(-1)).toEqual({
                reviewers: [],
                team_reviewers: ["gearheads"],
            }),
        );
        await waitFor(() => expect(within(reviewers).queryByText("acme/gearheads")).toBeNull());
    });
});

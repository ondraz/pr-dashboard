// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthApi } from "../app/auth.ts";
import { actor, pullRequestFields, pullRequestResponse } from "../github/prFixtures.ts";
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
const LABELS = ["backend", "bug", "docs"];

let fields: PullRequestFields;
const calls: { name: string; body: unknown }[] = [];

const user = (login: string) => ({ id: `U_${login}`, ...actor(login) });
const label = (name: string) => ({ id: `L_${name}`, name });

function labelsChange(variables: Record<string, unknown>, on: boolean) {
    const ids = variables.labelIds as string[];
    const current = (fields.labels?.nodes ?? []).filter((node) => !!node);
    const next = on
        ? [...current, ...ids.map((id) => label(id.slice(2)))]
        : current.filter((node) => !ids.includes(node.id));
    fields = { ...fields, labels: { nodes: next } };
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
    github.query("PullRequestDetail", () => HttpResponse.json(pullRequestResponse(fields, [], []))),
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
    github.query("RepositoryLabels", ({ variables }) => {
        calls.push({ name: "RepositoryLabels", body: variables });
        const query = String(variables.query ?? "");
        const nodes = LABELS.filter((name) => name.includes(query)).map(label);
        return HttpResponse.json({ data: { repository: { labels: { nodes } } } });
    }),
    github.mutation("AddLabels", ({ variables }) => {
        calls.push({ name: "AddLabels", body: variables });
        labelsChange(variables, true);
        return HttpResponse.json({ data: { addLabelsToLabelable: { clientMutationId: null } } });
    }),
    github.mutation("RemoveLabels", ({ variables }) => {
        calls.push({ name: "RemoveLabels", body: variables });
        labelsChange(variables, false);
        return HttpResponse.json({ data: { removeLabelsFromLabelable: { clientMutationId: null } } });
    }),
    github.mutation("AddAssignees", ({ variables }) => {
        calls.push({ name: "AddAssignees", body: variables });
        const added = (variables.assigneeIds as string[]).map((id) => user(id.slice(2)));
        fields = { ...fields, assignees: { nodes: [...(fields.assignees.nodes ?? []), ...added] } };
        return HttpResponse.json({ data: { addAssigneesToAssignable: { clientMutationId: null } } });
    }),
    github.mutation("RemoveAssignees", ({ variables }) => {
        calls.push({ name: "RemoveAssignees", body: variables });
        const ids = variables.assigneeIds as string[];
        const kept = (fields.assignees.nodes ?? []).filter((node) => node && !ids.includes(node.id));
        fields = { ...fields, assignees: { nodes: kept } };
        return HttpResponse.json({ data: { removeAssigneesFromAssignable: { clientMutationId: null } } });
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
        assignees: { nodes: [user("alice")] },
        labels: { nodes: [label("backend")] },
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

    it("assigns and unassigns from the repository's assignable users", async () => {
        open();
        const assignees = await section("Assignees");
        fireEvent.click(within(assignees).getByRole("button", { name: "Edit assignees" }));
        const picker = within(assignees).getByRole("group", { name: "Pick assignees" });
        expect((await checkbox(picker, "alice")).checked).toBe(true);
        fireEvent.click(await checkbox(picker, "carol"));

        await waitFor(() =>
            expect(callsOf("AddAssignees")).toEqual([{ assignableId: "PR_12", assigneeIds: ["U_carol"] }]),
        );
        await waitFor(async () => expect((await checkbox(picker, "carol")).disabled).toBe(false));
        expect((await checkbox(picker, "carol")).checked).toBe(true);
        fireEvent.click(await checkbox(picker, "alice"));
        await waitFor(() =>
            expect(callsOf("RemoveAssignees")).toEqual([{ assignableId: "PR_12", assigneeIds: ["U_alice"] }]),
        );
        fireEvent.click(within(picker).getByRole("button", { name: "Done" }));
        await waitFor(() => expect(within(assignees).queryByRole("group")).toBeNull());
        expect(within(assignees).getByText("carol")).toBeTruthy();
    });

    it("filters labels through GitHub's search, then adds and removes them", async () => {
        open();
        const labels = await section("Labels");
        fireEvent.click(within(labels).getByRole("button", { name: "Edit labels" }));
        const picker = within(labels).getByRole("group", { name: "Pick labels" });
        await checkbox(picker, "docs");
        const filter = within(picker).getByRole("textbox", { name: "Filter labels" });
        fireEvent.change(filter, { target: { value: "b" } });
        fireEvent.change(filter, { target: { value: "bu" } });
        await waitFor(() => expect(within(picker).queryByRole("checkbox", { name: "docs" })).toBeNull());
        // Typing asks once the filter settles, not per key, and the filter narrows the PR's own labels too.
        expect(callsOf("RepositoryLabels")).toEqual([
            { owner: "acme", name: "widgets", query: null },
            { owner: "acme", name: "widgets", query: "bu" },
        ]);
        expect(within(picker).queryByRole("checkbox", { name: "backend" })).toBeNull();

        fireEvent.click(await checkbox(picker, "bug"));
        await waitFor(() => expect(callsOf("AddLabels")).toEqual([{ labelableId: "PR_12", labelIds: ["L_bug"] }]));
        fireEvent.change(filter, { target: { value: "" } });
        await waitFor(async () => expect((await checkbox(picker, "backend")).disabled).toBe(false));
        fireEvent.click(await checkbox(picker, "backend"));
        await waitFor(() =>
            expect(callsOf("RemoveLabels")).toEqual([{ labelableId: "PR_12", labelIds: ["L_backend"] }]),
        );
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

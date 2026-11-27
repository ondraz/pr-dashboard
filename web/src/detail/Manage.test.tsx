// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthApi } from "../app/auth.ts";
import { pullRequestFields, pullRequestResponse } from "../github/prFixtures.ts";
import type { PullRequestFields } from "../github/pullRequest.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const HEAD = "c0ffee00c0ffee";
const DRAFTS = "draft:acme/widgets#12:";

const signedIn: AuthApi = {
    token: async () => ({ status: "signed-in", accessToken: "ghu_test", expiresAt: Date.now() + 8 * 3_600_000 }),
    start: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    signOut: async () => {},
};

let fields: PullRequestFields;
let mergeError: string | null;
const calls: { name: string; variables: Record<string, unknown> }[] = [];

const done = (name: string, payload: Record<string, unknown>) =>
    HttpResponse.json<{ data: Record<string, unknown> }>({ data: { [name]: payload } });

/** A mutation the mock records, then answers after changing the PR as GitHub would. */
function write(operation: string, field: string, change: (variables: Record<string, unknown>) => void = () => {}) {
    return github.mutation(operation, ({ variables }) => {
        calls.push({ name: operation, variables });
        change(variables);
        return done(field, { pullRequest: { id: "PR_12" } });
    });
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
    github.query("PullRequestMergeText", ({ variables }) =>
        HttpResponse.json({
            data: {
                repository: {
                    pullRequest: {
                        viewerMergeHeadlineText: `Turn the gears (#12) [${String(variables.method).toLowerCase()}]`,
                        viewerMergeBodyText: "* Turn them\n* Oil them",
                    },
                },
            },
        }),
    ),
    github.mutation("MergePullRequest", ({ variables }) => {
        calls.push({ name: "MergePullRequest", variables });
        if (mergeError) return HttpResponse.json({ data: null, errors: [{ message: mergeError }] });
        fields = { ...fields, state: "MERGED" };
        return done("mergePullRequest", { pullRequest: { id: "PR_12" } });
    }),
    write("EnableAutoMerge", "enablePullRequestAutoMerge", (variables) => {
        fields = {
            ...fields,
            autoMergeRequest: {
                mergeMethod: (variables.mergeMethod as "SQUASH") ?? "MERGE",
                enabledBy: { login: "bob" },
            },
        };
    }),
    write("DisableAutoMerge", "disablePullRequestAutoMerge", () => {
        fields = { ...fields, autoMergeRequest: null };
    }),
    github.mutation("EnqueuePullRequest", ({ variables }) => {
        calls.push({ name: "EnqueuePullRequest", variables });
        fields = { ...fields, mergeQueueEntry: { position: 3, state: "QUEUED" } };
        return done("enqueuePullRequest", { mergeQueueEntry: { position: 3 } });
    }),
    github.mutation("DequeuePullRequest", ({ variables }) => {
        calls.push({ name: "DequeuePullRequest", variables });
        fields = { ...fields, mergeQueueEntry: null };
        return done("dequeuePullRequest", { mergeQueueEntry: { id: "MQE_1" } });
    }),
    write("UpdatePullRequestBranch", "updatePullRequestBranch", () => {
        fields = { ...fields, viewerCanUpdateBranch: false };
    }),
    write("MarkReadyForReview", "markPullRequestReadyForReview", () => {
        fields = { ...fields, isDraft: false };
    }),
    write("ConvertToDraft", "convertPullRequestToDraft", () => {
        fields = { ...fields, isDraft: true };
    }),
    write("ClosePullRequest", "closePullRequest", () => {
        fields = { ...fields, state: "CLOSED" };
    }),
    write("ReopenPullRequest", "reopenPullRequest", () => {
        fields = { ...fields, state: "OPEN" };
    }),
    write("UpdatePullRequest", "updatePullRequest", (variables) => {
        if (typeof variables.title === "string") fields = { ...fields, title: variables.title };
        if (typeof variables.body === "string") {
            fields = { ...fields, body: variables.body, bodyHTML: `<p>${variables.body}</p>` };
        }
    }),
    github.mutation("AddComment", ({ variables }) => {
        calls.push({ name: "AddComment", variables });
        return done("addComment", { commentEdge: { node: { id: "IC_new" } } });
    }),
);

const queryClients: QueryClient[] = [];

function open(path = "/acme/widgets/pull/12", auth: AuthApi = signedIn) {
    const app = renderApp(path, { auth, fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }) });
    queryClients.push(app.queryClient);
    return app;
}

const callsOf = (name: string) => calls.filter((call) => call.name === name).map((call) => call.variables);
const mergeBox = () => screen.findByRole("region", { name: "Merge status" });

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    fields = pullRequestFields({ headRefOid: HEAD, reviewDecision: "APPROVED" });
    mergeError = null;
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

describe("landing the PR", () => {
    it("offers nothing that changes the PR when signed in with a read-only token", async () => {
        sessionStorage.setItem("gh_token", "ghp_test");
        const noApp: AuthApi = { ...signedIn, token: async () => ({ status: "signed-out", configured: true }) };
        open("/acme/widgets/pull/12", noApp);
        const box = await mergeBox();
        expect(within(box).queryAllByRole("button")).toEqual([]);
        expect(screen.queryByRole("button", { name: "Edit title" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    });

    it("squashes with GitHub's message, edited, only once confirmed, at the head the page shows", async () => {
        open();
        const box = await mergeBox();
        expect((within(box).getByRole("combobox", { name: "Merge method" }) as HTMLSelectElement).value).toBe("SQUASH");
        fireEvent.click(within(box).getByRole("button", { name: "Squash and merge" }));
        const form = await within(box).findByRole("form", { name: "Confirm squash and merge" });
        const headline = (await within(form).findByRole("textbox", { name: "Commit headline" })) as HTMLInputElement;
        expect(headline.value).toBe("Turn the gears (#12) [squash]");
        expect(callsOf("MergePullRequest")).toEqual([]);
        fireEvent.change(headline, { target: { value: "Turn the gears, gently (#12)" } });
        fireEvent.click(within(form).getByRole("button", { name: "Confirm squash and merge" }));

        await waitFor(() =>
            expect(callsOf("MergePullRequest")).toEqual([
                {
                    pullRequestId: "PR_12",
                    mergeMethod: "SQUASH",
                    expectedHeadOid: HEAD,
                    commitHeadline: "Turn the gears, gently (#12)",
                    commitBody: "* Turn them\n* Oil them",
                },
            ]),
        );
        expect(await within(box).findByText("Merged")).toBeTruthy();
        expect(within(box).queryAllByRole("button")).toEqual([]);
    });

    it("rebases without a message, and says why GitHub refused", async () => {
        mergeError = "Head branch was modified. Review and try the merge again.";
        open();
        const box = await mergeBox();
        fireEvent.change(within(box).getByRole("combobox", { name: "Merge method" }), { target: { value: "REBASE" } });
        fireEvent.click(within(box).getByRole("button", { name: "Rebase and merge" }));
        const form = within(box).getByRole("form", { name: "Confirm rebase and merge" });
        expect(within(form).queryByRole("textbox")).toBeNull();
        fireEvent.click(within(form).getByRole("button", { name: "Confirm rebase and merge" }));

        expect(await within(form).findByText(/Head branch was modified/)).toBeTruthy();
        expect(callsOf("MergePullRequest")).toEqual([
            {
                pullRequestId: "PR_12",
                mergeMethod: "REBASE",
                expectedHeadOid: HEAD,
                commitHeadline: null,
                commitBody: null,
            },
        ]);
        expect(screen.queryByText(/GitHub refused a change/)).toBeNull();
    });

    it("enables auto-merge while the PR is blocked, and disables it again", async () => {
        fields = { ...fields, mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" };
        open();
        const box = await mergeBox();
        fireEvent.change(within(box).getByRole("combobox", { name: "Merge method" }), { target: { value: "MERGE" } });
        fireEvent.click(within(box).getByRole("button", { name: "Enable auto-merge (merge)" }));
        const form = within(box).getByRole("form", { name: "Confirm auto-merge" });
        await within(form).findByRole("textbox", { name: "Commit headline" });
        fireEvent.click(within(form).getByRole("button", { name: "Confirm auto-merge" }));

        await waitFor(() =>
            expect(callsOf("EnableAutoMerge")).toEqual([
                {
                    pullRequestId: "PR_12",
                    mergeMethod: "MERGE",
                    expectedHeadOid: HEAD,
                    commitHeadline: "Turn the gears (#12) [merge]",
                    commitBody: "* Turn them\n* Oil them",
                },
            ]),
        );
        expect(await within(box).findByText("Auto-merge enabled (merge) by bob")).toBeTruthy();
        fireEvent.click(within(box).getByRole("button", { name: "Disable auto-merge" }));
        await waitFor(() => expect(callsOf("DisableAutoMerge")).toEqual([{ pullRequestId: "PR_12" }]));
        expect(await within(box).findByRole("button", { name: "Enable auto-merge (merge)" })).toBeTruthy();
    });

    it("adds the PR to the merge queue, which picks the method, and takes it out", async () => {
        fields = { ...fields, isMergeQueueEnabled: true };
        open();
        const box = await mergeBox();
        expect(within(box).queryByRole("combobox", { name: "Merge method" })).toBeNull();
        fireEvent.click(within(box).getByRole("button", { name: "Add to merge queue" }));
        const form = within(box).getByRole("form", { name: "Confirm add to merge queue" });
        fireEvent.click(within(form).getByRole("button", { name: "Confirm add to merge queue" }));

        await waitFor(() =>
            expect(callsOf("EnqueuePullRequest")).toEqual([{ pullRequestId: "PR_12", expectedHeadOid: HEAD }]),
        );
        expect(await within(box).findByText("Queued to merge at position 3")).toBeTruthy();
        fireEvent.click(within(box).getByRole("button", { name: "Remove from queue" }));
        await waitFor(() => expect(callsOf("DequeuePullRequest")).toEqual([{ pullRequestId: "PR_12" }]));
    });

    it("joins the merge queue once ready, through auto-merge without a method", async () => {
        fields = { ...fields, isMergeQueueEnabled: true, mergeStateStatus: "BLOCKED" };
        open();
        const box = await mergeBox();
        fireEvent.click(within(box).getByRole("button", { name: "Merge when ready" }));
        fireEvent.click(within(box).getByRole("button", { name: "Confirm merge when ready" }));
        await waitFor(() =>
            expect(callsOf("EnableAutoMerge")).toEqual([{ pullRequestId: "PR_12", expectedHeadOid: HEAD }]),
        );
    });

    it("updates the branch by the method picked", async () => {
        fields = { ...fields, mergeStateStatus: "BEHIND", viewerCanUpdateBranch: true };
        open();
        const box = await mergeBox();
        fireEvent.change(within(box).getByRole("combobox", { name: "Update method" }), {
            target: { value: "REBASE" },
        });
        fireEvent.click(within(box).getByRole("button", { name: "Update branch" }));
        await waitFor(() =>
            expect(callsOf("UpdatePullRequestBranch")).toEqual([
                { pullRequestId: "PR_12", expectedHeadOid: HEAD, updateMethod: "REBASE" },
            ]),
        );
        await waitFor(() => expect(within(box).queryByRole("button", { name: "Update branch" })).toBeNull());
    });
});

describe("the PR's state", () => {
    it("marks a draft ready for review, and converts it back", async () => {
        fields = { ...fields, isDraft: true };
        open();
        const box = await mergeBox();
        expect(within(box).queryByRole("button", { name: "Squash and merge" })).toBeNull();
        fireEvent.click(within(box).getByRole("button", { name: "Ready for review" }));
        await waitFor(() => expect(callsOf("MarkReadyForReview")).toEqual([{ pullRequestId: "PR_12" }]));

        fireEvent.click(await within(box).findByRole("button", { name: "Convert to draft" }));
        await waitFor(() => expect(callsOf("ConvertToDraft")).toEqual([{ pullRequestId: "PR_12" }]));
        expect(await within(box).findByRole("button", { name: "Ready for review" })).toBeTruthy();
    });

    it("closes with the comment typed, posting it first, then reopens", async () => {
        open();
        const form = await screen.findByRole("form", { name: "Add a comment" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Superseded by #13." } });
        fireEvent.click(within(form).getByRole("button", { name: "Close with comment" }));

        await waitFor(() => expect(calls.map((call) => call.name)).toEqual(["AddComment", "ClosePullRequest"]));
        expect(callsOf("AddComment")).toEqual([{ subjectId: "PR_12", body: "Superseded by #13." }]);
        expect(localStorage.getItem(`${DRAFTS}comment`)).toBeNull();
        expect(await screen.findByText("Closed without merging")).toBeTruthy();

        fireEvent.click(await within(form).findByRole("button", { name: "Reopen pull request" }));
        await waitFor(() => expect(callsOf("ReopenPullRequest")).toEqual([{ pullRequestId: "PR_12" }]));
        expect(callsOf("AddComment")).toHaveLength(1);
    });

    it("offers neither on a PR the viewer may not close", async () => {
        fields = { ...fields, viewerCanClose: false };
        open();
        const form = await screen.findByRole("form", { name: "Add a comment" });
        expect(within(form).queryByRole("button", { name: "Close pull request" })).toBeNull();
    });
});

describe("editing the PR", () => {
    it("renames it, keeping the new title as a draft until it is saved", async () => {
        open();
        fireEvent.click(await screen.findByRole("button", { name: "Edit title" }));
        const form = screen.getByRole("form", { name: "Edit title" });
        const title = within(form).getByRole("textbox", { name: "Title" }) as HTMLInputElement;
        expect(title.value).toBe("Turn the gears");
        fireEvent.change(title, { target: { value: "Turn the gears both ways" } });
        expect(localStorage.getItem(`${DRAFTS}title`)).toBe("Turn the gears both ways");
        fireEvent.click(within(form).getByRole("button", { name: "Save" }));

        await waitFor(() =>
            expect(callsOf("UpdatePullRequest")).toEqual([
                { pullRequestId: "PR_12", title: "Turn the gears both ways" },
            ]),
        );
        expect(await screen.findByRole("heading", { name: /Turn the gears both ways/ })).toBeTruthy();
        expect(localStorage.getItem(`${DRAFTS}title`)).toBeNull();
    });

    it("edits the description", async () => {
        open();
        const description = (await screen.findByText("Turns them.")).closest(".timeline-card") as HTMLElement;
        fireEvent.click(within(description).getByRole("button", { name: "Edit" }));
        const form = within(description).getByRole("form", { name: "Edit comment" });
        const box = within(form).getByRole("textbox") as HTMLTextAreaElement;
        expect(box.value).toBe("Turns them.");
        fireEvent.change(box, { target: { value: "Turns them, and oils them." } });
        fireEvent.click(within(form).getByRole("button", { name: "Update comment" }));

        await waitFor(() =>
            expect(callsOf("UpdatePullRequest")).toEqual([
                { pullRequestId: "PR_12", body: "Turns them, and oils them." },
            ]),
        );
        expect(await screen.findByText("Turns them, and oils them.")).toBeTruthy();
        expect(within(description).queryByRole("button", { name: "Delete" })).toBeNull();
    });
});

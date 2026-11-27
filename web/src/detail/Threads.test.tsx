// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthApi } from "../app/auth.ts";
import {
    actor,
    commitChecksResponse,
    pullRequestFields,
    pullRequestResponse,
    reviewThread,
    timeline,
} from "../github/prFixtures.ts";
import type { PullRequestFields, ReviewThread, TimelineNode } from "../github/pullRequest.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
// The side panel quotes each open thread too; these tests are about the conversation's copy.
const IN_CONVERSATION = { selector: ".conversation *" };
const github = mockGraphql.link(`${API}/graphql`);
const PATCH = "@@ -1,2 +1,2 @@\n const teeth = 12;\n-const ratio = 2;\n+const ratio = 3;";

const signedIn: AuthApi = {
    token: async () => ({ status: "signed-in", accessToken: "ghu_test", expiresAt: Date.now() + 8 * 3_600_000 }),
    start: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    signOut: async () => {},
};

let fields: PullRequestFields;
let threads: ReviewThread[];
let nodes: TimelineNode[];
let viewed: Record<string, string>;
const calls: { name: string; variables: Record<string, unknown> }[] = [];
const callsOf = (name: string) => calls.filter((call) => call.name === name).map((call) => call.variables);

function mutation(
    name: string,
    data: Record<string, unknown>,
    after: (variables: Record<string, unknown>) => void = () => {},
) {
    return github.mutation(name, ({ variables }) => {
        calls.push({ name, variables });
        after(variables);
        return HttpResponse.json({ data });
    });
}

const server = setupServer(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "dave" })),
    http.get(`${API}/search/issues`, () => HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] })),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/files`, () =>
        HttpResponse.json(
            ["src/axle.ts", "src/gears.ts", "src/lock.ts"].map((filename) => ({
                filename,
                status: "modified",
                additions: 1,
                deletions: 1,
                patch: PATCH,
            })),
        ),
    ),
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
    github.query("PullRequestDetail", () => HttpResponse.json(pullRequestResponse(fields, nodes, threads))),
    github.query("CommitChecks", () => HttpResponse.json(commitChecksResponse(null))),
    github.query("PullRequestViewedFiles", () =>
        HttpResponse.json({
            data: {
                repository: {
                    pullRequest: {
                        files: {
                            pageInfo: { hasNextPage: false, endCursor: null },
                            nodes: Object.entries(viewed).map(([path, viewerViewedState]) => ({
                                path,
                                viewerViewedState,
                            })),
                        },
                    },
                },
            },
        }),
    ),
    github.query("PullRequestCommits", () =>
        HttpResponse.json({
            data: {
                repository: {
                    pullRequest: {
                        commits: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
                    },
                },
            },
        }),
    ),
    mutation("AddPendingReview", { addPullRequestReview: { pullRequestReview: { id: "PRR_new" } } }),
    mutation("AddThreadReply", { addPullRequestReviewThreadReply: { comment: { id: "C_new" } } }),
    mutation("ResolveThread", { resolveReviewThread: { thread: { id: "T_1" } } }, () => {
        threads = threads.map((thread) => ({
            ...thread,
            isResolved: true,
            viewerCanResolve: false,
            viewerCanUnresolve: true,
        }));
    }),
    mutation("UnresolveThread", { unresolveReviewThread: { thread: { id: "T_1" } } }),
    mutation("UpdateIssueComment", { updateIssueComment: { issueComment: { id: "IC_1" } } }),
    mutation("UpdateReview", { updatePullRequestReview: { pullRequestReview: { id: "PRR_1" } } }),
    mutation("DeleteReviewComment", { deletePullRequestReviewComment: { pullRequestReview: { id: "PRR_1" } } }),
    mutation("AddReaction", { addReaction: { reaction: { content: "ROCKET" } } }),
    mutation("RemoveReaction", { removeReaction: { reaction: { content: "THUMBS_UP" } } }),
    mutation("MarkFileViewed", { markFileAsViewed: { clientMutationId: null } }, ({ path }) => {
        viewed[String(path)] = "VIEWED";
    }),
    mutation("UnmarkFileViewed", { unmarkFileAsViewed: { clientMutationId: null } }, ({ path }) => {
        viewed[String(path)] = "UNVIEWED";
    }),
    mutation("DismissReview", { dismissPullRequestReview: { pullRequestReview: { id: "PRR_b" } } }),
    http.post(`${API}/repos/:owner/:repo/pulls/:number/requested_reviewers`, async ({ request }) => {
        calls.push({ name: "POST requested_reviewers", variables: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({}, { status: 201 });
    }),
);

const queryClients: QueryClient[] = [];

function open(path: string, auth: AuthApi = signedIn) {
    const app = renderApp(path, { auth, fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }) });
    queryClients.push(app.queryClient);
    return app;
}

const thread = () =>
    screen.findByText("Why 3?", IN_CONVERSATION).then((text) => text.closest("details") as HTMLDetailsElement);

beforeAll(() => {
    server.listen({ onUnhandledFrame: "error" });
    HTMLCanvasElement.prototype.getContext = (() => ({
        font: "",
        measureText: (text: string) => ({ width: text.length * 7 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 20));
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    fields = pullRequestFields({ changedFiles: 3 });
    nodes = [timeline.review("PRR_1", "carol", "COMMENTED")];
    threads = [reviewThread("T_1", "PRR_1", [{ login: "carol", bodyHTML: "<p>Why 3?</p>" }])];
    viewed = {};
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

describe("threads", () => {
    it("replies into a new pending review, or on its own when asked", async () => {
        open("/acme/widgets/pull/12");
        fireEvent.click(within(await thread()).getByRole("button", { name: "Reply..." }));
        let form = await screen.findByRole("form", { name: "Reply" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Because it meshes." } });
        fireEvent.click(within(form).getByRole("button", { name: "Start a review" }));
        await waitFor(() => expect(screen.queryByRole("form", { name: "Reply" })).toBeNull());
        expect(callsOf("AddPendingReview")).toHaveLength(1);
        expect(callsOf("AddThreadReply")).toEqual([
            { threadId: "T_1", body: "Because it meshes.", pullRequestReviewId: "PRR_new" },
        ]);

        fireEvent.click(within(await thread()).getByRole("button", { name: "Reply..." }));
        form = await screen.findByRole("form", { name: "Reply" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Also, see above." } });
        fireEvent.click(within(form).getByRole("button", { name: "Add single comment" }));
        await waitFor(() => expect(callsOf("AddThreadReply")).toHaveLength(2));
        expect(callsOf("AddThreadReply")[1]).toEqual({
            threadId: "T_1",
            body: "Also, see above.",
            pullRequestReviewId: null,
        });
        expect(callsOf("AddPendingReview")).toHaveLength(1);
    });

    it("keeps an unsent reply through a reload", async () => {
        open("/acme/widgets/pull/12");
        fireEvent.click(within(await thread()).getByRole("button", { name: "Reply..." }));
        const form = await screen.findByRole("form", { name: "Reply" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Half a reply" } });
        cleanup();
        open("/acme/widgets/pull/12");
        const again = await screen.findByRole("form", { name: "Reply" });
        expect((within(again).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Half a reply");
    });

    it("resolves a thread, folding it, and offers to unresolve it", async () => {
        open("/acme/widgets/pull/12");
        fireEvent.click(within(await thread()).getByRole("button", { name: "Resolve conversation" }));
        await waitFor(() => expect(callsOf("ResolveThread")).toEqual([{ threadId: "T_1" }]));
        const resolved = await waitFor(async () => {
            const details = await thread();
            expect(details.open).toBe(false);
            return details;
        });
        expect(within(resolved).getByText("Resolved")).toBeTruthy();
        fireEvent.click(within(resolved).getByRole("button", { name: "Unresolve conversation" }));
        await waitFor(() => expect(callsOf("UnresolveThread")).toEqual([{ threadId: "T_1" }]));
    });

    it("shows no write action with a read-only token", async () => {
        sessionStorage.setItem("gh_token", "ghp_test");
        fields = {
            ...fields,
            reactionGroups: [{ content: "THUMBS_UP", viewerHasReacted: false, reactors: { totalCount: 2 } }],
        };
        open("/acme/widgets/pull/12", { ...signedIn, token: async () => ({ status: "signed-out", configured: true }) });
        const details = await thread();
        expect(within(details).queryByRole("button", { name: "Reply..." })).toBeNull();
        expect(within(details).queryByRole("button", { name: "Resolve conversation" })).toBeNull();
        expect(screen.getByTitle("+1: 2")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Add a reaction" })).toBeNull();
    });
});

describe("your own comments", () => {
    it("edits a comment and a review's summary, keeping the edit as a draft", async () => {
        nodes = [
            {
                ...timeline.comment("IC_1", "dave", "<p>Looks close.</p>"),
                viewerCanUpdate: true,
                viewerCanDelete: true,
            },
            { ...timeline.review("PRR_2", "dave", "APPROVED", "<p>Fine by me.</p>"), viewerCanUpdate: true },
        ];
        threads = [];
        open("/acme/widgets/pull/12");
        const card = (await screen.findByText("Looks close.")).closest(".timeline-card") as HTMLElement;
        fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
        const form = await within(card).findByRole("form", { name: "Edit comment" });
        const box = within(form).getByRole("textbox") as HTMLTextAreaElement;
        expect(box.value).toBe("Looks close.");
        fireEvent.change(box, { target: { value: "Looks done." } });
        expect(localStorage.getItem("draft:acme/widgets#12:edit:IC_1")).toBe("Looks done.");
        fireEvent.click(within(form).getByRole("button", { name: "Update comment" }));
        await waitFor(() => expect(callsOf("UpdateIssueComment")).toEqual([{ id: "IC_1", body: "Looks done." }]));
        await waitFor(() => expect(within(card).queryByRole("form")).toBeNull());

        const summary = (await screen.findByText("Fine by me.")).closest(".timeline-card") as HTMLElement;
        expect(within(summary).queryByRole("button", { name: "Delete" })).toBeNull();
        fireEvent.click(within(summary).getByRole("button", { name: "Edit" }));
        const reviewForm = await within(summary).findByRole("form", { name: "Edit comment" });
        fireEvent.change(within(reviewForm).getByRole("textbox"), { target: { value: "Fine by me, twice." } });
        fireEvent.click(within(reviewForm).getByRole("button", { name: "Update comment" }));
        await waitFor(() => expect(callsOf("UpdateReview")).toEqual([{ id: "PRR_2", body: "Fine by me, twice." }]));
    });

    it("deletes a comment in a thread once confirmed, and offers nothing on others' comments", async () => {
        threads = [
            reviewThread("T_1", "PRR_1", [
                { login: "carol", bodyHTML: "<p>Why 3?</p>" },
                { login: "dave", bodyHTML: "<p>Oops, wrong line.</p>" },
            ]),
        ];
        const [first, second] = threads[0]?.comments.nodes ?? [];
        if (!first || !second) throw new Error("fixture");
        Object.assign(second, { viewerCanUpdate: true, viewerCanDelete: true });
        open("/acme/widgets/pull/12");
        const details = await thread();
        const mine = (await within(details).findByText("Oops, wrong line.")).closest(".thread-comment") as HTMLElement;
        const theirs = within(details).getByText("Why 3?", IN_CONVERSATION).closest(".thread-comment") as HTMLElement;
        expect(within(theirs).queryByRole("button", { name: "Edit" })).toBeNull();
        fireEvent.click(within(mine).getByRole("button", { name: "Delete" }));
        expect(within(mine).getByText("Delete this comment?")).toBeTruthy();
        expect(callsOf("DeleteReviewComment")).toEqual([]);
        fireEvent.click(within(mine).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(callsOf("DeleteReviewComment")).toEqual([{ id: second.id }]));
    });
});

describe("reactions", () => {
    it("takes back a reaction and adds another from the picker", async () => {
        fields = {
            ...fields,
            reactionGroups: [{ content: "THUMBS_UP", viewerHasReacted: true, reactors: { totalCount: 2 } }],
        };
        nodes = [timeline.comment("IC_1", "carol", "<p>Looks close.</p>")];
        threads = [];
        open("/acme/widgets/pull/12");
        const description = (await screen.findByText("Turns them.")).closest(".timeline-card") as HTMLElement;
        const thumbs = within(description).getByRole("button", { name: "+1: 2" });
        expect(thumbs.getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(thumbs);
        await waitFor(() => expect(callsOf("RemoveReaction")).toEqual([{ subjectId: "PR_12", content: "THUMBS_UP" }]));

        const comment = screen.getByText("Looks close.").closest(".timeline-card") as HTMLElement;
        fireEvent.click(within(comment).getByRole("button", { name: "Add a reaction" }));
        fireEvent.click(within(comment).getByRole("menuitemcheckbox", { name: "rocket" }));
        await waitFor(() => expect(callsOf("AddReaction")).toEqual([{ subjectId: "IC_1", content: "ROCKET" }]));
    });
});

describe("viewed files", () => {
    it("folds the files you viewed, counts them, and marks them as GitHub does", async () => {
        viewed = { "src/axle.ts": "UNVIEWED", "src/gears.ts": "VIEWED", "src/lock.ts": "DISMISSED" };
        threads = [];
        open("/acme/widgets/pull/12/files");
        const section = (path: string) => screen.findByRole("region", { name: path });
        await waitFor(async () => expect((await section("src/gears.ts")).querySelector(".file-body")).toBeNull());
        expect(screen.getByText("1 / 3 viewed")).toBeTruthy();
        expect(within(await section("src/lock.ts")).getByText("Changed since last viewed")).toBeTruthy();

        const axle = await section("src/axle.ts");
        expect(axle.querySelector(".file-body")).not.toBeNull();
        fireEvent.click(within(axle).getByRole("checkbox", { name: "Viewed" }));
        expect(axle.querySelector(".file-body")).toBeNull();
        await waitFor(() =>
            expect(callsOf("MarkFileViewed")).toEqual([{ pullRequestId: "PR_12", path: "src/axle.ts" }]),
        );
        await waitFor(() => expect(screen.getByText("2 / 3 viewed")).toBeTruthy());

        const gears = await section("src/gears.ts");
        fireEvent.click(within(gears).getByRole("checkbox", { name: "Viewed" }));
        expect(gears.querySelector(".file-body")).not.toBeNull();
        await waitFor(() =>
            expect(callsOf("UnmarkFileViewed")).toEqual([{ pullRequestId: "PR_12", path: "src/gears.ts" }]),
        );
    });
});

describe("reviewers", () => {
    it("re-requests a finished review and dismisses a verdict with a reason", async () => {
        fields = {
            ...fields,
            latestReviews: {
                nodes: [
                    { id: "PRR_b", state: "APPROVED", submittedAt: "2026-11-25T11:00:00Z", author: actor("bob") },
                    { id: "PRR_c", state: "COMMENTED", submittedAt: "2026-11-25T11:00:00Z", author: actor("carol") },
                    { id: "PRR_d", state: "COMMENTED", submittedAt: "2026-11-25T11:00:00Z", author: actor("dave") },
                ],
            },
        };
        open("/acme/widgets/pull/12");
        const sidebar = await screen.findByRole("region", { name: "Reviewers" });
        const row = (login: string) => within(sidebar).getByText(login).closest("li") as HTMLElement;
        await waitFor(() => expect(within(row("bob")).getByRole("button", { name: "Re-request" })).toBeTruthy());
        // dave is the one signed in.
        expect(within(row("dave")).queryByRole("button", { name: "Re-request" })).toBeNull();
        expect(within(row("carol")).queryByRole("button", { name: "Dismiss" })).toBeNull();

        fireEvent.click(within(row("bob")).getByRole("button", { name: "Re-request" }));
        await waitFor(() => expect(callsOf("POST requested_reviewers")).toEqual([{ reviewers: ["bob"] }]));

        fireEvent.click(within(row("bob")).getByRole("button", { name: "Dismiss" }));
        const form = within(row("bob")).getByRole("form", { name: "Dismiss bob's review" });
        const send = within(form).getByRole("button", { name: "Dismiss review" }) as HTMLButtonElement;
        expect(send.disabled).toBe(true);
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Approved an older push." } });
        fireEvent.click(send);
        await waitFor(() =>
            expect(callsOf("DismissReview")).toEqual([{ id: "PRR_b", message: "Approved an older push." }]),
        );
    });
});

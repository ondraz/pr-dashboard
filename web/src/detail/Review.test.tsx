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
const DRAFTS = "draft:acme/widgets#12:";

// widgets#12 changes one file: line 2 changes and line 3 is new.
const GEARS_PATCH = [
    "@@ -1,3 +1,4 @@",
    " const teeth = 12;",
    "-const ratio = 2;",
    "+const ratio = 3;",
    "+const spin = true;",
    " export { teeth };",
].join("\n");

const signedIn: AuthApi = {
    token: async () => ({ status: "signed-in", accessToken: "ghu_test", expiresAt: Date.now() + 8 * 3_600_000 }),
    start: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    signOut: async () => {},
};

let fields: PullRequestFields;
let threads: ReviewThread[];
let refuseWrites: boolean;
const calls: { name: string; variables: Record<string, unknown> }[] = [];

const pending = (id: string, totalCount: number) => ({ nodes: [{ id, comments: { totalCount } }] });
const pendingCount = () => fields.pendingReview?.nodes?.[0]?.comments.totalCount ?? 0;

function record(name: string, variables: Record<string, unknown>) {
    calls.push({ name, variables });
}

const REFUSAL = { data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] };

const server = setupServer(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "bob" })),
    http.get(`${API}/search/issues`, () => HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] })),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/files`, () =>
        HttpResponse.json([
            { filename: "src/gears.ts", status: "modified", additions: 2, deletions: 1, patch: GEARS_PATCH },
        ]),
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
    github.query("PullRequestDetail", () => HttpResponse.json(pullRequestResponse(fields, [], threads))),
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
    github.mutation("AddPendingReview", ({ variables }) => {
        record("AddPendingReview", variables);
        if (refuseWrites) return HttpResponse.json(REFUSAL);
        fields = { ...fields, pendingReview: pending("PRR_new", 0) };
        return HttpResponse.json({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_new" } } } });
    }),
    github.mutation("AddReviewThread", ({ variables }) => {
        record("AddReviewThread", variables);
        const reviewId = String(variables.pullRequestReviewId);
        const body = String(variables.body);
        threads = [
            ...threads,
            reviewThread(
                `T_${threads.length}`,
                reviewId,
                [{ login: "bob", bodyHTML: `<p>${body}</p>`, pending: true }],
                {
                    path: String(variables.path),
                    line: (variables.line as number | null) ?? null,
                    subjectType: variables.subjectType as "LINE" | "FILE",
                },
            ),
        ];
        fields = { ...fields, pendingReview: pending(reviewId, pendingCount() + 1) };
        return HttpResponse.json({ data: { addPullRequestReviewThread: { thread: { id: "T_x" } } } });
    }),
    github.mutation("SubmitReview", ({ variables }) => {
        record("SubmitReview", variables);
        fields = { ...fields, pendingReview: { nodes: [] } };
        return HttpResponse.json({ data: { submitPullRequestReview: { pullRequestReview: { id: "PRR_new" } } } });
    }),
    github.mutation("AddReview", ({ variables }) => {
        record("AddReview", variables);
        return HttpResponse.json({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_sent" } } } });
    }),
    github.mutation("DeleteReview", ({ variables }) => {
        record("DeleteReview", variables);
        fields = { ...fields, pendingReview: { nodes: [] } };
        threads = [];
        return HttpResponse.json({ data: { deletePullRequestReview: { pullRequestReview: { id: "PRR_new" } } } });
    }),
    github.mutation("AddComment", ({ variables }) => {
        record("AddComment", variables);
        if (refuseWrites) return HttpResponse.json(REFUSAL);
        return HttpResponse.json({ data: { addComment: { commentEdge: { node: { id: "IC_new" } } } } });
    }),
    http.post(`${API}/repos/:owner/:repo/pulls/:number/comments`, async ({ request }) => {
        record("POST pulls/comments", (await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 1 }, { status: 201 });
    }),
    http.post(`${API}/markdown`, async ({ request }) => {
        record("POST markdown", (await request.json()) as Record<string, unknown>);
        return HttpResponse.text('<p><strong>Rendered</strong> by GitHub</p><img src="x" onerror="window.hit = 1">', {
            headers: { "content-type": "text/html;charset=utf-8" },
        });
    }),
);

const queryClients: QueryClient[] = [];

function open(path: string, auth: AuthApi = signedIn) {
    const app = renderApp(path, { auth, fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }) });
    queryClients.push(app.queryClient);
    return app;
}

const callsOf = (name: string) => calls.filter((call) => call.name === name).map((call) => call.variables);
const gears = () => screen.findByRole("region", { name: "src/gears.ts" });

/** The "+" GitHub-style button beside a line of the unified diff, which the diff view answers on mouse down. */
function addWidget(section: HTMLElement, side: "old" | "new", line: number): HTMLElement {
    const number = section.querySelector(`[data-line-${side}-num="${line}"]`);
    const button = number?.closest("td")?.querySelector<HTMLElement>(".diff-add-widget");
    if (!button) throw new Error(`No comment button on ${side} line ${line}`);
    return button;
}

async function startComment(line: number, side: "old" | "new" = "new") {
    const section = await gears();
    await waitFor(() => addWidget(section, side, line));
    fireEvent.mouseDown(addWidget(section, side, line));
    return section;
}

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
    fields = pullRequestFields({
        changedFiles: 1,
        headRefOid: HEAD,
        author: { login: "alice", avatarUrl: "", url: "" },
    });
    threads = [];
    refuseWrites = false;
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

describe("reviewing", () => {
    it("offers nothing that writes when signed in with a read-only token", async () => {
        sessionStorage.setItem("gh_token", "ghp_test");
        const noApp: AuthApi = { ...signedIn, token: async () => ({ status: "signed-out", configured: true }) };
        open("/acme/widgets/pull/12/files", noApp);
        const section = await gears();
        expect(screen.getByText("Read-only token")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
        expect(within(section).queryByRole("button", { name: "Comment on file" })).toBeNull();
        expect(section.querySelector(".diff-add-widget")).toBeNull();

        fireEvent.click(screen.getByRole("link", { name: "Conversation" }));
        await screen.findByRole("region", { name: "Merge status" });
        expect(screen.queryByRole("form", { name: "Add a comment" })).toBeNull();
    });

    it("starts a review from a line: a pending review at the head commit, holding the comment", async () => {
        open("/acme/widgets/pull/12/files");
        await startComment(3);
        const form = await screen.findByRole("form", { name: "Comment on line 3 on the new side" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Spin which way?" } });
        expect(within(form).getByRole("button", { name: "Add single comment" })).toBeTruthy();
        fireEvent.click(within(form).getByRole("button", { name: "Start a review" }));

        await waitFor(() => expect(screen.queryByRole("form", { name: /Comment on line 3/ })).toBeNull());
        expect(callsOf("AddPendingReview")).toEqual([{ pullRequestId: "PR_12", commitOID: HEAD }]);
        expect(callsOf("AddReviewThread")).toEqual([
            {
                pullRequestReviewId: "PRR_new",
                body: "Spin which way?",
                path: "src/gears.ts",
                subjectType: "LINE",
                line: 3,
                side: "RIGHT",
                startLine: null,
                startSide: null,
            },
        ]);
        const section = await gears();
        const comment = await within(section).findByText("Spin which way?");
        expect(within(comment.closest("details") as HTMLElement).getByText("Pending")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Finish your review (1)" })).toBeTruthy();
        expect(localStorage.getItem(`${DRAFTS}line:RIGHT:3-3:src/gears.ts`)).toBeNull();
        // Nobody else sees it yet, so neither the conversation nor the header count it.
        expect(document.querySelector(".unresolved-badge")).toBeNull();
    });

    it("comments on a range with a suggested change, and posts it on its own when asked", async () => {
        open("/acme/widgets/pull/12/files");
        await startComment(3);
        const form = await screen.findByRole("form", { name: "Comment on line 3 on the new side" });
        fireEvent.change(within(form).getByRole("combobox"), { target: { value: "2" } });
        const range = await screen.findByRole("form", { name: "Comment on lines 2 to 3 on the new side" });
        fireEvent.click(within(range).getByRole("button", { name: "Suggest a change" }));
        const suggestion = "```suggestion\nconst ratio = 3;\nconst spin = true;\n```\n";
        expect((within(range).getByRole("textbox") as HTMLTextAreaElement).value).toBe(suggestion);
        expect(localStorage.getItem(`${DRAFTS}line:RIGHT:2-3:src/gears.ts`)).toBe(suggestion);
        expect(localStorage.getItem(`${DRAFTS}line:RIGHT:3-3:src/gears.ts`)).toBeNull();

        fireEvent.click(within(range).getByRole("button", { name: "Add single comment" }));
        await waitFor(() => expect(callsOf("POST pulls/comments")).toHaveLength(1));
        expect(callsOf("POST pulls/comments")[0]).toEqual({
            commit_id: HEAD,
            path: "src/gears.ts",
            body: suggestion,
            subject_type: "line",
            line: 3,
            side: "RIGHT",
            start_line: 2,
            start_side: "RIGHT",
        });
        expect(callsOf("AddPendingReview")).toEqual([]);
        await waitFor(() => expect(screen.queryByRole("form", { name: /Comment on lines/ })).toBeNull());
    });

    it("adds to the pending review already open, on a removed line or a whole file", async () => {
        fields = { ...fields, pendingReview: pending("PRR_open", 2) };
        open("/acme/widgets/pull/12/files");
        await startComment(2, "old");
        const form = await screen.findByRole("form", { name: "Comment on line 2 on the old side" });
        expect(within(form).queryByRole("button", { name: "Add single comment" })).toBeNull();
        expect(within(form).queryByRole("button", { name: "Suggest a change" })).toBeNull();
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Was 2 wrong?" } });
        fireEvent.click(within(form).getByRole("button", { name: "Add review comment" }));
        await waitFor(() => expect(callsOf("AddReviewThread")).toHaveLength(1));

        fireEvent.click(within(await gears()).getByRole("button", { name: "Comment on file" }));
        const fileForm = await screen.findByRole("form", { name: "Comment on this file" });
        fireEvent.change(within(fileForm).getByRole("textbox"), { target: { value: "Split this file?" } });
        fireEvent.click(within(fileForm).getByRole("button", { name: "Add review comment" }));
        await waitFor(() => expect(callsOf("AddReviewThread")).toHaveLength(2));

        expect(callsOf("AddPendingReview")).toEqual([]);
        expect(callsOf("AddReviewThread")).toEqual([
            expect.objectContaining({ pullRequestReviewId: "PRR_open", line: 2, side: "LEFT", subjectType: "LINE" }),
            { pullRequestReviewId: "PRR_open", body: "Split this file?", path: "src/gears.ts", subjectType: "FILE" },
        ]);
        expect(await screen.findByRole("button", { name: "Finish your review (4)" })).toBeTruthy();
    });

    it("keeps an unsent comment, and its box, through a reload", async () => {
        open("/acme/widgets/pull/12/files");
        await startComment(3);
        const form = await screen.findByRole("form", { name: "Comment on line 3 on the new side" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Half a thought" } });
        cleanup();

        open("/acme/widgets/pull/12/files");
        const again = await screen.findByRole("form", { name: "Comment on line 3 on the new side" });
        expect((within(again).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Half a thought");
        fireEvent.click(within(again).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("form", { name: /Comment on line 3/ })).toBeNull());
        expect(localStorage.getItem(`${DRAFTS}line:RIGHT:3-3:src/gears.ts`)).toBeNull();
    });

    it("previews Markdown as GitHub renders it, sanitised", async () => {
        open("/acme/widgets/pull/12");
        const form = await screen.findByRole("form", { name: "Add a comment" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "**Rendered** by GitHub" } });
        fireEvent.click(within(form).getByRole("tab", { name: "Preview" }));
        expect(await within(form).findByText("Rendered")).toBeTruthy();
        expect(form.querySelector("img")?.getAttribute("onerror")).toBeNull();
        expect(callsOf("POST markdown")).toEqual([
            { text: "**Rendered** by GitHub", mode: "gfm", context: "acme/widgets" },
        ]);
        fireEvent.click(within(form).getByRole("tab", { name: "Write" }));
        expect((within(form).getByRole("textbox") as HTMLTextAreaElement).value).toBe("**Rendered** by GitHub");
    });

    it("comments on the PR from the foot of its conversation", async () => {
        open("/acme/widgets/pull/12");
        const form = await screen.findByRole("form", { name: "Add a comment" });
        const send = within(form).getByRole("button", { name: "Comment" });
        expect((send as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Ship it after lunch." } });
        fireEvent.click(send);
        await waitFor(() =>
            expect(callsOf("AddComment")).toEqual([{ subjectId: "PR_12", body: "Ship it after lunch." }]),
        );
        await waitFor(() => expect((within(form).getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
        expect(localStorage.getItem(`${DRAFTS}comment`)).toBeNull();
    });

    it("hides the write actions, with a note, once GitHub refuses one, keeping the text", async () => {
        refuseWrites = true;
        open("/acme/widgets/pull/12");
        const form = await screen.findByRole("form", { name: "Add a comment" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Can I?" } });
        fireEvent.click(within(form).getByRole("button", { name: "Comment" }));

        expect(await screen.findByText(/GitHub refused a change in acme\/widgets/)).toBeTruthy();
        expect(screen.getByText(/Resource not accessible by integration/)).toBeTruthy();
        expect(screen.queryByRole("form", { name: "Add a comment" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
        expect(localStorage.getItem(`${DRAFTS}comment`)).toBe("Can I?");
    });

    it("hides a refused comment on the diff with the other actions, keeping its draft", async () => {
        refuseWrites = true;
        open("/acme/widgets/pull/12/files");
        await startComment(3);
        const form = await screen.findByRole("form", { name: "Comment on line 3 on the new side" });
        fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Can I?" } });
        fireEvent.click(within(form).getByRole("button", { name: "Start a review" }));

        expect(await screen.findByText(/GitHub refused a change in acme\/widgets/)).toBeTruthy();
        expect(screen.queryByRole("form", { name: /Comment on line 3/ })).toBeNull();
        expect((await gears()).querySelector(".diff-add-widget")).toBeNull();
        expect(localStorage.getItem(`${DRAFTS}line:RIGHT:3-3:src/gears.ts`)).toBe("Can I?");
    });
});

describe("submitting a review", () => {
    it("sends the pending review with a summary and a verdict", async () => {
        fields = { ...fields, pendingReview: pending("PRR_open", 2) };
        open("/acme/widgets/pull/12");
        fireEvent.click(await screen.findByRole("button", { name: "Finish your review (2)" }));
        const panel = screen.getByRole("form", { name: "Submit review" });
        fireEvent.change(within(panel).getByRole("textbox", { name: "Review summary" }), {
            target: { value: "Two small things." },
        });
        fireEvent.click(within(panel).getByRole("radio", { name: /Approve/ }));
        fireEvent.click(within(panel).getByRole("button", { name: "Submit review" }));

        await waitFor(() => expect(screen.queryByRole("form", { name: "Submit review" })).toBeNull());
        expect(callsOf("SubmitReview")).toEqual([
            { pullRequestReviewId: "PRR_open", event: "APPROVE", body: "Two small things." },
        ]);
        expect(await screen.findByRole("button", { name: "Review changes" })).toBeTruthy();
    });

    it("on your own PR offers only a comment, which has to say something", async () => {
        fields = { ...fields, viewerDidAuthor: true };
        open("/acme/widgets/pull/12");
        fireEvent.click(await screen.findByRole("button", { name: "Review changes" }));
        const panel = screen.getByRole("form", { name: "Submit review" });
        expect((within(panel).getByRole("radio", { name: /Approve/ }) as HTMLInputElement).disabled).toBe(true);
        expect((within(panel).getByRole("radio", { name: /Request changes/ }) as HTMLInputElement).disabled).toBe(true);
        const submit = within(panel).getByRole("button", { name: "Submit review" }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        expect(within(panel).getByText("Write a summary or add a comment first.")).toBeTruthy();

        fireEvent.change(within(panel).getByRole("textbox", { name: "Review summary" }), {
            target: { value: "Notes to self." },
        });
        fireEvent.click(submit);
        await waitFor(() =>
            expect(callsOf("AddReview")).toEqual([
                { pullRequestId: "PR_12", commitOID: HEAD, event: "COMMENT", body: "Notes to self." },
            ]),
        );
    });

    it("still finishes a review left pending on a PR that has since closed", async () => {
        fields = { ...fields, state: "CLOSED", pendingReview: pending("PRR_open", 1) };
        open("/acme/widgets/pull/12");
        expect(await screen.findByRole("button", { name: "Finish your review (1)" })).toBeTruthy();
    });

    it("discards the pending review only once confirmed", async () => {
        fields = { ...fields, pendingReview: pending("PRR_open", 1) };
        threads = [reviewThread("T_p", "PRR_open", [{ login: "bob", bodyHTML: "<p>Hmm</p>", pending: true }])];
        open("/acme/widgets/pull/12");
        fireEvent.click(await screen.findByRole("button", { name: "Finish your review (1)" }));
        const panel = screen.getByRole("form", { name: "Submit review" });
        fireEvent.click(within(panel).getByRole("button", { name: "Discard review" }));
        expect(within(panel).getByText("Discard the review and its 1 pending comment?")).toBeTruthy();
        expect(callsOf("DeleteReview")).toEqual([]);
        fireEvent.click(within(panel).getByRole("button", { name: "Discard review" }));

        await waitFor(() => expect(callsOf("DeleteReview")).toEqual([{ pullRequestReviewId: "PRR_open" }]));
        expect(await screen.findByRole("button", { name: "Review changes" })).toBeTruthy();
    });
});

// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthApi } from "../app/auth.ts";
import {
    commitChecksResponse,
    pullRequestFields,
    pullRequestResponse,
    reviewThread,
    timeline,
} from "../github/prFixtures.ts";
import type { PullRequestFields, ReviewThread, TimelineNode } from "../github/pullRequest.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const HEAD = "c0ffee00c0ffee";
const EARLIER_HEAD = "a1a1a1a1a1a1";
const PATCH = "@@ -1,2 +1,2 @@\n const teeth = 12;\n-const ratio = 2;\n+const ratio = 3;";

const signedIn: AuthApi = {
    token: async () => ({ status: "signed-in", accessToken: "ghu_test", expiresAt: Date.now() + 8 * 3_600_000 }),
    start: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    signOut: async () => {},
};

let fields: PullRequestFields;
let nodes: TimelineNode[];
let threads: ReviewThread[];
const viewedCalls: string[] = [];

const server = setupServer(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "carol" })),
    http.get(`${API}/search/issues`, () => HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] })),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/files`, () =>
        HttpResponse.json(
            ["src/axle.ts", "src/gears.ts"].map((filename) => ({
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
                            nodes: ["src/axle.ts", "src/gears.ts"].map((path) => ({
                                path,
                                viewerViewedState: viewedCalls.includes(path) ? "VIEWED" : "UNVIEWED",
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
    github.mutation("MarkFileViewed", ({ variables }) => {
        viewedCalls.push(String(variables.path));
        return HttpResponse.json({ data: { markFileAsViewed: { clientMutationId: null } } });
    }),
);

const queryClients: QueryClient[] = [];

function open(path: string) {
    const app = renderApp(path, {
        auth: signedIn,
        fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }),
    });
    queryClients.push(app.queryClient);
    return app;
}

const press = (key: string) => fireEvent.keyDown(document.body, { key });

// jsdom lays nothing out: files and threads stand 1000px apart down the page in their order, and scrolling
// one into view puts it at the top of the window.
const TARGETS = ".file-diff, .thread";
let scrollY = 0;
const pageTop = (element: Element) => ([...document.querySelectorAll(TARGETS)].indexOf(element) + 1) * 1000;

const lastOpened = () => JSON.parse(localStorage.getItem("pr_last_opened") ?? "{}")["acme/widgets#12"];

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
});
beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    scrollY = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, this.matches(TARGETS) ? pageTop(this) - scrollY : 0, 800, 20);
    });
    Element.prototype.scrollIntoView = function (this: Element) {
        if (this.matches(TARGETS)) scrollY = pageTop(this);
    };
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    fields = pullRequestFields({ changedFiles: 2, headRefOid: HEAD });
    nodes = [];
    threads = [];
    viewedCalls.length = 0;
});
afterEach(async () => {
    await waitFor(() => expect(queryClients.every((client) => client.isFetching() === 0)).toBe(true));
    for (const client of queryClients.splice(0)) client.clear();
    cleanup();
    server.resetHandlers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("keyboard shortcuts", () => {
    it("steps through the files with j and k, and marks the one being read viewed with v", async () => {
        open("/acme/widgets/pull/12/files");
        await screen.findByRole("region", { name: "src/gears.ts" });
        await screen.findByText("0 / 2 viewed");

        press("j");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Collapse src/axle.ts");
        press("j");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Collapse src/gears.ts");
        press("k");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Collapse src/axle.ts");

        press("v");
        await waitFor(() => expect(viewedCalls).toEqual(["src/axle.ts"]));
        await screen.findByText("1 / 2 viewed");
        expect(screen.getByRole("button", { name: "Expand src/axle.ts" })).toBeTruthy();
    });

    it("opens a comment on the file being read with c", async () => {
        open("/acme/widgets/pull/12/files");
        await screen.findByRole("region", { name: "src/gears.ts" });
        press("j");
        press("j");
        press("c");
        const gears = screen.getByRole("region", { name: "src/gears.ts" });
        await within(gears).findByRole("form", { name: "Comment on this file" });
        expect(screen.queryAllByRole("form", { name: "Comment on this file" })).toHaveLength(1);
    });

    it("steps through the unresolved threads with n and p, past resolved ones", async () => {
        threads = [
            reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }], { line: 2 }),
            reviewThread("T_2", "PRR_1", [{ login: "bob", bodyHTML: "<p>Typo</p>" }], {
                line: 1,
                isResolved: true,
            }),
            reviewThread("T_3", "PRR_1", [{ login: "bob", bodyHTML: "<p>Spin?</p>" }], {
                path: "src/axle.ts",
                line: 2,
            }),
        ];
        nodes = [timeline.review("PRR_1", "bob", "COMMENTED")];
        open("/acme/widgets/pull/12");
        await screen.findByText("Why 3?");
        const summaryOf = (text: string) => screen.getByText(text).closest("details")?.querySelector("summary");

        press("n");
        expect(document.activeElement).toBe(summaryOf("Why 3?"));
        press("n");
        expect(document.activeElement).toBe(summaryOf("Spin?"));
        press("p");
        expect(document.activeElement).toBe(summaryOf("Why 3?"));
    });

    it("puts the focus in the PR's comment box with c", async () => {
        open("/acme/widgets/pull/12");
        const box = await screen.findByRole("textbox", { name: "Add a comment" });
        press("c");
        expect(document.activeElement).toBe(box);
        expect((box as HTMLTextAreaElement).value).toBe("");
    });

    it("lists the shortcuts on ?, and closes the list on Escape", async () => {
        open("/acme/widgets/pull/12");
        await screen.findByRole("textbox", { name: "Add a comment" });
        press("?");
        const list = screen.getByRole("region", { name: "Keyboard shortcuts" });
        expect(within(list).getByText("Mark the current file viewed, or not (Files changed)")).toBeTruthy();
        press("Escape");
        expect(screen.queryByRole("region", { name: "Keyboard shortcuts" })).toBeNull();
    });

    it("leaves the keys alone while typing", async () => {
        open("/acme/widgets/pull/12");
        const box = await screen.findByRole("textbox", { name: "Add a comment" });
        fireEvent.keyDown(box, { key: "?" });
        expect(screen.queryByRole("region", { name: "Keyboard shortcuts" })).toBeNull();
    });
});

describe("the conversation's Unresolved filter", () => {
    it("narrows the conversation to the reviews with unresolved threads, and back", async () => {
        nodes = [
            timeline.comment("IC_1", "bob", "<p>Looks close.</p>"),
            timeline.review("PRR_1", "bob", "CHANGES_REQUESTED"),
            timeline.commit("aaaaaaa1", "Fix the ratio"),
        ];
        threads = [
            reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }]),
            reviewThread("T_2", "PRR_1", [{ login: "bob", bodyHTML: "<p>Typo</p>" }], { isResolved: true }),
        ];
        open("/acme/widgets/pull/12");
        await screen.findByText("Looks close.");

        fireEvent.click(screen.getByRole("button", { name: "Unresolved 1" }));
        expect(screen.queryByText("Looks close.")).toBeNull();
        expect(screen.queryByText("Fix the ratio")).toBeNull();
        expect(screen.queryByText("Typo")).toBeNull();
        expect(screen.getByText("Why 3?")).toBeTruthy();
        expect(screen.getByText("requested changes")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Everything" }));
        expect(screen.getByText("Looks close.")).toBeTruthy();
        expect(screen.getByText("Typo")).toBeTruthy();
    });

    it("says when nothing is unresolved", async () => {
        nodes = [timeline.comment("IC_1", "bob", "<p>Looks close.</p>")];
        open("/acme/widgets/pull/12");
        await screen.findByText("Looks close.");
        fireEvent.click(screen.getByRole("button", { name: "Unresolved 0" }));
        expect(screen.getByText("Nothing is unresolved.")).toBeTruthy();
    });
});

describe("new since you last opened", () => {
    beforeEach(() => {
        nodes = [
            timeline.comment("IC_1", "bob", "<p>Seen before.</p>"),
            timeline.review("PRR_1", "bob", "COMMENTED"),
            timeline.forcePush("FP_1", "a1a1a1a", "c0ffee0"),
        ];
        threads = [reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }])];
    });

    it("marks nothing on a first visit, and remembers the visit", async () => {
        open("/acme/widgets/pull/12");
        await screen.findByText("Why 3?");
        expect(document.querySelectorAll(".new-tag")).toHaveLength(0);
        await waitFor(() => expect(lastOpened()).toEqual({ at: expect.any(String), head: HEAD }));
    });

    it("marks what others did after the last visit, and keeps the marks for this one", async () => {
        localStorage.setItem(
            "pr_last_opened",
            JSON.stringify({ "acme/widgets#12": { at: "2026-11-25T10:30:00Z", head: EARLIER_HEAD } }),
        );
        open("/acme/widgets/pull/12");
        await screen.findByText("Why 3?");
        // bob's review and its comment came after 10:30; alice force-pushed at 12:00. bob's comment at 10:00 did not.
        expect(screen.getByText(/3 new entries since you last opened this pull request/)).toBeTruthy();
        const card = screen.getByText("Seen before.").closest(".timeline-card") as HTMLElement;
        expect(card.querySelector(".new-tag")).toBeNull();
        expect(within(screen.getByText("Why 3?").closest("details") as HTMLElement).getByText("New")).toBeTruthy();

        await waitFor(() => expect(lastOpened().head).toBe(HEAD));
        expect(Date.parse(lastOpened().at)).toBeGreaterThan(Date.parse("2026-11-25T10:30:00Z"));
        expect(screen.getByText(/3 new entries/)).toBeTruthy();
    });

    it("never marks the reader's own", async () => {
        localStorage.setItem(
            "pr_last_opened",
            JSON.stringify({ "acme/widgets#12": { at: "2026-11-25T10:30:00Z", head: HEAD } }),
        );
        nodes = [{ ...timeline.comment("IC_2", "carol", "<p>Mine.</p>"), createdAt: "2026-11-26T10:00:00Z" }];
        threads = [];
        open("/acme/widgets/pull/12");
        await screen.findByText("Mine.");
        expect(document.querySelectorAll(".new-tag")).toHaveLength(0);
    });

    it("offers the changes pushed since the last visit on the Files changed tab", async () => {
        localStorage.setItem(
            "pr_last_opened",
            JSON.stringify({ "acme/widgets#12": { at: "2026-11-25T10:30:00Z", head: EARLIER_HEAD } }),
        );
        open("/acme/widgets/pull/12/files");
        const link = await screen.findByRole("link", { name: "show the changes since then" });
        expect(link.getAttribute("href")).toBe(`/acme/widgets/pull/12/files/${EARLIER_HEAD}..${HEAD}`);
    });

    it("offers nothing on the Files changed tab when the branch has not moved", async () => {
        localStorage.setItem(
            "pr_last_opened",
            JSON.stringify({ "acme/widgets#12": { at: "2026-11-25T10:30:00Z", head: HEAD } }),
        );
        open("/acme/widgets/pull/12/files");
        await screen.findByRole("region", { name: "src/gears.ts" });
        expect(screen.queryByRole("link", { name: "show the changes since then" })).toBeNull();
    });
});

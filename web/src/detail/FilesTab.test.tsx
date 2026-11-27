// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pullRequestFields, pullRequestResponse } from "../github/prFixtures.ts";
import { pullJson } from "../github/testFixtures.ts";
import { renderApp } from "../testApp.tsx";

const API = "https://api.github.com";
const github = mockGraphql.link(`${API}/graphql`);
const PR_URL = "https://github.com/acme/widgets/pull/12";

const restFile = (filename: string, extra: Record<string, unknown> = {}) => ({
    filename,
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: "@@ -1,2 +1,2 @@\n const teeth = 12;\n-const ratio = 2;\n+const ratio = 3;",
    ...extra,
});

const bigPatch = `@@ -0,0 +1,450 @@\n${Array.from({ length: 450 }, (_, n) => `+row ${n}`).join("\n")}`;

// widgets#12 changes gears.ts, adds a large table, renames a doc without touching it, adds a picture, and
// changes a lockfile so much that GitHub leaves its patch out.
const FILES = [
    restFile("src/gears.ts"),
    restFile("src/table.ts", { status: "added", additions: 450, deletions: 0, patch: bigPatch }),
    restFile("docs/guide.md", {
        status: "renamed",
        previous_filename: "docs/manual.md",
        additions: 0,
        deletions: 0,
        patch: undefined,
    }),
    restFile("docs/logo.png", { status: "added", additions: 0, deletions: 0, patch: undefined }),
    restFile("package-lock.json", { additions: 2, deletions: 1, patch: undefined }),
];

const RAW_DIFF = [
    "diff --git a/package-lock.json b/package-lock.json",
    "index 1111111..2222222 100644",
    "--- a/package-lock.json",
    "+++ b/package-lock.json",
    "@@ -1,3 +1,4 @@",
    " {",
    '-  "version": "1.0.0"',
    '+  "version": "1.1.0",',
    '+  "private": true',
    " }",
    "",
].join("\n");

let rawDiffRequests = 0;
let rawDiffStatus = 200;

const server = setupServer(
    http.get(`${API}/user`, () => HttpResponse.json({ login: "alice" })),
    http.get(`${API}/search/issues`, () => HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] })),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/files`, () => HttpResponse.json(FILES)),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ request }) => {
        if (request.headers.get("accept")?.includes("diff")) {
            rawDiffRequests++;
            if (rawDiffStatus !== 200) {
                return HttpResponse.json(
                    { message: "Sorry, the diff exceeded the maximum number of lines (20000)" },
                    { status: rawDiffStatus },
                );
            }
            return HttpResponse.text(RAW_DIFF, {
                headers: { "content-type": "application/vnd.github.diff; charset=utf-8" },
            });
        }
        return HttpResponse.json(pullJson("acme/widgets", 12, "tip", "main", { title: "Turn the gears" }));
    }),
    http.get(`${API}/repos/:owner/:repo/pulls`, () => HttpResponse.json([])),
    github.query("ChangeProbe", () =>
        HttpResponse.json({
            data: {
                mine: { issueCount: 0, nodes: [] },
                requested: { issueCount: 0, nodes: [] },
                reviewed: { issueCount: 0, nodes: [] },
            },
        }),
    ),
    github.query("PullRequestDetail", () =>
        HttpResponse.json(pullRequestResponse(pullRequestFields({ changedFiles: FILES.length }), [], [])),
    ),
);
const queryClients: QueryClient[] = [];

function open(path: string) {
    const app = renderApp(path, { fetchSessions: async () => ({ made: new Map(), reviewed: new Map() }) });
    queryClients.push(app.queryClient);
    return app;
}

const fileSection = (path: string) => screen.findByRole("region", { name: path });
// The changed lines and the context around them, each as its marker and its text.
const diffRows = (section: HTMLElement) =>
    [...section.querySelectorAll('tr[data-state="diff"] .diff-line-content-item')].map((cell) =>
        cell.textContent?.trimEnd(),
    );

beforeAll(() => {
    server.listen({ onUnhandledFrame: "error" });
    // jsdom draws nothing: the diff view measures text on a canvas and watches its own size.
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
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    sessionStorage.setItem("gh_token", "ghp_test");
    rawDiffRequests = 0;
    rawDiffStatus = 200;
});
afterEach(async () => {
    await waitFor(() => expect(queryClients.every((client) => client.isFetching() === 0)).toBe(true));
    for (const client of queryClients.splice(0)) client.clear();
    cleanup();
    server.resetHandlers();
    vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("Files changed", () => {
    it("opens from the tab, full width, with the tree beside every diff in the tree's order", async () => {
        const { router } = open("/acme/widgets/pull/12");
        fireEvent.click(await screen.findByRole("link", { name: /Files changed/ }));
        await fileSection("src/gears.ts");
        expect(router.state.location.pathname).toBe("/acme/widgets/pull/12/files");
        expect(screen.getByRole("link", { name: /Files changed/ }).getAttribute("aria-current")).toBe("page");
        expect(screen.queryByRole("region", { name: "Reviewers" })).toBeNull();
        expect(document.querySelector(".detail-container")?.classList.contains("wide")).toBe(true);

        expect(document.querySelector(".files-summary")?.textContent).toBe("5 files changed +453 −2");
        const tree = screen.getByRole("navigation", { name: "Changed files" });
        expect([...tree.querySelectorAll("summary, button")].map((node) => node.textContent)).toEqual([
            "docs",
            "→guide.md",
            "+logo.png",
            "src",
            "•gears.ts",
            "+table.ts",
            "•package-lock.json",
        ]);
        expect(
            [...document.querySelectorAll(".file-diff")].map((section) => section.getAttribute("aria-label")),
        ).toEqual(["docs/guide.md", "docs/logo.png", "src/gears.ts", "src/table.ts", "package-lock.json"]);
    });

    it("shows a file's hunks, highlighted, with a link to the file on GitHub", async () => {
        open("/acme/widgets/pull/12/files");
        const gears = await fileSection("src/gears.ts");
        expect(diffRows(gears)).toEqual([" const teeth = 12;", "-const ratio = 2;", "+const ratio = 3;"]);
        expect(gears.querySelector(".hljs-keyword")?.textContent).toBe("const");
        expect(within(gears).getByRole("link", { name: "View file" }).getAttribute("href")).toBe(
            "https://github.com/acme/widgets/blob/tip-sha/src/gears.ts",
        );
    });

    it("switches between unified and split, and remembers the choice", async () => {
        open("/acme/widgets/pull/12/files");
        const gears = await fileSection("src/gears.ts");
        expect(gears.querySelector(".unified-diff-table")).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Split" }));
        await waitFor(() => expect(gears.querySelector(".unified-diff-table")).toBeNull());
        expect(gears.querySelector(".diff-line-old-content")).not.toBeNull();
        expect(screen.getByRole("button", { name: "Split" }).getAttribute("aria-pressed")).toBe("true");
        expect(localStorage.getItem("diff_view")).toBe("split");
    });

    it("says what it does not draw: a rename without changes and a binary file", async () => {
        open("/acme/widgets/pull/12/files");
        const renamed = await fileSection("docs/guide.md");
        expect(renamed.querySelector(".file-path")?.textContent).toBe("docs/manual.md → docs/guide.md");
        expect(within(renamed).getByText("Renamed")).toBeTruthy();
        expect(within(renamed).getByText("File renamed without changes.")).toBeTruthy();
        expect(within(await fileSection("docs/logo.png")).getByText("Binary or empty file, not shown.")).toBeTruthy();
    });

    it("holds back a large diff until asked", async () => {
        open("/acme/widgets/pull/12/files");
        const table = await fileSection("src/table.ts");
        expect(diffRows(table)).toEqual([]);
        fireEvent.click(within(table).getByRole("button", { name: "Load diff" }));
        await waitFor(() => expect(diffRows(table).length).toBeGreaterThan(0));
        expect(diffRows(table)[0]).toBe("+row 0");
    });

    it("falls back on the raw diff for a file whose patch GitHub left out, reading it once", async () => {
        open("/acme/widgets/pull/12/files");
        const lockfile = await fileSection("package-lock.json");
        await waitFor(() => expect(diffRows(lockfile)).toHaveLength(5));
        expect(diffRows(lockfile).slice(1, 4)).toEqual([
            '-  "version": "1.0.0"',
            '+  "version": "1.1.0",',
            '+  "private": true',
        ]);
        expect(rawDiffRequests).toBe(1);
    });

    it("points to GitHub when the raw diff is too large for its API", async () => {
        rawDiffStatus = 406;
        open("/acme/widgets/pull/12/files");
        const lockfile = await fileSection("package-lock.json");
        const note = await within(lockfile).findByText(/GitHub's API does not send this diff/);
        expect(note.textContent).toContain("maximum number of lines");
        expect(within(lockfile).getByRole("link", { name: "Open it on GitHub" }).getAttribute("href")).toBe(
            `${PR_URL}/files`,
        );
    });

    it("narrows the tree and the diffs to the files that match the filter", async () => {
        open("/acme/widgets/pull/12/files");
        await fileSection("src/gears.ts");
        fireEvent.change(screen.getByRole("searchbox", { name: "Filter changed files" }), {
            target: { value: "MANUAL" },
        });
        expect(
            [...document.querySelectorAll(".file-diff")].map((section) => section.getAttribute("aria-label")),
        ).toEqual(["docs/guide.md"]);
        fireEvent.change(screen.getByRole("searchbox", { name: "Filter changed files" }), {
            target: { value: "nothing" },
        });
        expect(screen.getByText("No file matches.")).toBeTruthy();
    });

    it("collapses a file, all of them, and opens one again from the tree", async () => {
        open("/acme/widgets/pull/12/files");
        const gears = await fileSection("src/gears.ts");
        fireEvent.click(within(gears).getByRole("button", { name: "Collapse src/gears.ts" }));
        expect(gears.querySelector(".file-body")).toBeNull();
        const expand = within(gears).getByRole("button", { name: "Expand src/gears.ts" });
        expect(expand.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(expand);
        expect(gears.querySelector(".file-body")).not.toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
        expect(document.querySelectorAll(".file-body")).toHaveLength(0);
        const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
        fireEvent.click(screen.getByRole("button", { name: "gears.ts" }));
        expect(gears.querySelector(".file-body")).not.toBeNull();
        expect(scrolled).toHaveBeenCalled();
        expect(document.querySelectorAll(".file-body")).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
        expect(document.querySelectorAll(".file-body")).toHaveLength(5);
    });
});

// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    checkAnnotation,
    checkRun,
    commitChecksResponse,
    pullCommit,
    pullRequestFields,
    pullRequestResponse,
    reviewThread,
} from "../github/prFixtures.ts";
import type { PullRequestFields, ReviewThread } from "../github/pullRequest.ts";
import { pullJson } from "../github/testFixtures.ts";
import type { CheckNode } from "../logic/checks.ts";
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

const BASE = "0a0a0a0a0a0a";
const FIRST = "aaaaaaa1111";
const SECOND = "bbbbbbb2222";
const HEAD = "c0ffee00c0ffee";

// gears.ts at the head commit, around the one line the PR changes.
const GEARS_AT_HEAD = "const teeth = 12;\nconst ratio = 3;\nexport { teeth, ratio };\n";

let rawDiffRequests = 0;
let rawDiffStatus = 200;
let fields: PullRequestFields;
let threads: ReviewThread[];
let checks: CheckNode[] | null;
const reads: string[] = [];
const checkReads: string[] = [];

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
    github.query("PullRequestDetail", () => HttpResponse.json(pullRequestResponse(fields, [], threads))),
    github.query("CommitChecks", ({ variables }) => {
        checkReads.push(String(variables.oid));
        return HttpResponse.json(commitChecksResponse(checks));
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
                                { commit: pullCommit(FIRST, "Cut the teeth") },
                                { commit: pullCommit(SECOND, "Oil the axle", "bob") },
                            ],
                        },
                    },
                },
            },
        }),
    ),
    http.get(`${API}/repos/:owner/:repo/commits/:ref`, ({ params }) => {
        reads.push(`commit ${params.ref}`);
        return HttpResponse.json({
            sha: params.ref,
            html_url: `https://github.com/acme/widgets/commit/${params.ref}`,
            author: { login: "bob" },
            commit: {
                message: "Oil the axle\n\nIt squeaked.",
                author: { name: "bob", date: "2026-11-25T09:00:00Z" },
                committer: { name: "bob", date: "2026-11-25T09:00:00Z" },
            },
            files: [restFile("src/axle.ts")],
        });
    }),
    http.get(`${API}/repos/:owner/:repo/compare/:basehead`, ({ params }) => {
        reads.push(`compare ${params.basehead}`);
        return HttpResponse.json({
            status: String(params.basehead).startsWith(FIRST) ? "diverged" : "ahead",
            files: [restFile("src/gears.ts"), restFile("src/axle.ts")],
        });
    }),
    http.get(`${API}/repos/:owner/:repo/contents/*`, ({ request }) => {
        const url = new URL(request.url);
        reads.push(`contents ${url.pathname.split("/contents/")[1]} at ${url.searchParams.get("ref")}`);
        return HttpResponse.text(GEARS_AT_HEAD, {
            headers: { "content-type": "application/vnd.github.raw; charset=utf-8" },
        });
    }),
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
    // A thread under a line is drawn only once the diff knows how wide it is.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 20));
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("refresh_interval", "0");
    sessionStorage.setItem("gh_token", "ghp_test");
    rawDiffRequests = 0;
    rawDiffStatus = 200;
    fields = pullRequestFields({ changedFiles: FILES.length, headRefOid: HEAD, baseRefOid: BASE });
    threads = [];
    checks = null;
    reads.length = 0;
    checkReads.length = 0;
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
            `https://github.com/acme/widgets/blob/${HEAD}/src/gears.ts`,
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

    it("shows each review thread at its line, file threads above the file, and outdated ones apart", async () => {
        threads = [
            reviewThread("T_line", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }], { line: 2 }),
            reviewThread("T_file", "PRR_1", [{ login: "bob", bodyHTML: "<p>Rename it back?</p>" }], {
                path: "docs/guide.md",
                line: null,
                originalLine: null,
                subjectType: "FILE",
            }),
            reviewThread("T_old", "PRR_1", [{ login: "carol", bodyHTML: "<p>Was 2 before.</p>" }], {
                isOutdated: true,
                line: null,
            }),
        ];
        open("/acme/widgets/pull/12/files");
        const gears = await fileSection("src/gears.ts");
        expect(within(gears).getByText("1 thread")).toBeTruthy();
        const below = await within(gears).findByText("Why 3?");
        // Under the added line it was left on, without repeating the diff it sits in.
        const row = below.closest("tr") as HTMLElement;
        expect(row.getAttribute("data-state")).toBe("extend");
        expect(row.previousElementSibling?.textContent).toContain("const ratio = 3;");
        expect(row.querySelector(".hunk")).toBeNull();

        // In split view it sits on its own side, with nothing across from it.
        fireEvent.click(screen.getByRole("button", { name: "Split" }));
        const split = await within(gears).findByText("Why 3?");
        expect(split.closest("td")?.className).toContain("diff-line-extend-new-content");

        const guide = await fileSection("docs/guide.md");
        expect(within(guide).getByText("Rename it back?")).toBeTruthy();
        expect(within(guide).getByText("File renamed without changes.")).toBeTruthy();

        const apart = screen.getByRole("region", { name: "Threads outside the diff" });
        expect(within(apart).getByText("Was 2 before.")).toBeTruthy();
        expect(within(apart).getByText("Outdated")).toBeTruthy();
        expect(apart.querySelector(".hunk")).not.toBeNull();
    });

    it("shows the checks' annotations at their lines, and above the file when the diff leaves the line out", async () => {
        checks = [
            checkRun("test", "FAILURE", {}, [
                checkAnnotation("src/gears.ts", 2, "Expected 3 to be 4"),
                checkAnnotation("src/gears.ts", 3, "Unused export", { annotationLevel: "WARNING" }),
                checkAnnotation("src/axle.ts", 1, "Not in this diff"),
            ]),
        ];
        open("/acme/widgets/pull/12/files");
        const gears = await fileSection("src/gears.ts");
        expect(await within(gears).findByText("2 annotations")).toBeTruthy();
        const below = within(gears).getByText("Expected 3 to be 4");
        const row = below.closest("tr") as HTMLElement;
        expect(row.getAttribute("data-state")).toBe("extend");
        expect(row.previousElementSibling?.textContent).toContain("const ratio = 3;");
        expect(within(gears).getByRole("note", { name: "Warning: CI / test" }).closest(".file-level")).not.toBeNull();
        expect(within(gears).getByRole("link", { name: "src/gears.ts:3" })).toBeTruthy();
        expect(screen.queryByText("Not in this diff")).toBeNull();
        expect(checkReads).toEqual([HEAD]);
    });

    it("reads a file at the head commit to show the lines around its changes", async () => {
        open("/acme/widgets/pull/12/files");
        const gears = await fileSection("src/gears.ts");
        const allRows = () =>
            [...gears.querySelectorAll("tr .diff-line-content-item")].map((cell) => cell.textContent?.trimEnd());
        expect(allRows()).not.toContain(" export { teeth, ratio };");

        fireEvent.click(within(gears).getByRole("button", { name: "Load context" }));
        fireEvent.click(await within(gears).findByRole("button", { name: "Show the whole file" }));
        await waitFor(() => expect(allRows()).toContain(" export { teeth, ratio };"));
        expect(reads).toEqual([`contents src/gears.ts at ${HEAD}`]);
        // An added file has no surroundings to read.
        expect(within(await fileSection("src/table.ts")).queryByRole("button", { name: "Load context" })).toBeNull();
    });

    it("shows one commit's changes at its GitHub path, with steps to the commits either side", async () => {
        const { router } = open(`/acme/widgets/pull/12/commits/${SECOND}`);
        const axle = await fileSection("src/axle.ts");
        expect(diffRows(axle)).toEqual([" const teeth = 12;", "-const ratio = 2;", "+const ratio = 3;"]);
        expect(screen.getByRole("heading", { level: 2, name: "Oil the axle" })).toBeTruthy();
        expect(screen.getByText("It squeaked.")).toBeTruthy();
        expect(document.querySelector(".commit-header .commit-meta")?.textContent).toContain("commit 2 of 2");
        expect(screen.getByRole("link", { name: /Commits/ }).getAttribute("aria-current")).toBe("page");
        expect(document.querySelector(".commit-picker summary")?.textContent).toBe("Commit bbbbbbb ▾");
        expect(reads).toEqual([`commit ${SECOND}`]);
        // The checks ran on the head commit, so an earlier commit's diff has no annotations to read.
        expect(checkReads).toEqual([]);

        fireEvent.click(screen.getByRole("link", { name: "‹ Previous commit" }));
        await waitFor(() => expect(router.state.location.pathname).toBe(`/acme/widgets/pull/12/commits/${FIRST}`));
        await waitFor(() => expect(reads).toContain(`commit ${FIRST}`));
    });

    it("picks one commit or a range of them from the menu", async () => {
        const { router } = open("/acme/widgets/pull/12/files");
        await fileSection("src/gears.ts");
        const menu = document.querySelector(".commit-menu") as HTMLElement;
        await within(menu).findByText("Cut the teeth");

        fireEvent.click(within(menu).getByRole("link", { name: /Oil the axle/ }));
        await waitFor(() => expect(router.state.location.pathname).toBe(`/acme/widgets/pull/12/files/${SECOND}`));
        await fileSection("src/axle.ts");

        const range = document.querySelector(".commit-range") as HTMLFormElement;
        fireEvent.change(within(range).getByLabelText("From"), { target: { value: "0" } });
        fireEvent.change(within(range).getByLabelText("To"), { target: { value: "1" } });
        fireEvent.click(within(range).getByRole("button", { name: "Show these commits" }));
        // From the PR's base, since the range starts at its first commit.
        await waitFor(() =>
            expect(router.state.location.pathname).toBe(`/acme/widgets/pull/12/files/${BASE}..${SECOND}`),
        );
        await waitFor(() => expect(reads).toContain(`compare ${BASE}...${SECOND}`));
        expect(document.querySelectorAll(".file-diff")).toHaveLength(2);
    });

    it("shows the changes since your last review, and says when the branch was rewritten since", async () => {
        fields = { ...fields, viewerLatestReview: { submittedAt: "2026-11-24T10:00:00Z", commit: { oid: FIRST } } };
        threads = [reviewThread("T_line", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }])];
        const { router } = open("/acme/widgets/pull/12/files");
        await fileSection("src/gears.ts");
        const since = screen.getByRole("link", { name: "Changes since your last review" });
        expect(since.getAttribute("href")).toBe(`/acme/widgets/pull/12/files/${FIRST}..${HEAD}`);

        fireEvent.click(since);
        await waitFor(() =>
            expect(router.state.location.pathname).toBe(`/acme/widgets/pull/12/files/${FIRST}..${HEAD}`),
        );
        expect(await screen.findByText(/The branch was rewritten after/)).toBeTruthy();
        expect(document.querySelector(".commit-picker summary")?.textContent).toBe("Changes since your last review ▾");
        expect(reads).toContain(`compare ${FIRST}...${HEAD}`);
        // Thread lines belong to the whole diff, so a range points there instead.
        expect(screen.queryByText("Why 3?")).toBeNull();
        expect(screen.getByRole("link", { name: "all changes" }).getAttribute("href")).toBe(
            "/acme/widgets/pull/12/files",
        );
    });

    it("says when nothing changed since your last review", async () => {
        fields = { ...fields, viewerLatestReview: { submittedAt: "2026-11-24T10:00:00Z", commit: { oid: HEAD } } };
        open("/acme/widgets/pull/12/files");
        await fileSection("src/gears.ts");
        expect(screen.getByText("No new changes since your last review")).toBeTruthy();
    });

    it("answers a range that is not one with a way back to the list", async () => {
        open("/acme/widgets/pull/12/files/main..tip");
        expect(await screen.findByRole("link", { name: "Back to the list" })).toBeTruthy();
    });
});

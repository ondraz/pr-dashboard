import type { Page, Request, Route } from "@playwright/test";
import {
    actor,
    commitChecksResponse,
    pullCommit,
    pullRequestFields,
    pullRequestResponse,
    reviewThread,
    timeline,
} from "../web/src/github/prFixtures.ts";
import type { PullRequestFields, ReviewThread, TimelineNode } from "../web/src/github/pullRequest.ts";
import { outstanding, pullJson, searchHit, thread } from "../web/src/github/testFixtures.ts";

/** A fictional PR, which the server's fixture sessions say Claude sessions made. */
export const REPO = "example-org/widgets";
export const NUMBER = 3;
export const PR_ID = "PR_3";
export const PR_PATH = `/${REPO}/pull/${NUMBER}`;
export const TITLE = "Turn the gears";
export const HEAD = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
const PR_URL = `https://github.com${PR_PATH}`;

export interface FileJson {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string;
}

const lines = (...rows: string[]) => rows.join("\n");

/** gears.ts changes a line for real and re-indents another; axle.ts is only re-indented. */
export const FILES: FileJson[] = [
    {
        filename: "src/axle.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: lines("@@ -1,3 +1,3 @@", " export function spin() {", "-  return 1;", "+    return 1;", " }"),
    },
    {
        filename: "src/gears.ts",
        status: "modified",
        additions: 2,
        deletions: 2,
        patch: lines(
            "@@ -1,4 +1,4 @@",
            " const teeth = 12;",
            "-const ratio = 2;",
            "-  spin();",
            "+const ratio = 3;",
            "+spin();",
            " export { teeth };",
        ),
    },
];

// A transparent pixel for the avatars, which the page may load from GitHub's image host.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * GitHub's API and the local server's sign-in as the page sees them, answered inside the browser: nothing
 * leaves the machine. Writes are recorded, and so is any request it has no answer for.
 */
export class FakeGitHub {
    readonly writes: { name: string; variables: Record<string, unknown> }[] = [];
    readonly unexpected: string[] = [];
    files: FileJson[] = FILES;
    fields: PullRequestFields = pullRequestFields({
        id: PR_ID,
        number: NUMBER,
        url: PR_URL,
        title: TITLE,
        headRefOid: HEAD,
        changedFiles: FILES.length,
        author: actor("alice"),
    });
    nodes: TimelineNode[] = [timeline.comment("IC_1", "bob", "<p>Close, one question.</p>")];
    threads: ReviewThread[] = [reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }])];
    readonly viewed = new Set<string>();

    async install(page: Page): Promise<void> {
        await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
            this.unexpected.push(`${route.request().method()} ${route.request().url()}`);
            return route.abort();
        });
        await page.route("https://avatars.githubusercontent.com/**", (route) =>
            route.fulfill({ contentType: "image/gif", body: PIXEL }),
        );
        await page.route("https://api.github.com/**", (route) => this.#answer(route));
        await page.route("**/auth/token", (route) =>
            route.fulfill({
                json: { status: "signed-in", accessToken: "ghu_e2e", expiresAt: Date.now() + 8 * 3_600_000 },
            }),
        );
        // Refresh only on returning to the tab, so a test sees no refresh it did not cause.
        await page.addInitScript(() => localStorage.setItem("refresh_interval", "0"));
    }

    #reply(route: Route, status: number, body: unknown): Promise<void> {
        const request = route.request();
        return route.fulfill({
            status,
            json: body,
            headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
                "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*",
                "access-control-expose-headers": "ETag, Link, X-RateLimit-Limit, X-RateLimit-Remaining",
            },
        });
    }

    #answer(route: Route): Promise<void> {
        const request = route.request();
        if (request.method() === "OPTIONS") return this.#reply(route, 204, null);
        const { pathname, searchParams } = new URL(request.url());
        if (request.method() === "POST" && pathname === "/graphql") return this.#graphql(route, request);
        const body = request.method() === "GET" ? this.#rest(pathname, searchParams, request) : undefined;
        if (body === undefined) {
            this.unexpected.push(`${request.method()} ${request.url()}`);
            return this.#reply(route, 404, { message: "Not Found" });
        }
        return this.#reply(route, 200, body);
    }

    #rest(path: string, search: URLSearchParams, request: Request): unknown {
        const pull = `/repos/${REPO}/pulls/${NUMBER}`;
        if (path === "/user") return { login: "alice" };
        if (path === "/search/issues") {
            const q = search.get("q") ?? "";
            const items = /review-requested:|reviewed-by:/.test(q) ? [] : [searchHit(REPO, NUMBER, { title: TITLE })];
            return { total_count: items.length, incomplete_results: false, items };
        }
        if (path === pull && !request.headers().accept?.includes("diff")) {
            return pullJson(REPO, NUMBER, "tip", "main", { title: TITLE });
        }
        if (path === `${pull}/reviews`) return [];
        if (path === `${pull}/files`) return this.files;
        if (path === `/repos/${REPO}/pulls`) return [];
        return undefined;
    }

    #graphql(route: Route, request: Request): Promise<void> {
        const { query, variables = {} } = request.postDataJSON() as {
            query: string;
            variables?: Record<string, unknown>;
        };
        const name = /\b(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
        const data = this.#operation(name, variables);
        if (data === undefined) {
            this.unexpected.push(`graphql ${name}`);
            return this.#reply(route, 200, { data: null, errors: [{ message: `No answer for ${name}` }] });
        }
        return this.#reply(route, 200, { data });
    }

    #operation(name: string, variables: Record<string, unknown>): unknown {
        const pending = this.fields.pendingReview?.nodes?.[0];
        switch (name) {
            case "OutstandingWorkBatch": {
                const unresolved = this.threads
                    .filter((item) => !item.isResolved)
                    .map(() => thread(false, "bob", "bob"));
                return { pr0: { pullRequest: outstanding(unresolved) } };
            }
            case "ChangeProbe":
                return {
                    mine: { issueCount: 0, nodes: [] },
                    requested: { issueCount: 0, nodes: [] },
                    reviewed: { issueCount: 0, nodes: [] },
                };
            case "PullRequestDetail":
                return pullRequestResponse(this.fields, this.nodes, this.threads).data;
            case "CommitChecks":
                return commitChecksResponse(null, "SUCCESS").data;
            case "PullRequestCommits":
                return {
                    repository: {
                        pullRequest: {
                            commits: {
                                totalCount: 1,
                                pageInfo: { hasNextPage: false, endCursor: null },
                                nodes: [{ commit: pullCommit(HEAD, "Turn them") }],
                            },
                        },
                    },
                };
            case "PullRequestViewedFiles":
                return {
                    repository: {
                        pullRequest: {
                            files: {
                                pageInfo: { hasNextPage: false, endCursor: null },
                                nodes: this.files.map(({ filename }) => ({
                                    path: filename,
                                    viewerViewedState: this.viewed.has(filename) ? "VIEWED" : "UNVIEWED",
                                })),
                            },
                        },
                    },
                };
            case "AddPendingReview":
                this.writes.push({ name, variables });
                this.fields = {
                    ...this.fields,
                    pendingReview: { nodes: [{ id: "PRR_new", comments: { totalCount: 0 } }] },
                };
                return { addPullRequestReview: { pullRequestReview: { id: "PRR_new" } } };
            case "AddReviewThread":
                this.writes.push({ name, variables });
                this.threads = [
                    ...this.threads,
                    reviewThread(
                        "T_new",
                        "PRR_new",
                        [{ login: "alice", bodyHTML: `<p>${String(variables.body)}</p>`, pending: true }],
                        { path: String(variables.path), line: variables.line as number },
                    ),
                ];
                this.fields = {
                    ...this.fields,
                    pendingReview: {
                        nodes: [{ id: "PRR_new", comments: { totalCount: (pending?.comments.totalCount ?? 0) + 1 } }],
                    },
                };
                return { addPullRequestReviewThread: { thread: { id: "T_new" } } };
            case "SubmitReview":
                this.writes.push({ name, variables });
                this.fields = { ...this.fields, pendingReview: { nodes: [] } };
                return { submitPullRequestReview: { pullRequestReview: { id: "PRR_new" } } };
            case "MarkFileViewed":
                this.writes.push({ name, variables });
                this.viewed.add(String(variables.path));
                return { markFileAsViewed: { clientMutationId: null } };
            default:
                return undefined;
        }
    }

    writesOf(name: string): Record<string, unknown>[] {
        return this.writes.filter((write) => write.name === name).map((write) => write.variables);
    }
}

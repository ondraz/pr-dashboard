import { validate } from "@octokit/graphql-schema";
import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGitHubClient } from "./client.ts";
import { batchQuery, fetchOutstandingWork } from "./outstanding.ts";
import { outstanding, thread } from "./testFixtures.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const github = mockGraphql.link("https://api.github.com/graphql");

describe("batchQuery", () => {
    it("is valid against GitHub's schema", () => {
        expect(validate(batchQuery(10)).map((error) => error.message)).toEqual([]);
    });
});

describe("fetchOutstandingWork", () => {
    it("reads PRs ten to a query and pages long thread lists on their own", async () => {
        const prs = Array.from({ length: 12 }, (_, i) => ({ repoFullName: "acme/widgets", number: i + 1 }));
        const batchSizes: number[] = [];
        const pagedAfter: unknown[] = [];
        const number3Error = [{ message: "Could not resolve to a Repository" }];
        server.use(
            github.query("OutstandingWorkBatch", ({ variables }) => {
                const count = Object.keys(variables).length / 3;
                batchSizes.push(count);
                const data: Record<string, unknown> = {};
                for (let n = 0; n < count; n++) {
                    const number = variables[`number${n}`];
                    if (number === 3) {
                        data[`pr${n}`] = null;
                    } else if (number === 1) {
                        data[`pr${n}`] = {
                            pullRequest: outstanding([thread(false, "bob", "bob", "PRR_b", 2)], {
                                nextCursor: "c1",
                                mergeQueueEntry: { position: 2, state: "QUEUED" },
                            }),
                        };
                    } else {
                        data[`pr${n}`] = { pullRequest: outstanding([]) };
                    }
                }
                return HttpResponse.json({ data, errors: number3Error });
            }),
            github.query("ReviewThreadsPage", ({ variables }) => {
                pagedAfter.push(variables.after);
                const next = variables.after === "c1" ? "c2" : null;
                return HttpResponse.json({
                    data: {
                        repository: {
                            pullRequest: {
                                reviewThreads: {
                                    pageInfo: { hasNextPage: next !== null, endCursor: next },
                                    nodes: [thread(false, "carol", "carol"), thread(true, "carol", "carol")],
                                },
                            },
                        },
                    },
                });
            }),
        );
        const progress: number[] = [];

        const work = await fetchOutstandingWork(createGitHubClient({ token: "t" }), prs, {
            onProgress: (done) => progress.push(done),
        });

        expect(batchSizes.sort()).toEqual([10, 2]);
        expect(pagedAfter).toEqual(["c1", "c2"]);
        expect(work.get("acme/widgets#1")).toMatchObject({
            threads: 3,
            comments: 4,
            mergeQueue: { position: 2, state: "QUEUED" },
        });
        expect(work.get("acme/widgets#2")).toMatchObject({ threads: 0, copilot: null });
        expect(work.has("acme/widgets#3")).toBe(false);
        expect(progress).toHaveLength(2);
        expect(progress.at(-1)).toBe(12);
    });

    it("stops paging after 500 threads", async () => {
        let pages = 0;
        server.use(
            github.query("OutstandingWorkBatch", () =>
                HttpResponse.json({ data: { pr0: { pullRequest: outstanding([], { nextCursor: "c0" }) } } }),
            ),
            github.query("ReviewThreadsPage", ({ variables }) => {
                pages++;
                const cursor = `${variables.after}+`;
                return HttpResponse.json({
                    data: {
                        repository: {
                            pullRequest: {
                                reviewThreads: { pageInfo: { hasNextPage: true, endCursor: cursor }, nodes: [] },
                            },
                        },
                    },
                });
            }),
        );
        await fetchOutstandingWork(createGitHubClient({ token: "t" }), [{ repoFullName: "acme/widgets", number: 1 }]);
        expect(pages).toBe(4);
    });

    it("reads Copilot's latest verdict and the viewer's own threads", async () => {
        server.use(
            github.query("OutstandingWorkBatch", () =>
                HttpResponse.json({
                    data: {
                        pr0: {
                            pullRequest: outstanding(
                                [thread(false, "alice", "bob", "PRR_a"), thread(false, "alice", "alice", "PRR_a")],
                                {
                                    reviews: [
                                        {
                                            id: "PRR_old",
                                            databaseId: 1,
                                            state: "COMMENTED",
                                            body: "## Approval recommended",
                                            author: { login: "copilot-pull-request-reviewer" },
                                        },
                                        {
                                            id: "PRR_new",
                                            databaseId: 2,
                                            state: "COMMENTED",
                                            body: "## Changes recommended",
                                            author: { login: "copilot-pull-request-reviewer" },
                                        },
                                        {
                                            id: "PRR_a",
                                            databaseId: 3,
                                            state: "COMMENTED",
                                            body: "",
                                            author: { login: "alice" },
                                        },
                                    ],
                                },
                            ),
                        },
                    },
                }),
            ),
        );
        const work = await fetchOutstandingWork(
            createGitHubClient({ token: "t" }),
            [{ repoFullName: "acme/widgets", number: 1 }],
            { login: "alice" },
        );
        expect(work.get("acme/widgets#1")).toMatchObject({
            mine: 2,
            replies: 1,
            copilot: { id: "PRR_new", databaseId: 2, label: "Changes recommended", owing: true },
        });
    });

    it("asks nothing for no PRs", async () => {
        expect((await fetchOutstandingWork(createGitHubClient({ token: "t" }), [])).size).toBe(0);
    });
});

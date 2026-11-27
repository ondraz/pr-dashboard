import { graphql as mockGraphql } from "msw/graphql";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGitHubClient, GraphqlError, graphql, mutate, WriteRefused, writeError } from "./client.ts";
import { RateLimitError, RateLimits } from "./rateLimits.ts";
import { addCommentMutation } from "./review.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const github = mockGraphql.link("https://api.github.com/graphql");

function limitHeaders(remaining: number, resource = "core"): Record<string, string> {
    return {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": String(remaining),
        "x-ratelimit-used": String(5000 - remaining),
        "x-ratelimit-reset": "1795770000",
        "x-ratelimit-resource": resource,
    };
}

describe("createGitHubClient", () => {
    it("sends the token and asks again with the ETag, serving the kept response on a 304", async () => {
        const seen: (string | null)[] = [];
        server.use(
            http.get("https://api.github.com/user", ({ request }) => {
                expect(request.headers.get("authorization")).toBe("token test-token");
                const etag = request.headers.get("if-none-match");
                seen.push(etag);
                if (etag === '"v1"') return new HttpResponse(null, { status: 304, headers: limitHeaders(4998) });
                return HttpResponse.json({ login: "alice" }, { headers: { etag: '"v1"', ...limitHeaders(4999) } });
            }),
        );
        const rateLimits = new RateLimits();
        const client = createGitHubClient({ token: "test-token", rateLimits });

        const first = await client.request("GET /user");
        const second = await client.request("GET /user");

        expect(seen).toEqual([null, '"v1"']);
        expect(first.data.login).toBe("alice");
        expect(second.status).toBe(200);
        expect(second.data.login).toBe("alice");
        expect(second.headers["x-ratelimit-remaining"]).toBe("4998");
        expect(rateLimits.snapshot().get("core")).toMatchObject({ remaining: 4998, used: 2, limit: 5000 });
    });

    it("keeps responses per URL", async () => {
        let notModified = 0;
        server.use(
            http.get("https://api.github.com/repos/acme/widgets/pulls/:number", ({ params, request }) => {
                if (request.headers.get("if-none-match") === `"pr${params.number}"`) {
                    notModified++;
                    return new HttpResponse(null, { status: 304 });
                }
                return HttpResponse.json(
                    { number: Number(params.number) },
                    { headers: { etag: `"pr${params.number}"` } },
                );
            }),
        );
        const client = createGitHubClient({ token: "t" });
        const get = (pull_number: number) =>
            client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
                owner: "acme",
                repo: "widgets",
                pull_number,
            });
        await get(1);
        await get(2);
        expect((await get(1)).data.number).toBe(1);
        expect((await get(2)).data.number).toBe(2);
        expect(notModified).toBe(2);
    });

    it("serves an unchanged search page from the kept response as it first came", async () => {
        server.use(
            http.get("https://api.github.com/search/issues", ({ request }) => {
                if (request.headers.get("if-none-match") === '"s1"') return new HttpResponse(null, { status: 304 });
                return HttpResponse.json(
                    { total_count: 2, incomplete_results: false, items: [{ number: 1 }, { number: 2 }] },
                    { headers: { etag: '"s1"' } },
                );
            }),
        );
        const client = createGitHubClient({ token: "t" });
        const search = () => client.paginate("GET /search/issues", { q: "is:pr", per_page: 100 });

        const first = await search();
        const second = await search();

        expect(first.map((hit) => hit.number)).toEqual([1, 2]);
        expect(second.map((hit) => hit.number)).toEqual([1, 2]);
    });

    it("bypasses the browser's HTTP cache", async () => {
        const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({ login: "alice" }));
        await createGitHubClient({ token: "t", fetch: fetchSpy }).request("GET /user");
        expect(fetchSpy.mock.calls[0]?.[1]?.cache).toBe("no-store");
    });

    it("turns an exhausted rate limit into a RateLimitError", async () => {
        server.use(
            http.get("https://api.github.com/user", () =>
                HttpResponse.json({ message: "API rate limit exceeded" }, { status: 403, headers: limitHeaders(0) }),
            ),
        );
        const rateLimits = new RateLimits();
        const error = await createGitHubClient({ token: "t", rateLimits })
            .request("GET /user")
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RateLimitError);
        expect(error).toMatchObject({ resource: "core", resetAt: 1795770000000 });
        expect(rateLimits.snapshot().get("core")?.remaining).toBe(0);
    });

    it("turns a secondary limit into a RateLimitError with its retry time", async () => {
        server.use(
            http.get("https://api.github.com/user", () =>
                HttpResponse.json(
                    { message: "secondary rate limit" },
                    { status: 429, headers: { "retry-after": "60" } },
                ),
            ),
        );
        const before = Date.now();
        const error = await createGitHubClient({ token: "t" })
            .request("GET /user")
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).resetAt).toBeGreaterThanOrEqual(before + 60_000);
    });

    it("holds every request back after a secondary limit, until it resets", async () => {
        let sent = 0;
        server.use(
            http.get("https://api.github.com/user", () => {
                sent++;
                return HttpResponse.json(
                    { message: "You have exceeded a secondary rate limit" },
                    { status: 403, headers: { "retry-after": "60" } },
                );
            }),
            http.post("https://api.github.com/graphql", () => {
                sent++;
                return HttpResponse.json({ data: {} });
            }),
        );
        const client = createGitHubClient({ token: "t" });
        await client.request("GET /user").catch(() => {});
        const again = await client.request("GET /user").catch((e: unknown) => e);
        const other = await graphql(client, "query { viewer { login } }", {}).catch((e: unknown) => e);
        expect(again).toBeInstanceOf(RateLimitError);
        expect(other).toBeInstanceOf(RateLimitError);
        expect(sent).toBe(1);

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 61_000);
        try {
            await graphql(client, "query { viewer { login } }", {});
            expect(sent).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("holds only the exhausted bucket after a primary limit", async () => {
        const reset = Math.floor(Date.now() / 1000) + 600;
        server.use(
            http.get("https://api.github.com/user", () =>
                HttpResponse.json(
                    { message: "API rate limit exceeded" },
                    { status: 403, headers: { ...limitHeaders(0), "x-ratelimit-reset": String(reset) } },
                ),
            ),
            http.get("https://api.github.com/search/issues", () =>
                HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] }),
            ),
        );
        const client = createGitHubClient({ token: "t" });
        await client.request("GET /user").catch(() => {});
        expect(await client.request("GET /user").catch((e: unknown) => e)).toBeInstanceOf(RateLimitError);
        const search = await client.request("GET /search/issues", { q: "is:pr" });
        expect(search.status).toBe(200);
    });

    it("waits a little after GitHub left a request unanswered, which its secondary limit can do", async () => {
        let sent = 0;
        server.use(
            http.get("https://api.github.com/user", () => {
                sent++;
                return HttpResponse.error();
            }),
        );
        const client = createGitHubClient({ token: "t" });
        const first = await client.request("GET /user").catch((e: unknown) => e);
        expect(first).toBeInstanceOf(RateLimitError);
        expect((first as Error).message).toMatch(/did not answer/);
        expect(await client.request("GET /user").catch((e: unknown) => e)).toBeInstanceOf(RateLimitError);
        expect(sent).toBe(1);
    });

    it("leaves other errors alone", async () => {
        server.use(
            http.get("https://api.github.com/user", () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
        );
        const error = await createGitHubClient({ token: "t" })
            .request("GET /user")
            .catch((e: unknown) => e);
        expect(error).not.toBeInstanceOf(RateLimitError);
        expect(error).toMatchObject({ status: 404 });
    });
});

describe("graphql", () => {
    it("returns data with the errors that came along, and records the GraphQL bucket", async () => {
        server.use(
            github.query("Viewer", ({ variables }) =>
                HttpResponse.json(
                    { data: { viewer: { login: variables.who } }, errors: [{ message: "one alias failed" }] },
                    { headers: limitHeaders(4990, "graphql") },
                ),
            ),
        );
        const rateLimits = new RateLimits();
        const client = createGitHubClient({ token: "t", rateLimits });
        const result = await graphql<{ viewer: { login: string } }, { who: string }>(
            client,
            "query Viewer($who: String!) { viewer { login } }",
            { who: "alice" },
        );
        expect(result).toEqual({ data: { viewer: { login: "alice" } }, errors: [{ message: "one alias failed" }] });
        expect(rateLimits.snapshot().get("graphql")?.remaining).toBe(4990);
    });

    it("throws when there is no data at all", async () => {
        server.use(github.query("Viewer", () => HttpResponse.json({ data: null, errors: [{ message: "bad query" }] })));
        const promise = graphql(createGitHubClient({ token: "t" }), "query Viewer { viewer { login } }", {});
        await expect(promise).rejects.toBeInstanceOf(GraphqlError);
        await expect(promise).rejects.toThrow("bad query");
    });

    it("turns an exhausted GraphQL limit, reported with a 200, into a RateLimitError", async () => {
        server.use(
            http.post("https://api.github.com/graphql", () =>
                HttpResponse.json(
                    { data: null, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] },
                    { headers: limitHeaders(0, "graphql") },
                ),
            ),
        );
        const promise = graphql(createGitHubClient({ token: "t" }), "query Viewer { viewer { login } }", {});
        await expect(promise).rejects.toBeInstanceOf(RateLimitError);
        await expect(promise).rejects.toMatchObject({ resource: "graphql", resetAt: 1795770000000 });
    });

    it("never sends a conditional request", async () => {
        const conditional: (string | null)[] = [];
        server.use(
            github.query("Viewer", ({ request }) => {
                conditional.push(request.headers.get("if-none-match"));
                return HttpResponse.json({ data: { viewer: { login: "alice" } } }, { headers: { etag: '"g"' } });
            }),
        );
        const client = createGitHubClient({ token: "t" });
        await graphql(client, "query Viewer { viewer { login } }", {});
        await graphql(client, "query Viewer { viewer { login } }", {});
        expect(conditional).toEqual([null, null]);
    });
});

describe("createGitHubClient with a token source", () => {
    it("asks the source before every request and retries once with a fresh token after a 401", async () => {
        const seen: (string | null)[] = [];
        server.use(
            http.get("https://api.github.com/user", ({ request }) => {
                const auth = request.headers.get("authorization");
                seen.push(auth);
                return auth === "token ghu_fresh"
                    ? HttpResponse.json({ login: "alice" })
                    : HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
            }),
        );
        let held = "ghu_stale";
        const refused: string[] = [];
        const client = createGitHubClient({
            token: {
                current: async () => held,
                refused: async (token) => {
                    refused.push(token);
                    held = "ghu_fresh";
                    return held;
                },
            },
        });

        expect((await client.request("GET /user")).data.login).toBe("alice");
        expect((await client.request("GET /user")).data.login).toBe("alice");
        expect(seen).toEqual(["token ghu_stale", "token ghu_fresh", "token ghu_fresh"]);
        expect(refused).toEqual(["ghu_stale"]);
    });

    it("gives up with GitHub's error once the source is signed out", async () => {
        server.use(
            http.get("https://api.github.com/user", () =>
                HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
            ),
        );
        const client = createGitHubClient({
            token: { current: async () => "ghu_revoked", refused: async () => null },
        });
        await expect(client.request("GET /user")).rejects.toMatchObject({ status: 401 });
    });
});

describe("writes", () => {
    it("takes any error from a mutation as a failure, and a FORBIDDEN one as a refusal", async () => {
        let answer: Record<string, unknown> = {};
        server.use(http.post("https://api.github.com/graphql", () => HttpResponse.json(answer)));
        const client = createGitHubClient({ token: "ghu_test" });
        const variables = { subjectId: "PR_1", body: "Hi" };

        answer = { data: { addComment: { commentEdge: { node: { id: "IC_1" } } } } };
        await expect(mutate(client, addCommentMutation, variables)).resolves.toEqual(answer.data);

        answer = {
            data: { addComment: null },
            errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
        };
        const refused = await mutate(client, addCommentMutation, variables).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(WriteRefused);
        expect((refused as Error).message).toBe("Resource not accessible by integration");

        answer = { data: { addComment: null }, errors: [{ type: "UNPROCESSABLE", message: "Body is too long" }] };
        const failed = await mutate(client, addCommentMutation, variables).catch((error: unknown) => error);
        expect(failed).toBeInstanceOf(GraphqlError);
        expect((failed as Error).message).toBe("Body is too long");
    });

    it("tells a REST 403 refusal apart from a rate limit", async () => {
        server.use(
            http.post("https://api.github.com/repos/acme/widgets/issues/1/comments", ({ request }) =>
                request.headers.get("x-limit") === "yes"
                    ? HttpResponse.json(
                          { message: "API rate limit exceeded" },
                          { status: 403, headers: limitHeaders(0) },
                      )
                    : HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
            ),
        );
        const client = createGitHubClient({ token: "ghu_test" });
        const post = (limited: boolean) =>
            client
                .request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
                    owner: "acme",
                    repo: "widgets",
                    issue_number: 1,
                    body: "Hi",
                    headers: limited ? { "x-limit": "yes" } : {},
                })
                .catch((error: unknown) => writeError(error));

        const refused = await post(false);
        expect(refused).toBeInstanceOf(WriteRefused);
        expect((refused as Error).message).toBe("Resource not accessible by integration");
        expect(await post(true)).toBeInstanceOf(RateLimitError);
    });
});

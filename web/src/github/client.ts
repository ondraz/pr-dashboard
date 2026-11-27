import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import type { OctokitResponse } from "@octokit/types";
import { EtagCache } from "./etagCache.ts";
import { RateLimitError, RateLimits, rateLimitError, readRateLimit } from "./rateLimits.ts";

const GitHubOctokit = Octokit.plugin(paginateRest);

export type GitHubClient = InstanceType<typeof GitHubOctokit>;

/** Access tokens that expire and are renewed, as the GitHub App issues them. */
export interface AccessTokenSource {
    /** A token that should still be good. Rejects once the user is signed out. */
    current(): Promise<string>;
    /** GitHub answered `token` with a 401: a fresh token to retry with, or null when signed out. */
    refused(token: string): Promise<string | null>;
}

export interface GitHubClientOptions {
    /** A pasted token, or the GitHub App's tokens, asked for before every request. */
    token: string | AccessTokenSource;
    /** Collects the rate-limit state every response reports. */
    rateLimits?: RateLimits;
    /** Defaults to the global `fetch`; tests pass their own. */
    fetch?: typeof fetch;
    etagCapacity?: number;
}

interface ErrorWithResponse {
    status: number;
    response?: { headers: Record<string, string | number | undefined>; data?: unknown };
}

function errorMessage(response: { data?: unknown }): string {
    const { data } = response;
    return typeof data === "object" && data !== null && typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : "";
}

function isErrorWithResponse(error: unknown): error is ErrorWithResponse {
    return typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number";
}

/**
 * An Octokit for one token. GET responses carrying an ETag are kept, and asked for again with
 * `If-None-Match`: GitHub answers an unchanged resource with a 304, which does not count against
 * the rate limit, and the kept response stands in for it. The browser's own HTTP cache is bypassed,
 * since it would answer from a copy up to a minute old without asking.
 */
export function createGitHubClient({
    token,
    rateLimits = new RateLimits(),
    fetch: fetchImpl,
    etagCapacity,
}: GitHubClientOptions): GitHubClient {
    const source = typeof token === "string" ? null : token;
    const octokit = new GitHubOctokit({
        ...(source ? {} : { auth: token }),
        request: {
            fetch: (url: string | URL, init?: RequestInit) =>
                (fetchImpl ?? globalThis.fetch)(url, { ...init, cache: "no-store" }),
        },
    });
    const cache = new EtagCache<OctokitResponse<unknown>>(etagCapacity);

    octokit.hook.wrap("request", async (request, options) => {
        const conditional = options.method === "GET";
        const { url, headers } = octokit.request.endpoint.parse(options);
        const key = `${url} ${headers.accept ?? ""}`;
        const cached = conditional ? cache.get(key) : undefined;
        // Inner hooks (token auth) are bound to this same options object, so the header has to go on it.
        if (cached) options.headers["if-none-match"] = cached.etag;
        try {
            const response = source
                ? await withSource(source, () => request(options), options.headers)
                : await request(options);
            rateLimits.record(response.headers);
            const etag = response.headers.etag;
            // Pagination rewrites a search response in place, so the cache keeps its own copy.
            if (conditional && typeof etag === "string") cache.set(key, etag, structuredClone(response));
            return response;
        } catch (error) {
            if (!isErrorWithResponse(error) || !error.response) throw error;
            rateLimits.record(error.response.headers);
            if (error.status === 304 && cached) {
                const kept = structuredClone(cached.value);
                return { ...kept, headers: { ...kept.headers, ...error.response.headers } };
            }
            throw rateLimitError(error.status, error.response.headers, errorMessage(error.response)) ?? error;
        }
    });

    return octokit;
}

/** Sends with the source's current token, and once more with a fresh one if GitHub refuses it. */
async function withSource<T>(
    source: AccessTokenSource,
    send: () => T | Promise<T>,
    headers: Record<string, unknown>,
): Promise<T> {
    const token = await source.current();
    headers.authorization = `token ${token}`;
    try {
        return await send();
    } catch (error) {
        if (!isErrorWithResponse(error) || error.status !== 401) throw error;
        const fresh = await source.refused(token);
        if (!fresh) throw error;
        headers.authorization = `token ${fresh}`;
        return send();
    }
}

/** GraphQL answered with no data at all. */
export class GraphqlError extends Error {
    override name = "GraphqlError";
    readonly errors: readonly { message: string }[];

    constructor(errors: readonly { message: string }[]) {
        super(errors.map((error) => error.message).join("; ") || "GraphQL request failed");
        this.errors = errors;
    }
}

export interface GraphqlResult<T> {
    data: T;
    /** Errors that came with data, e.g. one alias naming a repository the token cannot see. */
    errors: readonly { message: string }[];
}

/** Runs a typed GraphQL document, keeping the data of a response that is only partly in error. */
export async function graphql<TResult, TVariables>(
    client: GitHubClient,
    document: DocumentTypeDecoration<TResult, TVariables> | string,
    variables: TVariables,
): Promise<GraphqlResult<TResult>> {
    const response = await client.request("POST /graphql", { query: String(document), variables });
    const body = response.data as { data?: TResult | null; errors?: { type?: string; message: string }[] };
    // GraphQL reports an exhausted limit with a 200 and an error of this type.
    if (body.errors?.some((error) => error.type === "RATE_LIMITED")) {
        const limit = readRateLimit(response.headers);
        throw new RateLimitError(limit?.resource ?? "graphql", limit?.resetAt ?? Date.now() + 60_000);
    }
    if (!body.data) throw new GraphqlError(body.errors ?? []);
    return { data: body.data, errors: body.errors ?? [] };
}

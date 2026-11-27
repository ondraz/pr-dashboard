import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import type { OctokitResponse } from "@octokit/types";
import { EtagCache } from "./etagCache.ts";
import {
    graphqlRateLimitError,
    type RateLimitError,
    RateLimits,
    RequestPause,
    rateLimitError,
    readRateLimit,
    unansweredError,
} from "./rateLimits.ts";

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
    const pause = new RequestPause();

    octokit.hook.wrap("request", async (request, options) => {
        const conditional = options.method === "GET";
        const { url, headers } = octokit.request.endpoint.parse(options);
        const held = pause.check(url);
        if (held) throw held;
        const key = `${url} ${headers.accept ?? ""}`;
        const cached = conditional ? cache.get(key) : undefined;
        // Inner hooks (token auth) are bound to this same options object, so the header has to go on it.
        if (cached) options.headers["if-none-match"] = cached.etag;
        try {
            const response = source
                ? await withSource(source, () => request(options), options.headers)
                : await request(options);
            rateLimits.record(response.headers);
            const exhausted = graphqlLimitError(url, response);
            if (exhausted) pause.hold(exhausted);
            const etag = response.headers.etag;
            // Pagination rewrites a search response in place, so the cache keeps its own copy.
            if (conditional && typeof etag === "string") cache.set(key, etag, structuredClone(response));
            return response;
        } catch (error) {
            if (isUnanswered(error)) {
                const unanswered = unansweredError();
                pause.hold(unanswered);
                throw unanswered;
            }
            if (!isErrorWithResponse(error) || !error.response) throw error;
            rateLimits.record(error.response.headers);
            if (error.status === 304 && cached) {
                const kept = structuredClone(cached.value);
                return { ...kept, headers: { ...kept.headers, ...error.response.headers } };
            }
            const limited =
                graphqlLimitError(url, error.response) ??
                rateLimitError(error.status, error.response.headers, errorMessage(error.response));
            if (limited) pause.hold(limited);
            throw limited ?? error;
        }
    });

    return octokit;
}

/** Octokit's error for a fetch the browser failed before any response came back. */
function isUnanswered(error: unknown): boolean {
    return (
        isErrorWithResponse(error) &&
        !error.response &&
        error.status === 500 &&
        (error as { cause?: unknown }).cause instanceof TypeError
    );
}

/** GraphQL can report a limit in the body of any answer, a 200 included; the pause holds it like a refusal. */
function graphqlLimitError(
    url: string,
    response: { data?: unknown; headers: OctokitResponse<unknown>["headers"] },
): RateLimitError | null {
    if (new URL(url).pathname !== "/graphql") return null;
    const errors = (response.data as { errors?: { type?: string; code?: string }[] } | null)?.errors;
    return graphqlRateLimitError(errors, response.headers);
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

interface GraphqlErrorEntry {
    message: string;
    type?: string;
    code?: string;
}

/** GraphQL answered with no data at all, or a mutation answered with errors. */
export class GraphqlError extends Error {
    override name = "GraphqlError";
    readonly errors: readonly GraphqlErrorEntry[];

    constructor(errors: readonly GraphqlErrorEntry[]) {
        super(errors.map((error) => error.message).join("; ") || "GraphQL request failed");
        this.errors = errors;
    }
}

export interface GraphqlResult<T> {
    data: T;
    /** Errors that came with data, e.g. one alias naming a repository the token cannot see. */
    errors: readonly GraphqlErrorEntry[];
}

/** Runs a typed GraphQL document, keeping the data of a response that is only partly in error. */
export async function graphql<TResult, TVariables>(
    client: GitHubClient,
    document: DocumentTypeDecoration<TResult, TVariables> | string,
    variables: TVariables,
): Promise<GraphqlResult<TResult>> {
    const response = await client.request("POST /graphql", { query: String(document), variables });
    const body = response.data as { data?: TResult | null; errors?: GraphqlErrorEntry[] };
    // GraphQL can report a limit with a 200.
    const limited = graphqlRateLimitError(body.errors, response.headers);
    if (limited) throw limited;
    if (!body.data) throw new GraphqlError(body.errors ?? []);
    return { data: body.data, errors: body.errors ?? [] };
}

/** GitHub refused a change: the sign-in may read the repository but not write to it. */
export class WriteRefused extends Error {
    override name = "WriteRefused";
}

/** A write's failure, with a refusal of the permission it needs told apart from everything else. */
export function writeError(error: unknown): unknown {
    if (error instanceof GraphqlError && error.errors.some((entry) => entry.type === "FORBIDDEN")) {
        return new WriteRefused(error.message);
    }
    if (isErrorWithResponse(error) && error.status === 403) {
        return new WriteRefused((error.response && errorMessage(error.response)) || "GitHub refused this change (403)");
    }
    return error;
}

/** Runs a GraphQL mutation; unlike a read, any error at all means it did not go through. */
export async function mutate<TResult, TVariables>(
    client: GitHubClient,
    document: DocumentTypeDecoration<TResult, TVariables>,
    variables: TVariables,
): Promise<TResult> {
    try {
        const { data, errors } = await graphql(client, document, variables);
        if (errors.length) throw new GraphqlError(errors);
        return data;
    } catch (error) {
        throw writeError(error);
    }
}

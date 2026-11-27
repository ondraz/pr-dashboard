type Headers = Readonly<Record<string, string | number | undefined>>;

/** One rate-limit bucket (`core`, `search`, `graphql`, ...) as of its latest response. */
export interface RateLimit {
    resource: string;
    limit: number;
    remaining: number;
    used: number;
    /** Milliseconds since the epoch. */
    resetAt: number;
}

/** A request GitHub refused for its primary or secondary rate limit. */
export class RateLimitError extends Error {
    override name = "RateLimitError";
    readonly resource: string;
    /** Milliseconds since the epoch at which a retry can succeed. */
    readonly resetAt: number;

    constructor(resource: string, resetAt: number, message?: string) {
        super(
            message ??
                `GitHub rate limit reached for ${resource}; it resets at ${new Date(resetAt).toLocaleTimeString()}`,
        );
        this.resource = resource;
        this.resetAt = resetAt;
    }
}

function header(headers: Headers, name: string): number | null {
    const value = headers[name];
    if (value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function readRateLimit(headers: Headers): RateLimit | null {
    const limit = header(headers, "x-ratelimit-limit");
    const remaining = header(headers, "x-ratelimit-remaining");
    const reset = header(headers, "x-ratelimit-reset");
    if (limit === null || remaining === null || reset === null) return null;
    return {
        resource: String(headers["x-ratelimit-resource"] ?? "core"),
        limit,
        remaining,
        used: header(headers, "x-ratelimit-used") ?? limit - remaining,
        resetAt: reset * 1000,
    };
}

/**
 * The rate-limit error a refused response stands for, if it is one: a 403 or 429 with no requests
 * left, or one carrying `retry-after` or naming the secondary limit in its message. GitHub asks for
 * at least a minute's wait on a secondary limit that gives no time.
 */
export function rateLimitError(
    status: number,
    headers: Headers,
    message = "",
    now: number = Date.now(),
): RateLimitError | null {
    if (status !== 403 && status !== 429) return null;
    const retryAfter = header(headers, "retry-after");
    const limit = readRateLimit(headers);
    if (retryAfter !== null) return new RateLimitError(limit?.resource ?? "secondary", now + retryAfter * 1000);
    if (limit && limit.remaining === 0) return new RateLimitError(limit.resource, limit.resetAt);
    if (/secondary rate limit|rate limit (already )?exceeded/i.test(message)) {
        return new RateLimitError("secondary", now + 60_000);
    }
    return null;
}

/**
 * GraphQL's errors for a request over a limit, which it may send with a 200: typed `RATE_LIMITED`, or
 * `RATE_LIMIT` with the code `graphql_rate_limit`. With points left in the hour it is the per-minute
 * secondary limit, which clears in about a minute; without, the hour's budget, until it resets.
 */
export function graphqlRateLimitError(
    errors: readonly { type?: string; code?: string }[] | undefined,
    headers: Headers,
    now: number = Date.now(),
): RateLimitError | null {
    const limited = errors?.some(
        (error) => error.type === "RATE_LIMITED" || error.type === "RATE_LIMIT" || error.code === "graphql_rate_limit",
    );
    if (!limited) return null;
    const retryAfter = header(headers, "retry-after");
    if (retryAfter !== null) return new RateLimitError("secondary", now + retryAfter * 1000);
    const limit = readRateLimit(headers);
    if (limit && limit.remaining === 0) return new RateLimitError(limit.resource, limit.resetAt);
    return new RateLimitError("secondary", now + 60_000);
}

/** The latest rate-limit state per bucket, for a status line to subscribe to. */
export class RateLimits {
    #snapshot: ReadonlyMap<string, RateLimit> = new Map();
    readonly #listeners = new Set<() => void>();

    record(headers: Headers): void {
        const limit = readRateLimit(headers);
        if (!limit) return;
        const previous = this.#snapshot.get(limit.resource);
        // Responses can land out of order: an earlier window, or a higher count within one, is older.
        if (
            previous &&
            (limit.resetAt < previous.resetAt ||
                (limit.resetAt === previous.resetAt && previous.remaining <= limit.remaining))
        ) {
            return;
        }
        const next = new Map(this.#snapshot);
        next.set(limit.resource, limit);
        this.#snapshot = next;
        for (const listener of this.#listeners) listener();
    }

    /** A new map after every change, so it can serve as a `useSyncExternalStore` snapshot. */
    snapshot = (): ReadonlyMap<string, RateLimit> => this.#snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };
}

/** The bucket a request to `url` counts against. */
export function bucketOf(url: string): string {
    const path = new URL(url, "https://api.github.com").pathname;
    if (path === "/graphql") return "graphql";
    if (path.startsWith("/search/")) return "search";
    return "core";
}

/**
 * Requests held back after GitHub refused one for a limit, until the limit resets. A refresh reads a
 * hundred things at once; without this, the requests still queued would keep going out after the
 * first refusal, and GitHub lengthens a secondary limit for every request it has to turn away. An
 * exhausted primary limit holds its own bucket; a secondary limit, or one of unknown kind, holds all.
 */
export class RequestPause {
    readonly #until = new Map<string, RateLimitError>();

    hold(error: RateLimitError): void {
        const key = ["core", "search", "graphql"].includes(error.resource) ? error.resource : "all";
        const held = this.#until.get(key);
        if (!held || held.resetAt < error.resetAt) this.#until.set(key, error);
    }

    /** The refusal still standing for a request to `url`, if any. */
    check(url: string, now: number = Date.now()): RateLimitError | null {
        for (const key of [bucketOf(url), "all"]) {
            const held = this.#until.get(key);
            if (!held) continue;
            if (held.resetAt > now) return held;
            this.#until.delete(key);
        }
        return null;
    }
}

// GitHub's answer to a request over its secondary limit sometimes lacks CORS headers, and the
// browser then reports only that the request failed. The same failure means the network is down;
// either way, waiting a little before the next request is right.
const UNANSWERED_PAUSE_MS = 30_000;

/** The pause for a request the browser saw fail without any response from GitHub. */
export function unansweredError(now: number = Date.now()): RateLimitError {
    const resetAt = now + UNANSWERED_PAUSE_MS;
    return new RateLimitError(
        "secondary",
        resetAt,
        `GitHub did not answer (the network is down, or GitHub's secondary rate limit refused the request); trying again after ${new Date(resetAt).toLocaleTimeString()}`,
    );
}

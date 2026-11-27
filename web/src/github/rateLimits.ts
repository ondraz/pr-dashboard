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

    constructor(resource: string, resetAt: number) {
        super(`GitHub rate limit reached for ${resource}; it resets at ${new Date(resetAt).toLocaleTimeString()}`);
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
 * left, or one carrying `retry-after` (the secondary limit).
 */
export function rateLimitError(status: number, headers: Headers, now: number = Date.now()): RateLimitError | null {
    if (status !== 403 && status !== 429) return null;
    const retryAfter = header(headers, "retry-after");
    const limit = readRateLimit(headers);
    if (retryAfter !== null) return new RateLimitError(limit?.resource ?? "secondary", now + retryAfter * 1000);
    if (limit && limit.remaining === 0) return new RateLimitError(limit.resource, limit.resetAt);
    return null;
}

/** The latest rate-limit state per bucket, for a status line to subscribe to. */
export class RateLimits {
    #snapshot: ReadonlyMap<string, RateLimit> = new Map();
    readonly #listeners = new Set<() => void>();

    record(headers: Headers): void {
        const limit = readRateLimit(headers);
        if (!limit) return;
        const previous = this.#snapshot.get(limit.resource);
        // Responses can land out of order; within one window the lower count is the newer one.
        if (previous && previous.resetAt === limit.resetAt && previous.remaining <= limit.remaining) return;
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

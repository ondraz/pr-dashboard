import { describe, expect, it } from "vitest";
import { EtagCache } from "./etagCache.ts";
import { RateLimits, rateLimitError, readRateLimit } from "./rateLimits.ts";

const headers = (remaining: number, reset = 1000, resource?: string) => ({
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(reset),
    ...(resource ? { "x-ratelimit-resource": resource } : {}),
});

describe("readRateLimit", () => {
    it("reads the bucket, defaulting to core and working out what was used", () => {
        expect(readRateLimit(headers(4000))).toEqual({
            resource: "core",
            limit: 5000,
            remaining: 4000,
            used: 1000,
            resetAt: 1_000_000,
        });
    });

    it("is null without the headers", () => {
        expect(readRateLimit({})).toBeNull();
        expect(readRateLimit({ "x-ratelimit-limit": "5000" })).toBeNull();
    });
});

describe("rateLimitError", () => {
    it("names the bucket and its reset when nothing is left", () => {
        expect(rateLimitError(403, headers(0, 2000, "search"))).toMatchObject({
            resource: "search",
            resetAt: 2_000_000,
        });
    });

    it("uses retry-after for the secondary limit", () => {
        expect(rateLimitError(403, { "retry-after": "30" }, "", 1_000)).toMatchObject({
            resource: "secondary",
            resetAt: 31_000,
        });
    });

    it("waits a minute on a secondary limit that gives no time", () => {
        const message = "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";
        expect(rateLimitError(403, headers(4000), message, 1_000)).toMatchObject({
            resource: "secondary",
            resetAt: 61_000,
        });
    });

    it("ignores a 403 that is a permission error", () => {
        expect(rateLimitError(403, headers(10))).toBeNull();
        expect(rateLimitError(500, headers(0))).toBeNull();
    });
});

describe("RateLimits", () => {
    it("keeps the latest state per bucket and tells subscribers", () => {
        const limits = new RateLimits();
        let calls = 0;
        const unsubscribe = limits.subscribe(() => calls++);
        limits.record(headers(4999));
        const first = limits.snapshot();
        limits.record(headers(100, 1000, "graphql"));
        expect(limits.snapshot()).not.toBe(first);
        expect(limits.snapshot().get("core")?.remaining).toBe(4999);
        expect(limits.snapshot().get("graphql")?.remaining).toBe(100);
        expect(calls).toBe(2);
        unsubscribe();
        limits.record(headers(4990));
        expect(calls).toBe(2);
    });

    it("ignores a response that lands after a newer one in the same window", () => {
        const limits = new RateLimits();
        limits.record(headers(4990));
        const snapshot = limits.snapshot();
        limits.record(headers(4995));
        expect(limits.snapshot()).toBe(snapshot);
        limits.record(headers(5000, 2000));
        expect(limits.snapshot().get("core")?.remaining).toBe(5000);
        limits.record(headers(4980, 1000));
        expect(limits.snapshot().get("core")).toMatchObject({ remaining: 5000, resetAt: 2_000_000 });
    });

    it("ignores responses without rate-limit headers", () => {
        const limits = new RateLimits();
        const snapshot = limits.snapshot();
        limits.record({});
        expect(limits.snapshot()).toBe(snapshot);
    });
});

describe("EtagCache", () => {
    it("drops the least recently used entry beyond its capacity", () => {
        const cache = new EtagCache<number>(2);
        cache.set("a", "ea", 1);
        cache.set("b", "eb", 2);
        cache.get("a");
        cache.set("c", "ec", 3);
        expect(cache.size).toBe(2);
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toEqual({ etag: "ea", value: 1 });
        expect(cache.get("c")).toEqual({ etag: "ec", value: 3 });
    });
});

import { describe, expect, it } from "vitest";
import {
    isNewSince,
    LAST_OPENED_LIMIT,
    type LastOpened,
    lastOpenedKey,
    parseLastOpened,
    recordOpened,
} from "./lastOpened.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const entry = (at: string, head = "c0ffee"): LastOpened => ({ at, head });

describe("lastOpenedKey", () => {
    it("names the PR whatever the case of its path", () => {
        expect(lastOpenedKey({ owner: "Acme", repo: "Widgets", number: 12 })).toBe("acme/widgets#12");
    });
});

describe("parseLastOpened", () => {
    it("reads the stored map and drops what it cannot read", () => {
        const text = JSON.stringify({
            "acme/widgets#12": entry("2026-11-26T09:00:00Z"),
            "acme/widgets#13": { at: "yesterday", head: "c0ffee" },
            "acme/widgets#14": "2026-11-26T09:00:00Z",
        });
        expect(parseLastOpened(text)).toEqual({ "acme/widgets#12": entry("2026-11-26T09:00:00Z") });
    });

    it.each([null, "", "not json", "[1]", "null"])("reads %j as nothing opened", (text) => {
        expect(parseLastOpened(text)).toEqual({});
    });
});

describe("recordOpened", () => {
    it("records the PR and forgets PRs not opened for 90 days", () => {
        const map = {
            "acme/widgets#1": entry("2026-08-01T00:00:00Z"),
            "acme/widgets#2": entry("2026-11-01T00:00:00Z"),
        };
        expect(recordOpened(map, "acme/widgets#12", entry("2026-11-27T12:00:00Z"), NOW)).toEqual({
            "acme/widgets#12": entry("2026-11-27T12:00:00Z"),
            "acme/widgets#2": entry("2026-11-01T00:00:00Z"),
        });
    });

    it("keeps the most recently opened PRs within the limit", () => {
        const map = Object.fromEntries(
            Array.from({ length: LAST_OPENED_LIMIT }, (_, n) => [
                `acme/widgets#${n}`,
                entry(new Date(NOW - (n + 1) * 60_000).toISOString()),
            ]),
        );
        const next = recordOpened(map, "acme/widgets#new", entry("2026-11-27T12:00:00Z"), NOW);
        expect(Object.keys(next)).toHaveLength(LAST_OPENED_LIMIT);
        expect(next["acme/widgets#new"]).toBeDefined();
        expect(next[`acme/widgets#${LAST_OPENED_LIMIT - 1}`]).toBeUndefined();
    });
});

describe("isNewSince", () => {
    const since = entry("2026-11-26T09:00:00Z");

    it("marks what others made after the last visit", () => {
        expect(isNewSince("2026-11-26T10:00:00Z", since, "bob", "alice")).toBe(true);
        expect(isNewSince("2026-11-26T08:00:00Z", since, "bob", "alice")).toBe(false);
    });

    it("never marks the reader's own, or anything on a first visit", () => {
        expect(isNewSince("2026-11-26T10:00:00Z", since, "alice", "alice")).toBe(false);
        expect(isNewSince("2026-11-26T10:00:00Z", null, "bob", "alice")).toBe(false);
        expect(isNewSince(null, since, "bob", "alice")).toBe(false);
    });
});

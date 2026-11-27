import type { PrRoute } from "./prRoute.ts";

/** When the reader last had a PR open, and the head commit it was at then. */
export interface LastOpened {
    at: string;
    head: string;
}

export type LastOpenedMap = Record<string, LastOpened>;

/** PRs opened longer ago than this are forgotten, and at most this many are kept. */
export const LAST_OPENED_DAYS = 90;
export const LAST_OPENED_LIMIT = 500;

export const lastOpenedKey = (route: PrRoute) => `${route.owner}/${route.repo}#${route.number}`.toLowerCase();

function isEntry(value: unknown): value is LastOpened {
    const entry = value as Partial<LastOpened> | null;
    return (
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.at === "string" &&
        !Number.isNaN(Date.parse(entry.at)) &&
        typeof entry.head === "string"
    );
}

/** The stored map; anything unreadable in it is dropped. */
export function parseLastOpened(text: string | null): LastOpenedMap {
    if (!text) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {};
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isEntry(value)));
}

/** `map` with `key` opened as `entry`, keeping the most recent PRs within the limits. */
export function recordOpened(map: LastOpenedMap, key: string, entry: LastOpened, now: number): LastOpenedMap {
    const oldest = now - LAST_OPENED_DAYS * 86_400_000;
    const kept = Object.entries({ ...map, [key]: entry })
        .filter(([, value]) => Date.parse(value.at) >= oldest)
        .sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, LAST_OPENED_LIMIT);
    return Object.fromEntries(kept);
}

/**
 * Whether something made at `at` by `author` is new to the reader: made after they last had the PR open,
 * and not by themselves. On a first visit nothing is.
 */
export function isNewSince(
    at: string | null | undefined,
    since: LastOpened | null,
    author: string | null | undefined,
    viewer: string | null | undefined,
): boolean {
    if (!since || !at) return false;
    if (viewer && author === viewer) return false;
    return Date.parse(at) > Date.parse(since.at);
}

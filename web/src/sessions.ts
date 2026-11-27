import type { PrSession, SessionsPayload } from "../../shared/sessions.ts";

/** PR URL to every session that made or reviewed it, the most recently active first. */
export interface PrSessions {
    made: Map<string, PrSession[]>;
    reviewed: Map<string, PrSession[]>;
}

const lists = (record: Record<string, unknown> | undefined) =>
    new Map(Object.entries(record ?? {}).filter((entry): entry is [string, PrSession[]] => Array.isArray(entry[1])));

/**
 * The Claude sessions behind each PR, from the local server. Empty when the server cannot answer,
 * which just leaves the session buttons out.
 */
export async function fetchSessions(fetchImpl: typeof fetch = fetch): Promise<PrSessions> {
    try {
        const res = await fetchImpl("/sessions.json", { cache: "no-store" });
        if (!res.ok) return { made: new Map(), reviewed: new Map() };
        const body = (await res.json()) as Partial<SessionsPayload>;
        return { made: lists(body.made), reviewed: lists(body.reviewed) };
    } catch {
        return { made: new Map(), reviewed: new Map() };
    }
}

/** The most recently active session that made, or reviewed, the PR at `url`. */
export function latestSession(sessions: PrSessions, role: keyof PrSessions, url: string): PrSession | undefined {
    return sessions[role].get(url)?.[0];
}

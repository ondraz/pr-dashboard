import type { PrSession, SessionsPayload } from "../../shared/sessions.ts";

export interface PrSessions {
    made: Map<string, PrSession>;
    reviewed: Map<string, PrSession>;
}

/**
 * The Claude sessions behind each PR, from the local server. Empty when the server cannot answer,
 * which just leaves the session buttons out.
 */
export async function fetchSessions(fetchImpl: typeof fetch = fetch): Promise<PrSessions> {
    try {
        const res = await fetchImpl("/sessions.json", { cache: "no-store" });
        if (!res.ok) return { made: new Map(), reviewed: new Map() };
        const body = (await res.json()) as Partial<SessionsPayload>;
        return {
            made: new Map(Object.entries(body.made ?? {})),
            reviewed: new Map(Object.entries(body.reviewed ?? {})),
        };
    } catch {
        return { made: new Map(), reviewed: new Map() };
    }
}

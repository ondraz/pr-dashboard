/** A Claude session that made or reviewed a PR. */
export interface PrSession {
    /** `local_<uuid>` for a desktop session, the transcript's UUID for a CLI or VS Code one. */
    id: string;
    /** Set only on a session known from a CLI or VS Code transcript alone. */
    kind?: "cli";
    title: string;
    archived: boolean;
    /** Milliseconds since the epoch. */
    lastActivityAt: number;
}

/** The `/sessions.json` payload: PR URL to the most recently active session per role. */
export interface SessionsPayload {
    made: Record<string, PrSession>;
    reviewed: Record<string, PrSession>;
}

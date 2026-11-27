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

/** The desktop sessions working in one GitHub repository, and where it is checked out. */
export interface RepoSessions {
    /** The main checkout's folder, which a new desktop session opens in; null when none is known. */
    folder: string | null;
    /** Its desktop sessions that are not archived, the most recently active first. */
    sessions: PrSession[];
}

/**
 * The `/sessions.json` payload: PR URL to every session per role, the most recently active first,
 * and per repository (`owner/name`, lower case) the desktop sessions in its checkouts.
 */
export interface SessionsPayload {
    made: Record<string, PrSession[]>;
    reviewed: Record<string, PrSession[]>;
    repos: Record<string, RepoSessions>;
}

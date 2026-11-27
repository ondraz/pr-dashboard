export type FeatureKind = "declared" | "ticket" | "branch";

/** What ties a PR to the same piece of work in another repository. */
export interface FeatureKey {
    key: string;
    label: string;
    kind: FeatureKind;
}

// A ticket id has to sit at the start of the title, or at the start of a branch segment
// ("l-686-thinking-in-ui", "ondra/ai-624-full-scale"). Anchoring it keeps version numbers
// and library names in the middle of a title from being read as ticket ids.
const FEATURE_TRAILER_RE = /^[ \t]*part-of:[ \t]*(\S.*?)[ \t]*$/im;
const STACK_TRAILER_RE = /^[ \t]*stack:[ \t]*(\S.*?)[ \t]*$/im;
export const TICKET_IN_TITLE_RE = /^([A-Za-z]{1,10}-\d{1,6})\b/;
export const TICKET_IN_BRANCH_RE = /(?:^|\/)([A-Za-z]{1,10}-\d{1,6})(?:[-_/.]|$)/;

// Anchored tokens that are never ticket ids.
const TICKET_PREFIX_BLOCKLIST = new Set(["UTF", "GPT", "SHA", "RFC", "ISO", "IPV", "ES", "PY", "NODE", "HTTP"]);

// Branch names shared by unrelated work - typically PRs opened from a fork's default branch,
// which say nothing about two changes belonging together.
const GENERIC_BRANCH_NAMES = new Set(["master", "main", "develop", "dev", "trunk", "release", "staging", "production"]);

export function matchTicket(text: string | null | undefined, pattern: RegExp): string | null {
    const ticket = text?.match(pattern)?.[1]?.toUpperCase();
    if (!ticket) return null;
    return TICKET_PREFIX_BLOCKLIST.has(ticket.split("-")[0] ?? "") ? null : ticket;
}

/**
 * The best signal first: an explicit `Part-of: <key>` line in the body, then a ticket id, then the
 * branch name (identical branch names across repos are how a ticket-less change is usually spread).
 * Null only when a PR has no usable branch name to fall back on.
 */
export function featureKey(
    title: string | null | undefined,
    headRef: string | null | undefined,
    body: string | null | undefined,
): FeatureKey | null {
    const trailer = body?.match(FEATURE_TRAILER_RE)?.[1];
    if (trailer) {
        const label = trailer.trim();
        return { key: `part-of:${label.toLowerCase()}`, label, kind: "declared" };
    }

    const ticket = matchTicket(title, TICKET_IN_TITLE_RE) ?? matchTicket(headRef, TICKET_IN_BRANCH_RE);
    if (ticket) return { key: `ticket:${ticket}`, label: ticket, kind: "ticket" };

    if (headRef && !GENERIC_BRANCH_NAMES.has(headRef.toLowerCase())) {
        return { key: `branch:${headRef}`, label: headRef, kind: "branch" };
    }
    return null;
}

/** The name a `Stack: <name>` line in a PR body gives its stack. */
export function stackTrailer(body: string | null | undefined): string | null {
    return body?.match(STACK_TRAILER_RE)?.[1]?.trim() ?? null;
}

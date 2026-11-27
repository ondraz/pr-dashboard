/** A review as the GraphQL `reviews` connection returns it. */
export interface ReviewLike {
    id: string;
    databaseId?: number | null;
    state: string;
    body?: string | null;
    author?: { login: string } | null;
}

export interface CopilotVerdict {
    /** The review's GraphQL node id. */
    id: string;
    /** The review's REST id, which GitHub's `#pullrequestreview-<id>` anchors use. */
    databaseId: number | null;
    label: string;
    /** True when the verdict asks for a change to the code. */
    owing: boolean;
}

const COPILOT_RE = /copilot/i;
const COPILOT_APPROVAL_RE = /approval recommended|looks good|no (?:issues|comments)/i;
// Asks a human to verify something Copilot could not, not for a change to the code, so there is
// nothing to resolve.
const COPILOT_CLOSER_LOOK_RE = /needs a closer look/i;
// The title Copilot's newer bodies put above the verdict, and the reviews that read nothing at
// all - neither says anything is owed.
const COPILOT_OVERVIEW_TITLE_RE = /^copilot review overview$/i;
const COPILOT_NO_REVIEW_RE = /^copilot (?:wasn't able to review|encountered an error)/i;

export function isCopilot(login: string | null | undefined): boolean {
    return !!login && COPILOT_RE.test(login);
}

/**
 * Copilot reviews every push, so in a list ordered oldest to newest the last Copilot review is the
 * one that describes the code as it is now.
 */
export function latestCopilotReview<R extends ReviewLike>(reviews: readonly (R | null)[]): R | null {
    return reviews.filter((review): review is R => !!review && isCopilot(review.author?.login)).pop() ?? null;
}

/**
 * Copilot names its verdict in a heading - "Changes recommended", "Needs a closer look",
 * "Approval recommended". Newer bodies open with an HTML marker comment and a "Copilot review
 * overview" title and carry the verdict in the heading below; older ones lead with the verdict
 * itself. Neither the heading marks nor the status emoji in front of the words are part of it.
 */
export function copilotVerdict(review: ReviewLike | null | undefined): CopilotVerdict | null {
    if (!review) return null;
    const lines = (review.body ?? "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean);
    const strip = (line: string) =>
        line
            .replace(/^#+\s*/, "")
            .replace(/^[^\p{L}\p{N}]+/u, "")
            .replace(/"/g, "")
            .trim();
    const headings = lines.filter((line) => line.startsWith("#"));
    const label = (headings.length ? headings : lines)
        .map(strip)
        .find((text) => text && !COPILOT_OVERVIEW_TITLE_RE.test(text));
    if (!label || COPILOT_NO_REVIEW_RE.test(label)) return null;
    return {
        id: review.id,
        databaseId: review.databaseId ?? null,
        label: label.slice(0, 60),
        owing: review.state !== "APPROVED" && !COPILOT_APPROVAL_RE.test(label) && !COPILOT_CLOSER_LOOK_RE.test(label),
    };
}

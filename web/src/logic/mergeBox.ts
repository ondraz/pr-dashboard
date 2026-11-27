import type { AutoMerge } from "./stacks.ts";
import type { MergeQueueEntry } from "./unresolved.ts";

export type Tone = "ok" | "warn" | "fail" | "pending" | "neutral" | "merged";

export interface MergeRow {
    kind: "state" | "reviews" | "checks" | "merge" | "auto";
    tone: Tone;
    title: string;
    detail?: string;
}

export interface CheckCount {
    state: string;
    count: number;
}

/** What the merge box reads of a PR, as GitHub's GraphQL API names it. */
export interface MergeInput {
    state: string;
    isDraft: boolean;
    baseRefName: string;
    mergeable: string;
    mergeStateStatus: string;
    reviewDecision: string | null;
    checks: { state: string; counts: CheckCount[] } | null;
    autoMerge: AutoMerge | null;
    mergeQueue: MergeQueueEntry | null;
}

const FAILING = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const PENDING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);
const SKIPPED = new Set(["SKIPPED", "NEUTRAL"]);

export type CheckGroup = "failing" | "pending" | "successful" | "skipped";

/** Where a check run's or a status's state puts it: a run's conclusion once it has one, else its status. */
export function checkGroup(state: string): CheckGroup {
    if (FAILING.has(state)) return "failing";
    if (PENDING.has(state)) return "pending";
    if (SKIPPED.has(state)) return "skipped";
    return "successful";
}

/** "2 failing, 5 successful, 1 pending" from check runs and commit statuses counted by state. */
export function checkCounts(counts: readonly CheckCount[]): string {
    const tally: Record<CheckGroup, number> = { failing: 0, successful: 0, pending: 0, skipped: 0 };
    for (const { state, count } of counts) tally[checkGroup(state)] += count;
    return Object.entries(tally)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${count} ${name}`)
        .join(", ");
}

function reviewsRow(decision: string | null): MergeRow {
    switch (decision) {
        case "APPROVED":
            return { kind: "reviews", tone: "ok", title: "Changes approved" };
        case "CHANGES_REQUESTED":
            return { kind: "reviews", tone: "fail", title: "Changes requested" };
        case "REVIEW_REQUIRED":
            return { kind: "reviews", tone: "warn", title: "Review required" };
        default:
            return { kind: "reviews", tone: "neutral", title: "No review required" };
    }
}

function checksRow(checks: MergeInput["checks"]): MergeRow {
    if (!checks) return { kind: "checks", tone: "neutral", title: "No checks" };
    const detail = checkCounts(checks.counts) || undefined;
    if (checks.state === "SUCCESS") return { kind: "checks", tone: "ok", title: "All checks have passed", detail };
    if (checks.state === "PENDING" || checks.state === "EXPECTED") {
        return { kind: "checks", tone: "pending", title: "Some checks haven't completed yet", detail };
    }
    return { kind: "checks", tone: "fail", title: "Some checks were not successful", detail };
}

function mergeRow(pr: MergeInput): MergeRow {
    if (pr.isDraft) return { kind: "merge", tone: "neutral", title: "This pull request is still a draft" };
    if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
        return {
            kind: "merge",
            tone: "fail",
            title: "This branch has conflicts that must be resolved",
            detail: `with ${pr.baseRefName}`,
        };
    }
    switch (pr.mergeStateStatus) {
        case "BEHIND":
            return { kind: "merge", tone: "warn", title: "This branch is out-of-date with the base branch" };
        case "BLOCKED":
            return { kind: "merge", tone: "warn", title: "Merging is blocked", detail: "by the base branch's rules" };
        case "UNSTABLE":
            return { kind: "merge", tone: "warn", title: "Mergeable, with failing checks that are not required" };
        case "CLEAN":
        case "HAS_HOOKS":
            return { kind: "merge", tone: "ok", title: "No conflicts with the base branch" };
        default:
            return { kind: "merge", tone: "pending", title: "Checking whether it can be merged" };
    }
}

function autoRow(pr: MergeInput): MergeRow | null {
    if (pr.mergeQueue) {
        const position = Number.isInteger(pr.mergeQueue.position) ? ` at position ${pr.mergeQueue.position}` : "";
        const state = pr.mergeQueue.state ? pr.mergeQueue.state.toLowerCase().replace(/_/g, " ") : undefined;
        return { kind: "auto", tone: "pending", title: `Queued to merge${position}`, detail: state };
    }
    if (pr.autoMerge) {
        const method = pr.autoMerge.method ? ` (${pr.autoMerge.method})` : "";
        const by = pr.autoMerge.enabledBy ? ` by ${pr.autoMerge.enabledBy}` : "";
        return {
            kind: "auto",
            tone: "ok",
            title: `Auto-merge enabled${method}${by}`,
            detail: "merges once checks and reviews pass",
        };
    }
    return null;
}

/** The merge box, top to bottom: reviews, checks, mergeability and what merges it, as on GitHub. */
export function mergeBoxRows(pr: MergeInput): MergeRow[] {
    if (pr.state === "MERGED") return [{ kind: "state", tone: "merged", title: "Merged" }];
    if (pr.state === "CLOSED") return [{ kind: "state", tone: "neutral", title: "Closed without merging" }];
    const auto = autoRow(pr);
    return [reviewsRow(pr.reviewDecision), checksRow(pr.checks), mergeRow(pr), ...(auto ? [auto] : [])];
}

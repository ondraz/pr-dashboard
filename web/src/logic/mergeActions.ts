export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";

/** What the merge box's actions read of a PR, as GitHub's GraphQL API names it. */
export interface MergeActionInput {
    state: string;
    isDraft: boolean;
    mergeStateStatus: string;
    viewerCanUpdate: boolean;
    viewerCanUpdateBranch: boolean;
    viewerCanEnableAutoMerge: boolean;
    viewerCanDisableAutoMerge: boolean;
    isMergeQueueEnabled: boolean;
    autoMergeEnabled: boolean;
    queued: boolean;
    methods: { merge: boolean; squash: boolean; rebase: boolean; preferred: MergeMethod };
}

/**
 * The one way the box offers to land the PR: merge it now, merge it once checks and reviews pass, or, on a base
 * branch with a merge queue, add it to the queue now or once it may join.
 */
export type LandAction = "merge" | "auto-merge" | "enqueue" | "queue-when-ready";

export interface MergeActions {
    land: LandAction | null;
    /** The methods `land` may take, the preferred one first; empty when a merge queue decides. */
    methods: MergeMethod[];
    /** Takes back what is already set to land it. */
    cancel: "disable-auto-merge" | "dequeue" | null;
    updateBranch: boolean;
    readyForReview: boolean;
    convertToDraft: boolean;
}

const NONE: MergeActions = {
    land: null,
    methods: [],
    cancel: null,
    updateBranch: false,
    readyForReview: false,
    convertToDraft: false,
};

/** States in which GitHub merges at once; UNSTABLE fails only checks that are not required. */
const MERGEABLE_NOW = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);

const ORDER: readonly MergeMethod[] = ["MERGE", "SQUASH", "REBASE"];

/** The methods the repository allows, the viewer's last one (GitHub's default for them) first. */
export function mergeMethods(methods: MergeActionInput["methods"]): MergeMethod[] {
    const on: Record<MergeMethod, boolean> = { MERGE: methods.merge, SQUASH: methods.squash, REBASE: methods.rebase };
    const allowed = ORDER.filter((method) => on[method]);
    return allowed.includes(methods.preferred)
        ? [methods.preferred, ...allowed.filter((method) => method !== methods.preferred)]
        : allowed;
}

/**
 * What the merge box lets the viewer do, as GitHub's offers it. Merging over the base branch's rules is left to
 * github.com, so a blocked PR offers only auto-merge.
 */
export function mergeActions(pr: MergeActionInput): MergeActions {
    if (pr.state !== "OPEN") return NONE;
    if (pr.isDraft) return { ...NONE, readyForReview: pr.viewerCanUpdate };
    const base = { ...NONE, convertToDraft: pr.viewerCanUpdate && !pr.queued };
    if (pr.queued) return { ...base, cancel: "dequeue" };
    const updateBranch = pr.viewerCanUpdateBranch;
    if (pr.autoMergeEnabled) {
        return { ...base, updateBranch, cancel: pr.viewerCanDisableAutoMerge ? "disable-auto-merge" : null };
    }
    const now = MERGEABLE_NOW.has(pr.mergeStateStatus);
    if (pr.isMergeQueueEnabled) {
        const land = now ? "enqueue" : pr.viewerCanEnableAutoMerge ? "queue-when-ready" : null;
        return { ...base, updateBranch, land };
    }
    const methods = mergeMethods(pr.methods);
    if (!methods.length) return { ...base, updateBranch };
    const land = now ? "merge" : pr.viewerCanEnableAutoMerge ? "auto-merge" : null;
    return { ...base, updateBranch, land, methods: land ? methods : [] };
}

const VERB: Record<MergeMethod, string> = {
    MERGE: "Merge pull request",
    SQUASH: "Squash and merge",
    REBASE: "Rebase and merge",
};

/** The landing button's label, as GitHub words it. */
export function landLabel(land: LandAction, method: MergeMethod | null): string {
    switch (land) {
        case "merge":
            return VERB[method ?? "MERGE"];
        case "auto-merge":
            return `Enable auto-merge (${(method ?? "MERGE").toLowerCase()})`;
        case "enqueue":
            return "Add to merge queue";
        case "queue-when-ready":
            return "Merge when ready";
    }
}

/** Whether landing by `method` writes a commit message of its own: a rebase replays the PR's commits as they are. */
export const takesMessage = (land: LandAction, method: MergeMethod | null) =>
    (land === "merge" || land === "auto-merge") && method !== "REBASE";

/** The button that confirms landing, as GitHub words it. */
export function confirmLabel(land: LandAction, method: MergeMethod | null): string {
    switch (land) {
        case "merge":
            return method === "SQUASH"
                ? "Confirm squash and merge"
                : method === "REBASE"
                  ? "Confirm rebase and merge"
                  : "Confirm merge";
        case "auto-merge":
            return "Confirm auto-merge";
        case "enqueue":
            return "Confirm add to merge queue";
        case "queue-when-ready":
            return "Confirm merge when ready";
    }
}

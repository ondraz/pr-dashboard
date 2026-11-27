import { type FeatureKey, featureKey, stackTrailer } from "./feature.ts";

/** One side of a PR (`head` or `base`) as the REST API returns it. */
export interface PullSide {
    label?: string | null;
    ref?: string | null;
    sha?: string | null;
    repo?: { full_name?: string | null; default_branch?: string | null } | null;
}

/** The fields of a REST pull request the stack index reads. */
export interface PullDetail {
    number: number;
    title: string;
    html_url: string;
    body?: string | null;
    draft?: boolean | null;
    mergeable?: boolean | null;
    updated_at: string;
    user?: { login: string } | null;
    requested_reviewers?: readonly { login: string }[] | null;
    auto_merge?: { merge_method?: string | null; enabled_by?: { login: string } | null } | null;
    head?: PullSide | null;
    base?: PullSide | null;
}

export interface AutoMerge {
    method: string;
    enabledBy: string;
}

export interface StackName {
    text: string;
    /** True when a `Stack:` line named it, false when the bottom PR's title stands in. */
    declared: boolean;
}

export interface Stack {
    /** The number of the bottom PR. */
    id: number;
    size: number;
    /** Bottom-up: the PR closest to the base branch comes first. */
    ordered: StackNode[];
    maxDepth: number;
    /** The base branch under the chain, when it has a single root. */
    rootBaseRef: string | null;
    name: StackName | null;
}

export interface StackNode {
    number: number;
    title: string;
    html_url: string;
    draft: boolean;
    autoMerge: AutoMerge | null;
    conflicting: boolean;
    author: string;
    updated_at: string;
    requestedReviewers: string[];
    defaultBranch: string | null;
    baseRef: string;
    headRef: string;
    repoFullName: string;
    feature: FeatureKey | null;
    stackTrailer: string | null;
    headLabel: string | null;
    baseLabel: string | null;
    parent: StackNode | null;
    children: StackNode[];
    /** 1 for a PR on a branch that is no PR's head, counting up the chain. */
    depth: number;
    /** Set on every node `buildStackIndex` returns. */
    stack: Stack | null;
}

/** GitHub fills `auto_merge` only while auto-merge is armed and still waiting. */
export function autoMergeInfo(pr: Pick<PullDetail, "auto_merge"> | null | undefined): AutoMerge | null {
    if (!pr?.auto_merge) return null;
    return { method: pr.auto_merge.merge_method ?? "", enabledBy: pr.auto_merge.enabled_by?.login ?? "" };
}

/** `owner:branch`, unique per branch even when a PR is opened from a fork. */
export function refLabel(side: PullSide | null | undefined): string | null {
    if (!side) return null;
    if (side.label) return side.label;
    if (!side.ref) return null;
    const owner = side.repo?.full_name ? side.repo.full_name.split("/")[0] : "";
    return `${owner}:${side.ref}`;
}

/** The member nearest the base with a `Stack:` line names the stack; otherwise the bottom PR's title. */
export function stackName(orderedBottomUp: readonly Pick<StackNode, "title" | "stackTrailer">[]): StackName | null {
    const declared = orderedBottomUp.find((node) => node.stackTrailer);
    if (declared?.stackTrailer) return { text: declared.stackTrailer, declared: true };
    const bottom = orderedBottomUp[0];
    return bottom?.title ? { text: bottom.title, declared: false } : null;
}

function toNode(pr: PullDetail, repoFullName: string): StackNode {
    return {
        number: pr.number,
        title: pr.title,
        html_url: pr.html_url,
        draft: !!pr.draft,
        autoMerge: autoMergeInfo(pr),
        // GitHub answers null while it is still computing mergeability, so a PR shows conflicts
        // once GitHub knows.
        conflicting: pr.mergeable === false,
        author: pr.user?.login ?? "",
        updated_at: pr.updated_at,
        requestedReviewers: (pr.requested_reviewers ?? []).map((reviewer) => reviewer.login),
        defaultBranch: pr.base?.repo?.default_branch ?? null,
        baseRef: pr.base?.ref ?? "",
        headRef: pr.head?.ref ?? "",
        repoFullName,
        feature: featureKey(pr.title, pr.head?.ref ?? "", pr.body ?? ""),
        stackTrailer: stackTrailer(pr.body),
        headLabel: refLabel(pr.head),
        baseLabel: refLabel(pr.base),
        parent: null,
        children: [],
        depth: 1,
        stack: null,
    };
}

const byNumber = (a: StackNode, b: StackNode) => a.number - b.number;

/**
 * Two open PRs are stacked when one's base branch is the other's head branch, and chains of those
 * links form a stack. Maps each PR number to its node, which carries its position in the stack.
 */
export function buildStackIndex(repoPRs: readonly PullDetail[], repoFullName: string): Map<number, StackNode> {
    const nodes = repoPRs.map((pr) => toNode(pr, repoFullName));

    const byHead = new Map<string, StackNode>();
    for (const node of nodes) {
        if (node.headLabel && !byHead.has(node.headLabel)) byHead.set(node.headLabel, node);
    }
    for (const node of nodes) {
        const parent = node.baseLabel ? byHead.get(node.baseLabel) : undefined;
        if (parent && parent !== node) {
            node.parent = parent;
            parent.children.push(node);
        }
    }

    // Retargeted branches can end up pointing at each other; cut the link closing the loop.
    for (const node of nodes) {
        const seen = new Set([node]);
        let current = node;
        while (current.parent) {
            const parent: StackNode = current.parent;
            if (seen.has(parent)) {
                parent.children = parent.children.filter((child) => child !== current);
                current.parent = null;
                break;
            }
            seen.add(parent);
            current = parent;
        }
    }

    const index = new Map<number, StackNode>();
    const visited = new Set<StackNode>();
    for (const node of nodes) {
        if (visited.has(node)) continue;

        const members: StackNode[] = [];
        const queue = [node];
        visited.add(node);
        for (let current = queue.pop(); current; current = queue.pop()) {
            members.push(current);
            const neighbours = current.parent ? [current.parent, ...current.children] : current.children;
            for (const neighbour of neighbours) {
                if (visited.has(neighbour)) continue;
                visited.add(neighbour);
                queue.push(neighbour);
            }
        }

        const stack: Stack = { id: 0, size: members.length, ordered: [], maxDepth: 1, rootBaseRef: null, name: null };
        const roots = members.filter((member) => !member.parent).sort(byNumber);
        const walk = (current: StackNode, depth: number) => {
            current.depth = depth;
            current.stack = stack;
            stack.ordered.push(current);
            stack.maxDepth = Math.max(stack.maxDepth, depth);
            for (const child of current.children.slice().sort(byNumber)) walk(child, depth + 1);
        };
        for (const root of roots) walk(root, 1);
        for (const member of members) {
            if (member.stack) continue;
            member.stack = stack;
            stack.ordered.push(member);
        }
        stack.id = stack.ordered[0]?.number ?? node.number;
        stack.rootBaseRef = roots.length === 1 ? (roots[0]?.baseRef ?? null) : null;
        stack.name = stackName(stack.ordered);

        for (const member of members) index.set(member.number, member);
    }

    return index;
}

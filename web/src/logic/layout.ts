import type { FeatureKey, FeatureKind } from "./feature.ts";
import { byRepo, newestUpdate } from "./filters.ts";
import type { Stack, StackNode } from "./stacks.ts";

/** The fields of a listed PR (one of the viewer's own) that the layout reads. */
export interface LayoutPr {
    repoFullName: string;
    number: number;
    updated_at: string;
    feature: FeatureKey | null;
    stackNode: StackNode | null;
}

/** A stack member: one of the listed PRs, or muted context (someone else's, or filtered out). */
export type StackMember<P> = { kind: "pr"; pr: P } | { kind: "context"; node: StackNode };

export type Row<P> = { kind: "pr"; pr: P } | { kind: "stack"; stack: Stack; members: StackMember<P>[] };

export interface RepoBody<P> {
    rows: Row<P>[];
    /** The listed PRs that got a row, which can include stack members from outside the repo's own list. */
    drawn: P[];
}

export interface FeatureGroup<P> {
    key: string;
    label: string;
    kind: FeatureKind;
    prs: P[];
    /** Parts of the same change owned by someone else. */
    context: StackNode[];
    repos: Set<string>;
}

export interface FeatureSection<P> extends RepoBody<P> {
    repo: string;
    context: StackNode[];
}

export interface FeatureBlock<P> {
    group: FeatureGroup<P>;
    sections: FeatureSection<P>[];
    drawn: P[];
    prCount: number;
}

export interface ListLayout<P> {
    /** Cross-repo sets, only filled when grouping by feature. */
    features: FeatureBlock<P>[];
    /** Repositories with the PRs not in a cross-repo set (or every PR, when grouping by repo). */
    repos: { repo: string; body: RepoBody<P> }[];
    /** Repositories each cross-repo key spans, for the badge in the by-repo view. */
    featureSpan: Map<string, number>;
}

export const prKey = (pr: { repoFullName: string; number: number }) => `${pr.repoFullName}#${pr.number}`;

/**
 * One change implemented across several repositories. Only keys held by the viewer's own PRs in two
 * or more repos qualify; a key confined to one repo is just a branch. `repoNodes` are every open PR
 * seen while building stacks, so a group can also show the parts a colleague owns.
 */
export function buildFeatureGroups<P extends LayoutPr>(
    prs: readonly P[],
    repoNodes: readonly StackNode[],
): FeatureGroup<P>[] {
    const groups = new Map<string, FeatureGroup<P>>();
    for (const pr of prs) {
        if (!pr.feature) continue;
        let group = groups.get(pr.feature.key);
        if (!group) {
            group = { ...pr.feature, prs: [], context: [], repos: new Set() };
            groups.set(pr.feature.key, group);
        }
        group.prs.push(pr);
        group.repos.add(pr.repoFullName);
    }

    for (const [key, group] of groups) {
        if (group.repos.size < 2) groups.delete(key);
    }
    if (groups.size === 0) return [];

    const own = new Set(prs.map(prKey));
    for (const node of repoNodes) {
        const group = node.feature ? groups.get(node.feature.key) : undefined;
        if (!group || own.has(prKey(node))) continue;
        group.context.push(node);
        group.repos.add(node.repoFullName);
    }

    return [...groups.values()].sort((a, b) => newestUpdate(b.prs) - newestUpdate(a.prs));
}

/**
 * The PRs of one repo with stacks collapsed into a single chain. A stack takes the position of its
 * most recently updated member and is drawn once per page (`renderedStacks` is shared), so its
 * members are looked up in `listed` rather than the repo's own PRs - otherwise the viewer's other
 * members would render as context.
 */
export function repoBody<P extends LayoutPr>(
    prs: readonly P[],
    renderedStacks: Set<Stack>,
    listed: ReadonlyMap<string, P>,
): RepoBody<P> {
    const rows: Row<P>[] = [];
    const drawn: P[] = [];
    for (const pr of prs) {
        const stack = pr.stackNode?.stack;
        if (!stack || stack.size < 2) {
            rows.push({ kind: "pr", pr });
            drawn.push(pr);
            continue;
        }
        // Every member is drawn with the stack, so skipping one already drawn cannot hide a PR.
        if (renderedStacks.has(stack)) continue;
        renderedStacks.add(stack);
        // Tip first, so the PR on the base branch sits at the bottom, as in `git log`.
        const members = stack.ordered
            .slice()
            .reverse()
            .map((node): StackMember<P> => {
                const member = listed.get(prKey(node));
                if (!member) return { kind: "context", node };
                drawn.push(member);
                return { kind: "pr", pr: member };
            });
        rows.push({ kind: "stack", stack, members });
    }
    return { rows, drawn };
}

function featureBlock<P extends LayoutPr>(
    group: FeatureGroup<P>,
    renderedStacks: Set<Stack>,
    listed: ReadonlyMap<string, P>,
): FeatureBlock<P> | null {
    const contextByRepo = new Map<string, StackNode[]>();
    for (const node of group.context) {
        const list = contextByRepo.get(node.repoFullName);
        if (list) list.push(node);
        else contextByRepo.set(node.repoFullName, [node]);
    }

    const repos = byRepo(group.prs);
    const ownRepos = new Set(repos.map(([repo]) => repo));
    for (const repo of contextByRepo.keys()) {
        if (!ownRepos.has(repo)) repos.push([repo, []]);
    }

    const sections: FeatureSection<P>[] = [];
    const drawn: P[] = [];
    let prCount = 0;
    for (const [repo, prs] of repos) {
        const body = repoBody(prs, renderedStacks, listed);

        // A member already drawn inside a stack chain must not repeat below it.
        const inStacks = new Set<number>();
        for (const pr of prs) {
            for (const member of pr.stackNode?.stack?.ordered ?? []) inStacks.add(member.number);
        }
        const context = (contextByRepo.get(repo) ?? [])
            .filter((node) => !inStacks.has(node.number))
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

        // The viewer's PRs here may all sit in a stack another group already drew.
        if (body.rows.length === 0 && context.length === 0) continue;
        sections.push({ repo, ...body, context });
        drawn.push(...body.drawn);
        prCount += body.drawn.length + context.length;
    }

    return sections.length ? { group, sections, drawn, prCount } : null;
}

/** What the "mine" tab shows for the PRs that pass the filters, grouped by repo or by feature. */
export function listLayout<P extends LayoutPr>(
    filtered: readonly P[],
    repoNodes: readonly StackNode[],
    grouping: "repo" | "feature",
): ListLayout<P> {
    const listed = new Map(filtered.map((pr) => [prKey(pr), pr]));
    const groups = buildFeatureGroups(filtered, repoNodes);
    const featureSpan = new Map(groups.map((group) => [group.key, group.repos.size]));
    const renderedStacks = new Set<Stack>();

    const features: FeatureBlock<P>[] = [];
    let rest: readonly P[] = filtered;
    if (grouping === "feature") {
        for (const group of groups) {
            const block = featureBlock(group, renderedStacks, listed);
            if (block) features.push(block);
        }
        const grouped = new Set(groups.flatMap((group) => group.prs));
        rest = filtered.filter((pr) => !grouped.has(pr));
    }

    const repos = byRepo(rest)
        .map(([repo, prs]) => ({ repo, body: repoBody(prs, renderedStacks, listed) }))
        .filter(({ body }) => body.rows.length > 0);
    return { features, repos, featureSpan };
}

/** The unresolved total of a group, so a collapsed section still says there is work in it. */
export function unresolvedTotal(prs: readonly { unresolved?: number }[]): number {
    return prs.reduce((sum, pr) => sum + (pr.unresolved ?? 0), 0);
}

/** The element id of a cross-repo group, which the by-repo view's badge jumps to. */
export function featureId(key: string): string {
    return `feature-${key.replace(/[^a-z0-9]+/gi, "-")}`;
}

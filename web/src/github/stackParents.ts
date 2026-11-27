import { type PullDetail, refLabel } from "../logic/stacks.ts";

const HOP_CAP = 5;

/** Looks up the open PR whose head is `label` in `repoFullName`, or null. */
export type FindPrByHead = (repoFullName: string, label: string) => Promise<PullDetail | null>;

/**
 * The open PRs the viewer's own are stacked on but that are not theirs: from every base that is
 * neither the default branch nor the head of a PR already known, look up the open PR whose head it
 * is, and repeat from there, at most five times. Listing the whole repository instead would cost
 * pages of full PR objects in a busy one. PRs stacked on top by someone else stay unseen.
 */
export async function fetchStackParents(
    repoFullName: string,
    ownPRs: readonly PullDetail[],
    findByHead: FindPrByHead,
): Promise<PullDetail[]> {
    const knownHeads = new Set(ownPRs.map((pr) => refLabel(pr.head)));
    const knownNumbers = new Set(ownPRs.map((pr) => pr.number));
    const parents: PullDetail[] = [];
    let frontier: readonly PullDetail[] = ownPRs;
    for (let hop = 0; hop < HOP_CAP && frontier.length; hop++) {
        const wanted = new Set<string>();
        for (const pr of frontier) {
            const base = pr.base;
            if (!base?.ref) continue;
            if (base.repo && base.ref === base.repo.default_branch) continue;
            const label = refLabel(base);
            if (label && !knownHeads.has(label)) wanted.add(label);
        }
        const found = await Promise.all([...wanted].map((label) => findByHead(repoFullName, label)));
        for (const label of wanted) knownHeads.add(label);
        frontier = found.filter((pr): pr is PullDetail => !!pr && !knownNumbers.has(pr.number));
        for (const pr of frontier) {
            knownNumbers.add(pr.number);
            knownHeads.add(refLabel(pr.head));
            parents.push(pr);
        }
    }
    return parents;
}

import type { SearchName } from "./tabs.ts";

/** A search hit of the change check's GraphQL query; non-PR hits come back without fields. */
export interface ProbeNode {
    __typename?: string;
    id?: string;
    updatedAt?: string;
    headRefOid?: string;
    mergeable?: string;
    reviewDecision?: string | null;
    isDraft?: boolean;
    mergeQueueEntry?: { position: number } | null;
}

export interface ProbeConnection {
    issueCount: number;
    nodes?: readonly (ProbeNode | null)[] | null;
}

export type ProbeData = Partial<Record<SearchName, ProbeConnection | null>>;

const SEARCHES: readonly SearchName[] = ["mine", "requested", "reviewed"];

/**
 * Everything a refresh would show differently: which PRs each tab holds, and per PR its last update
 * (comments, reviews, pushes), head, mergeability, review decision, draft state and merge-queue
 * position. Two reads are equal exactly when nothing on the list changed.
 */
export class ChangeFingerprint {
    // GitHub works mergeability out lazily, so UNKNOWN keeps the last real answer.
    readonly #knownMergeable = new Map<string, string>();

    read(data: ProbeData): string {
        return JSON.stringify(
            SEARCHES.map((name) => {
                const connection = data[name] ?? { issueCount: 0, nodes: [] };
                const prs = (connection.nodes ?? [])
                    .filter((node): node is ProbeNode & { id: string } => !!node?.id)
                    .map((node) => {
                        if (node.mergeable && node.mergeable !== "UNKNOWN") {
                            this.#knownMergeable.set(node.id, node.mergeable);
                        }
                        return [
                            node.id,
                            node.updatedAt,
                            node.headRefOid,
                            this.#knownMergeable.get(node.id) ?? "UNKNOWN",
                            node.reviewDecision,
                            node.isDraft,
                            node.mergeQueueEntry ? node.mergeQueueEntry.position : null,
                        ];
                    })
                    .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
                return [connection.issueCount, prs];
            }),
        );
    }
}

/** The fields of one PR its live check reads. */
export interface PrProbe {
    updatedAt: string;
    state: string;
    isDraft: boolean;
    headRefOid: string;
    mergeable: string;
    mergeStateStatus: string;
    reviewDecision: string | null;
    mergeQueueEntry?: { position: number } | null;
    headCommit: { nodes?: readonly ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] | null };
}

/**
 * Everything that changes what an open PR's page shows. `updatedAt` moves with comments, reviews,
 * pushes and edits, but not when a check finishes or GitHub works out mergeability, so those count
 * on their own.
 */
export function prFingerprint(pr: PrProbe): string {
    return JSON.stringify([
        pr.updatedAt,
        pr.state,
        pr.isDraft,
        pr.headRefOid,
        pr.mergeable,
        pr.mergeStateStatus,
        pr.reviewDecision,
        pr.mergeQueueEntry?.position ?? null,
        pr.headCommit.nodes?.[0]?.commit.statusCheckRollup?.state ?? null,
    ]);
}

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

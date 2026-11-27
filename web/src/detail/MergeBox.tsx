import { Link } from "@tanstack/react-router";
import { useWriteAccess } from "../app/writeAccess.tsx";
import { mergeBoxRows } from "../logic/mergeBox.ts";
import type { AutoMerge } from "../logic/stacks.ts";
import { MergeActions } from "./MergeActions.tsx";
import { useOpenPr } from "./PrContext.tsx";

const TONE_MARK = { ok: "✓", warn: "!", fail: "✕", pending: "●", neutral: "–", merged: "✓" } as const;

/** Whether the PR can merge and what stands in the way, as GitHub's merge box says it, and what lands it. */
export function MergeBox() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const { canWrite } = useWriteAccess(route);
    const rollup = pr.headCommit.nodes?.[0]?.commit.statusCheckRollup ?? null;
    const autoMerge: AutoMerge | null = pr.autoMergeRequest
        ? {
              method: pr.autoMergeRequest.mergeMethod.toLowerCase(),
              enabledBy: pr.autoMergeRequest.enabledBy?.login ?? "",
          }
        : null;
    const rows = mergeBoxRows({
        state: pr.state,
        isDraft: pr.isDraft,
        baseRefName: pr.baseRefName,
        mergeable: pr.mergeable,
        mergeStateStatus: pr.mergeStateStatus,
        reviewDecision: pr.reviewDecision,
        checks: rollup
            ? {
                  state: rollup.state,
                  counts: [
                      ...(rollup.contexts.checkRunCountsByState ?? []),
                      ...(rollup.contexts.statusContextCountsByState ?? []),
                  ],
              }
            : null,
        autoMerge,
        mergeQueue: pr.mergeQueueEntry,
    });
    return (
        <section className="merge-box" aria-label="Merge status">
            {rows.map((row) => (
                <div key={row.kind} className={`merge-row tone-${row.tone}`}>
                    <span className="merge-mark" aria-hidden="true">
                        {TONE_MARK[row.tone]}
                    </span>
                    {row.kind === "checks" && rollup ? (
                        <Link className="merge-title" to="/$owner/$repo/pull/$number/checks" params={route}>
                            {row.title}
                        </Link>
                    ) : (
                        <span className="merge-title">{row.title}</span>
                    )}
                    {row.detail && <span className="merge-detail">{row.detail}</span>}
                </div>
            ))}
            {canWrite && <MergeActions />}
        </section>
    );
}

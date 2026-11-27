import { CommentIcon, ConflictIcon, MergeIcon, PrDraftIcon, PrOpenIcon } from "../list/icons.tsx";
import { External, GitHubLink, MergeBadge, SessionBadge } from "../list/PrRows.tsx";
import { unresolvedBadge } from "../logic/badges.ts";
import { isPendingThread } from "../logic/conversation.ts";
import type { AutoMerge } from "../logic/stacks.ts";
import { prUnresolvedSummary } from "../logic/unresolved.ts";
import { usePrListContext } from "./listContext.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestStack } from "./usePullRequest.ts";

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function StatePill({ state, draft }: { state: string; draft: boolean }) {
    if (state === "MERGED") {
        return (
            <span className="state-pill merged">
                <MergeIcon />
                Merged
            </span>
        );
    }
    if (state === "CLOSED") {
        return (
            <span className="state-pill closed">
                <PrDraftIcon />
                Closed
            </span>
        );
    }
    return (
        <span className={`state-pill ${draft ? "draft" : "open"}`}>
            {draft ? <PrDraftIcon /> : <PrOpenIcon />}
            {draft ? "Draft" : "Open"}
        </span>
    );
}

/** Title, state, branches and the list's badges. */
export function PrHeader() {
    const { route, detail } = useOpenPr();
    const { pr, threads } = detail;
    const { feature, made, reviewed } = usePrListContext(pr.url);
    const stack = usePullRequestStack(route).data ?? [];
    const position = stack.find((node) => node.number === pr.number);
    const unresolved = unresolvedBadge({
        html_url: pr.url,
        ...prUnresolvedSummary(
            threads.filter((thread) => !isPendingThread(thread)),
            pr.reviews?.nodes ?? [],
        ),
    });
    const autoMerge: AutoMerge | null = pr.autoMergeRequest
        ? {
              method: pr.autoMergeRequest.mergeMethod.toLowerCase(),
              enabledBy: pr.autoMergeRequest.enabledBy?.login ?? "",
          }
        : null;
    const head =
        pr.isCrossRepository && pr.headRepositoryOwner
            ? `${pr.headRepositoryOwner.login}:${pr.headRefName}`
            : pr.headRefName;
    const author = pr.author?.login ?? "ghost";
    const commits = plural(pr.commits.totalCount, "commit");

    return (
        <div className="pr-header">
            <h1 className="pr-heading">
                {pr.title} <span className="pr-heading-number">#{pr.number}</span>
                <GitHubLink htmlUrl={pr.url} number={pr.number} />
            </h1>
            <div className="pr-subhead">
                <StatePill state={pr.state} draft={pr.isDraft} />
                {position?.stack && (
                    <span
                        className="stack-pos"
                        title={`Level ${position.depth} of ${position.stack.maxDepth} in this stack`}
                    >
                        {position.depth}/{position.stack.maxDepth}
                    </span>
                )}
                <span className="pr-summary">
                    <External href={pr.author?.url ?? `https://github.com/${author}`}>{author}</External>
                    {pr.state === "MERGED" ? ` merged ${commits} into ` : ` wants to merge ${commits} into `}
                    <code className="branch">{pr.baseRefName}</code> from <code className="branch">{head}</code>
                </span>
                <MergeBadge autoMerge={autoMerge} mergeQueue={pr.mergeQueueEntry} />
                {pr.state === "OPEN" && pr.mergeable === "CONFLICTING" && (
                    <span className="conflict-badge" title={`Merge conflicts with ${pr.baseRefName}`}>
                        <ConflictIcon />
                        Conflicts
                    </span>
                )}
                {unresolved && (
                    <span className="unresolved-badge" title={unresolved.title}>
                        <CommentIcon />
                        {unresolved.count} unresolved
                    </span>
                )}
                {feature && (
                    <span
                        className="feature-badge"
                        title={`Part of a change spanning ${feature.repoCount} repositories`}
                    >
                        {feature.label} · {feature.repoCount} repos
                    </span>
                )}
                <SessionBadge session={made[0]} sessionRole="made" />
                <SessionBadge session={reviewed[0]} sessionRole="reviewed" />
            </div>
        </div>
    );
}

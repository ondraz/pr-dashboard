import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import type { PrSession } from "../../../shared/sessions.ts";
import type { MyPr, ReviewedPr, WaitingPr } from "../github/dashboard.ts";
import { mergeBadge, unresolvedBadge, unresolvedTotalTitle, waitingBadge } from "../logic/badges.ts";
import { labelColor } from "../logic/labels.ts";
import { unresolvedTotal } from "../logic/layout.ts";
import { prRouteOf } from "../logic/prRoute.ts";
import { type SessionRole, sessionLink } from "../logic/sessionLinks.ts";
import type { AutoMerge, StackNode } from "../logic/stacks.ts";
import { timeAgo } from "../logic/time.ts";
import type { MergeQueueEntry, UnresolvedSummary } from "../logic/unresolved.ts";
import { CommentIcon, ConflictIcon, GitHubIcon, MergeIcon, PrDraftIcon, PrOpenIcon, SparkIcon } from "./icons.tsx";

/** Opens GitHub in a new tab; the page itself never navigates away. */
export function External({
    href,
    className,
    title,
    children,
}: {
    href: string;
    className?: string;
    title?: string;
    children: ReactNode;
}) {
    return (
        <a className={className} href={href} title={title} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}

/** Opens the PR in the app; Cmd/Ctrl-click opens it on GitHub instead. */
export function PrLink({ htmlUrl, children }: { htmlUrl: string; children: ReactNode }) {
    const route = prRouteOf(htmlUrl);
    if (!route) return <External href={htmlUrl}>{children}</External>;
    const onClick = (event: MouseEvent) => {
        if (!event.metaKey && !event.ctrlKey) return;
        event.preventDefault();
        window.open(htmlUrl, "_blank", "noopener,noreferrer");
    };
    return (
        <Link to="/$owner/$repo/pull/$number" params={route} onClick={onClick}>
            {children}
        </Link>
    );
}

export function GitHubLink({ htmlUrl, number }: { htmlUrl: string; number: number }) {
    return (
        <External className="gh-link" href={htmlUrl} title="Open on GitHub">
            <GitHubIcon />
            <span className="sr-only">Open #{number} on GitHub</span>
        </External>
    );
}

/** A PR's title, opening it in the app, with the way to GitHub beside it. */
function TitleLinks({ pr }: { pr: { html_url: string; number: number; title: string } }) {
    return (
        <>
            <PrLink htmlUrl={pr.html_url}>{pr.title}</PrLink>
            <GitHubLink htmlUrl={pr.html_url} number={pr.number} />
        </>
    );
}

function StatusIcon({ draft }: { draft: boolean }) {
    return <span className={`pr-status ${draft ? "draft" : "open"}`}>{draft ? <PrDraftIcon /> : <PrOpenIcon />}</span>;
}

function DraftBadge({ draft }: { draft: boolean }) {
    return draft ? <span className="draft-badge">Draft</span> : null;
}

export function MergeBadge({
    autoMerge,
    mergeQueue,
}: {
    autoMerge: AutoMerge | null;
    mergeQueue?: MergeQueueEntry | null;
}) {
    const badge = mergeBadge(autoMerge, mergeQueue);
    if (!badge) return null;
    return (
        <span className={`automerge-badge${badge.inQueue ? " in-queue" : ""}`} title={badge.title}>
            <MergeIcon />
            {badge.text}
        </span>
    );
}

function ConflictBadge({ pr }: { pr: MyPr }) {
    if (!pr.conflicting) return null;
    const base = pr.stackNode?.baseRef ? ` with ${pr.stackNode.baseRef}` : "";
    return (
        <External
            className="conflict-badge"
            href={`${pr.html_url}#partial-pull-merging`}
            title={`Merge conflicts${base} - resolve them before this PR can merge`}
        >
            <ConflictIcon />
            Conflicts
        </External>
    );
}

function UnresolvedBadge({ pr }: { pr: { html_url: string; myOpenThreads?: number } & UnresolvedSummary }) {
    const badge = unresolvedBadge(pr);
    if (!badge) return null;
    return (
        <External className="unresolved-badge" href={badge.href} title={badge.title}>
            <CommentIcon />
            {badge.count} unresolved
        </External>
    );
}

/** A group's unresolved total, so a collapsed section still says there is work in it. */
export function UnresolvedTotal({ prs }: { prs: readonly { unresolved?: number }[] }) {
    const total = unresolvedTotal(prs);
    if (!total) return null;
    return (
        <span className="unresolved-badge" title={unresolvedTotalTitle(total)}>
            <CommentIcon />
            {total}
        </span>
    );
}

export function SessionBadge({ session, sessionRole }: { session: PrSession | undefined; sessionRole: SessionRole }) {
    const link = sessionLink(session, sessionRole);
    if (!link) return null;
    return (
        <a
            className={`session-badge${link.archived ? " archived" : ""}`}
            href={link.href}
            title={link.title}
            aria-label={link.title}
        >
            <SparkIcon />
            {link.app}
        </a>
    );
}

function StackPos({ node }: { node: StackNode | null }) {
    if (!node?.stack || node.stack.size < 2) return null;
    return (
        <span className="stack-pos" title={`Level ${node.depth} of ${node.stack.maxDepth} in this stack`}>
            {node.depth}/{node.stack.maxDepth}
        </span>
    );
}

/** What a PR sits on: the PR below it in the stack, or a base branch that is not the default one. */
function BaseMeta({ node }: { node: StackNode | null }) {
    if (node?.parent) {
        return (
            <>
                {" · "}
                <span className="pr-base">
                    based on <PrLink htmlUrl={node.parent.html_url}>#{node.parent.number}</PrLink>
                </span>
            </>
        );
    }
    if (node?.baseRef && node.baseRef !== node.defaultBranch) {
        return (
            <>
                {" · "}
                <span className="pr-base">onto {node.baseRef}</span>
            </>
        );
    }
    return null;
}

function ReviewState({ pr }: { pr: MyPr }) {
    if (pr.isDraft) return null;
    if (pr.reviewState === "APPROVED") return <span className="review-status review-approved">Approved</span>;
    if (pr.reviewState === "CHANGES_REQUESTED") {
        return <span className="review-status review-changes">Changes requested</span>;
    }
    const reviewers = pr.requestedReviewers.join(", ");
    return <span className="review-status review-pending">Review pending{reviewers ? `: ${reviewers}` : ""}</span>;
}

function Labels({ labels }: { labels: MyPr["labels"] }) {
    const named = labels.filter((label): label is typeof label & { name: string } => !!label.name);
    if (!named.length) return null;
    return (
        <span className="pr-labels">
            {named.map((label) => (
                <span
                    key={label.name}
                    className="pr-label"
                    style={{ background: labelColor(label.name), color: "var(--color-btn-text)" }}
                >
                    {label.name}
                </span>
            ))}
        </span>
    );
}

export interface FeatureBadgeProps {
    label: string;
    repoCount: number;
    onShow: () => void;
}

function FeatureBadge({ label, repoCount, onShow }: FeatureBadgeProps) {
    return (
        <button
            type="button"
            className="feature-badge"
            onClick={onShow}
            title={`Part of a change spanning ${repoCount} repositories - click to group by feature`}
        >
            {label} · {repoCount} repos
        </button>
    );
}

/** One of the viewer's own PRs. */
export function PrItem({
    pr,
    session,
    feature,
    now,
}: {
    pr: MyPr;
    session: PrSession | undefined;
    feature: FeatureBadgeProps | null;
    now: number;
}) {
    return (
        <div className="pr-item">
            <StatusIcon draft={pr.isDraft} />
            <div className="pr-info">
                <div className="pr-title">
                    <StackPos node={pr.stackNode} />
                    <TitleLinks pr={pr} />
                    <DraftBadge draft={pr.isDraft} />
                    <MergeBadge autoMerge={pr.autoMerge} mergeQueue={pr.mergeQueue} />
                    <ConflictBadge pr={pr} />
                    {feature && <FeatureBadge {...feature} />}
                    <Labels labels={pr.labels} />
                </div>
                <div className="pr-meta">
                    #{pr.number} opened {timeAgo(pr.created_at, now)}
                    <BaseMeta node={pr.stackNode} />
                </div>
            </div>
            <SessionBadge session={session} sessionRole="made" />
            <UnresolvedBadge pr={pr} />
            <ReviewState pr={pr} />
            <div className="pr-updated">{timeAgo(pr.updated_at, now)}</div>
        </div>
    );
}

/**
 * A stack or feature member that is not one of the listed PRs - someone else's, or filtered out -
 * muted so the chain stays readable without competing with the viewer's own PRs.
 */
export function ContextItem({ node, now }: { node: StackNode; now: number }) {
    return (
        <div className="pr-item pr-context">
            <StatusIcon draft={node.draft} />
            <div className="pr-info">
                <div className="pr-title">
                    <StackPos node={node} />
                    <TitleLinks pr={node} />
                    <DraftBadge draft={node.draft} />
                    <MergeBadge autoMerge={node.autoMerge} />
                </div>
                <div className="pr-meta">
                    #{node.number}
                    {node.author ? ` by ${node.author}` : ""}
                    <BaseMeta node={node} />
                </div>
            </div>
            <div className="pr-updated">{timeAgo(node.updated_at, now)}</div>
        </div>
    );
}

/** A PR waiting for the viewer's review. */
export function WaitingItem({ pr, session, now }: { pr: WaitingPr; session: PrSession | undefined; now: number }) {
    const badge = waitingBadge(pr, now);
    const author = pr.user?.login;
    return (
        <div className="pr-item">
            <StatusIcon draft={pr.isDraft} />
            <div className="pr-info">
                <div className="pr-title">
                    <TitleLinks pr={pr} />
                    <DraftBadge draft={pr.isDraft} />
                </div>
                <div className="pr-meta">
                    #{pr.number}
                    {author ? ` by ${author}` : ""} opened {timeAgo(pr.created_at, now)}
                </div>
            </div>
            <SessionBadge session={session} sessionRole="reviewed" />
            <UnresolvedBadge pr={pr} />
            <a
                className={`review-status ${badge.className}`}
                href={badge.href}
                target="_blank"
                rel="noopener noreferrer"
                title={badge.title}
                aria-label={badge.title}
            >
                {badge.text}
            </a>
            <div className="pr-updated">{timeAgo(pr.updated_at, now)}</div>
        </div>
    );
}

/** An open PR the viewer reviewed, badged with where that review stands. */
export function ReviewedItem({
    pr,
    session,
    badge,
    now,
}: {
    pr: ReviewedPr;
    session: PrSession | undefined;
    badge: { href: string; text: string; className: string };
    now: number;
}) {
    const author = pr.user?.login;
    return (
        <div className="pr-item">
            <StatusIcon draft={pr.isDraft} />
            <div className="pr-info">
                <div className="pr-title">
                    <TitleLinks pr={pr} />
                    <DraftBadge draft={pr.isDraft} />
                </div>
                <div className="pr-meta">
                    {pr.repoFullName.split("/")[1]} #{pr.number}
                    {author ? ` by ${author}` : ""}
                </div>
            </div>
            <SessionBadge session={session} sessionRole="reviewed" />
            <External className={`review-status ${badge.className}`} href={badge.href}>
                {badge.text}
            </External>
            <div className="pr-updated">{timeAgo(pr.updated_at, now)}</div>
        </div>
    );
}

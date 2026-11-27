import { type ReactNode, useMemo } from "react";
import type { ReviewThread } from "../github/pullRequest.ts";
import { CommitIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import {
    buildConversation,
    type CommitNode,
    type ConversationItem,
    type EventNode,
    hunkTail,
    type ReviewNode,
} from "../logic/conversation.ts";
import { labelColor } from "../logic/labels.ts";
import { timeAgo } from "../logic/time.ts";
import { Markdown } from "./Markdown.tsx";
import { MergeBox } from "./MergeBox.tsx";
import { useOpenPr } from "./PrContext.tsx";

interface Actor {
    login: string;
    avatarUrl?: string;
    url?: string;
}

function Who({ actor }: { actor: Actor | null | undefined }) {
    const login = actor?.login ?? "ghost";
    return (
        <span className="who">
            {actor?.avatarUrl && <img className="avatar" src={actor.avatarUrl} alt="" width={20} height={20} />}
            <External href={actor?.url ?? `https://github.com/${login}`}>{login}</External>
        </span>
    );
}

function When({ at, href }: { at: string; href?: string }) {
    const text = timeAgo(at);
    return (
        <time className="when" dateTime={at} title={new Date(at).toLocaleString()}>
            {href ? <External href={href}>{text}</External> : text}
        </time>
    );
}

function Card({ header, html, empty = "" }: { header: ReactNode; html: string; empty?: string }) {
    return (
        <div className="timeline-card">
            <div className="timeline-card-header">{header}</div>
            <div className="timeline-card-body">
                {html.trim() ? <Markdown html={html} /> : <p className="muted">{empty}</p>}
            </div>
        </div>
    );
}

function Thread({ thread }: { thread: ReviewThread }) {
    const comments = (thread.comments.nodes ?? []).filter((comment) => !!comment);
    const first = comments[0];
    const line = thread.line ?? thread.originalLine;
    const start = thread.startLine ?? thread.originalStartLine;
    const where =
        thread.subjectType === "FILE" ? "" : line ? `:${start && start !== line ? `${start}-` : ""}${line}` : "";
    return (
        <details className="thread" open={!thread.isResolved}>
            <summary>
                <code>
                    {thread.path}
                    {where}
                </code>
                {thread.isOutdated && <span className="thread-tag">Outdated</span>}
                {thread.isResolved && <span className="thread-tag">Resolved</span>}
            </summary>
            {first?.diffHunk && thread.subjectType !== "FILE" && (
                <pre className="hunk">
                    {hunkTail(first.diffHunk).map((row, n) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one fixed hunk
                        <div key={n} className={`hunk-${row.kind}`}>
                            {row.text || " "}
                        </div>
                    ))}
                </pre>
            )}
            {comments.map((comment) => (
                <div key={comment.id} className="thread-comment">
                    <div className="thread-comment-header">
                        <Who actor={comment.author} /> <When at={comment.createdAt} href={comment.url} />
                    </div>
                    <Markdown html={comment.bodyHTML} />
                </div>
            ))}
        </details>
    );
}

const REVIEW_VERB: Record<string, string> = {
    APPROVED: "approved these changes",
    CHANGES_REQUESTED: "requested changes",
    DISMISSED: "reviewed (dismissed)",
};

function Review({ review, threads }: { review: ReviewNode; threads: ReviewThread[] }) {
    const verb = REVIEW_VERB[review.state] ?? "reviewed";
    const at = review.submittedAt ?? review.createdAt;
    return (
        <div className={`timeline-review review-${review.state.toLowerCase()}`}>
            <div className="timeline-event">
                <Who actor={review.author} /> {verb} <When at={at} href={review.url} />
            </div>
            {review.bodyHTML.trim() && (
                <div className="timeline-card">
                    <div className="timeline-card-body">
                        <Markdown html={review.bodyHTML} />
                    </div>
                </div>
            )}
            {threads.map((thread) => (
                <Thread key={thread.id} thread={thread} />
            ))}
        </div>
    );
}

function Commits({ commits, prUrl }: { commits: CommitNode["commit"][]; prUrl: string }) {
    const author = commits[0]?.author;
    return (
        <div className="timeline-commits">
            <div className="timeline-event">
                <CommitIcon />
                <span className="who">{author?.user?.login ?? author?.name ?? "Someone"}</span> added{" "}
                {commits.length === 1 ? "a commit" : `${commits.length} commits`}
            </div>
            <ul className="commit-list">
                {commits.map((commit) => (
                    <li key={commit.oid}>
                        <span className="commit-headline">{commit.messageHeadline}</span>
                        <External className="sha" href={`${prUrl}/commits/${commit.oid}`}>
                            {commit.abbreviatedOid}
                        </External>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function reviewerName(reviewer: { login: string } | { combinedSlug: string } | null | undefined): string {
    if (!reviewer) return "someone";
    return "login" in reviewer ? reviewer.login : reviewer.combinedSlug;
}

function LabelChip({ name }: { name: string }) {
    return (
        <span className="pr-label" style={{ background: labelColor(name), color: "var(--color-btn-text)" }}>
            {name}
        </span>
    );
}

function eventText(event: EventNode): ReactNode {
    switch (event.__typename) {
        case "HeadRefForcePushedEvent":
            return (
                <>
                    force-pushed the branch from <code>{event.beforeCommit?.abbreviatedOid ?? "?"}</code> to{" "}
                    <code>{event.afterCommit?.abbreviatedOid ?? "?"}</code>
                </>
            );
        case "ReviewRequestedEvent":
            return <>requested a review from {reviewerName(event.requestedReviewer)}</>;
        case "ReviewRequestRemovedEvent":
            return <>removed the review request for {reviewerName(event.requestedReviewer)}</>;
        case "ReviewDismissedEvent":
            return (
                <>dismissed {event.dismissedReview?.author ? `${event.dismissedReview.author.login}'s` : "a"} review</>
            );
        case "LabeledEvent":
            return (
                <>
                    added the <LabelChip name={event.label.name} /> label
                </>
            );
        case "UnlabeledEvent":
            return (
                <>
                    removed the <LabelChip name={event.label.name} /> label
                </>
            );
        case "RenamedTitleEvent":
            return (
                <>
                    changed the title <del>{event.previousTitle}</del> {event.currentTitle}
                </>
            );
        case "BaseRefChangedEvent":
            return (
                <>
                    changed the base branch from <code>{event.previousRefName}</code> to{" "}
                    <code>{event.currentRefName}</code>
                </>
            );
        case "ReadyForReviewEvent":
            return <>marked this pull request as ready for review</>;
        case "ConvertToDraftEvent":
            return <>marked this pull request as draft</>;
        case "ClosedEvent":
            return <>closed this</>;
        case "ReopenedEvent":
            return <>reopened this</>;
        case "MergedEvent":
            return (
                <>
                    merged commit <code>{event.mergeCommit?.abbreviatedOid ?? "?"}</code> into{" "}
                    <code>{event.mergeRefName}</code>
                </>
            );
    }
}

function Item({ item, prUrl }: { item: ConversationItem; prUrl: string }) {
    switch (item.kind) {
        case "comment":
            return (
                <Card
                    header={
                        <>
                            <Who actor={item.comment.author} /> commented{" "}
                            <When at={item.comment.createdAt} href={item.comment.url} />
                        </>
                    }
                    html={item.comment.bodyHTML}
                />
            );
        case "review":
            return <Review review={item.review} threads={item.threads} />;
        case "commits":
            return <Commits commits={item.commits} prUrl={prUrl} />;
        case "event":
            return (
                <div className="timeline-event">
                    <Who actor={item.event.actor} /> {eventText(item.event)} <When at={item.event.createdAt} />
                </div>
            );
        case "threads":
            return (
                <div className="timeline-review">
                    <div className="timeline-event">Other review threads</div>
                    {item.threads.map((thread) => (
                        <Thread key={thread.id} thread={thread} />
                    ))}
                </div>
            );
    }
}

function itemKey(item: ConversationItem): string {
    switch (item.kind) {
        case "comment":
            return item.comment.id;
        case "review":
            return item.review.id;
        case "commits":
            return item.id;
        case "event":
            return item.event.id;
        case "threads":
            return "threads";
    }
}

/** The description, then everything that happened on the PR, as on GitHub's Conversation tab. */
export function ConversationTab() {
    const { detail } = useOpenPr();
    const { pr, timeline, threads, complete } = detail;
    const items = useMemo(() => buildConversation(timeline, threads), [timeline, threads]);
    return (
        <div className="conversation">
            <Card
                header={
                    <>
                        <Who actor={pr.author} /> opened this <When at={pr.createdAt} />
                    </>
                }
                html={pr.bodyHTML}
                empty="No description provided."
            />
            {items.map((item) => (
                <Item key={itemKey(item)} item={item} prUrl={pr.url} />
            ))}
            {!complete && (
                <div className="timeline-note">
                    This conversation is longer than the page reads;{" "}
                    <External href={pr.url}>the rest is on GitHub</External>.
                </div>
            )}
            <MergeBox />
        </div>
    );
}

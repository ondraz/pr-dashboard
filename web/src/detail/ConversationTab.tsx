import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { ReviewThread } from "../github/pullRequest.ts";
import { CommitIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import {
    buildConversation,
    type CommitNode,
    type ConversationItem,
    type EventNode,
    type ReviewNode,
} from "../logic/conversation.ts";
import { labelColor } from "../logic/labels.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { CommentBody } from "./CommentBody.tsx";
import { Markdown } from "./Markdown.tsx";
import { MergeBox } from "./MergeBox.tsx";
import { PrComment } from "./PrComment.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { Reactions } from "./Reactions.tsx";
import { Thread, When, Who } from "./Thread.tsx";

function Card({ header, children }: { header: ReactNode; children: ReactNode }) {
    return (
        <div className="timeline-card">
            <div className="timeline-card-header">{header}</div>
            <div className="timeline-card-body">{children}</div>
        </div>
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
                        <CommentBody kind="review" comment={review} />
                    </div>
                </div>
            )}
            {threads.map((thread) => (
                <Thread key={thread.id} thread={thread} />
            ))}
        </div>
    );
}

function Commits({ commits, route }: { commits: CommitNode["commit"][]; route: PrRoute }) {
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
                        <Link
                            className="sha"
                            to="/$owner/$repo/pull/$number/commits/$sha"
                            params={{ ...route, sha: commit.oid }}
                        >
                            {commit.abbreviatedOid}
                        </Link>
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

function Item({ item, route }: { item: ConversationItem; route: PrRoute }) {
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
                >
                    <CommentBody kind="issue" comment={item.comment} />
                </Card>
            );
        case "review":
            return <Review review={item.review} threads={item.threads} />;
        case "commits":
            return <Commits commits={item.commits} route={route} />;
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
    const { route, detail } = useOpenPr();
    const { pr, timeline, threads, complete } = detail;
    const items = useMemo(() => buildConversation(timeline, threads), [timeline, threads]);
    const { canWrite } = useWriteAccess(route);
    return (
        <div className="conversation">
            <Card
                header={
                    <>
                        <Who actor={pr.author} /> opened this <When at={pr.createdAt} />
                    </>
                }
            >
                {pr.bodyHTML.trim() ? (
                    <Markdown html={pr.bodyHTML} />
                ) : (
                    <p className="muted">No description provided.</p>
                )}
                <Reactions subjectId={pr.id} groups={pr.reactionGroups} canReact={pr.viewerCanReact} />
            </Card>
            {items.map((item) => (
                <Item key={itemKey(item)} item={item} route={route} />
            ))}
            {!complete && (
                <div className="timeline-note">
                    This conversation is longer than the page reads;{" "}
                    <External href={pr.url}>the rest is on GitHub</External>.
                </div>
            )}
            <MergeBox />
            {canWrite && <PrComment />}
        </div>
    );
}

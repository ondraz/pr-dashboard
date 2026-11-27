import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useKeys } from "../app/keys.ts";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { ReviewThread } from "../github/pullRequest.ts";
import { CommitIcon } from "../list/icons.tsx";
import { External } from "../list/PrRows.tsx";
import {
    buildConversation,
    type CommitNode,
    type ConversationItem,
    type EventNode,
    itemMoments,
    type ReviewNode,
    unresolvedOnly,
} from "../logic/conversation.ts";
import { labelColor } from "../logic/labels.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { timeAgo } from "../logic/time.ts";
import { prUnresolvedSummary } from "../logic/unresolved.ts";
import { CommentBody } from "./CommentBody.tsx";
import { MergeBox } from "./MergeBox.tsx";
import { NewTag, useIsNew } from "./NewTag.tsx";
import { PrComment } from "./PrComment.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { stepThread, Thread, When, Who } from "./Thread.tsx";

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
                <NewTag at={at} author={review.author?.login} />
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
                        <NewTag at={commit.committedDate} author={commit.author?.user?.login} />
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
                            <NewTag at={item.comment.createdAt} author={item.comment.author?.login} />
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
                    <NewTag at={item.event.createdAt} author={item.event.actor?.login} />
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

type Shown = "all" | "unresolved";

/** How much is new since the reader last had the PR open, and a way to get to the first of it. */
function NewSince({ items }: { items: readonly ConversationItem[] }) {
    const { lastOpened } = useOpenPr();
    const isNew = useIsNew();
    const count = items.flatMap(itemMoments).filter((moment) => isNew(moment.at, moment.author)).length;
    if (!lastOpened || !count) return null;
    return (
        <div className="timeline-note new-since">
            {count} new {count === 1 ? "entry" : "entries"} since you last opened this pull request{" "}
            {timeAgo(lastOpened.at)}, marked New.{" "}
            <button
                type="button"
                className="link-btn"
                onClick={() => document.querySelector(".conversation .new-tag")?.scrollIntoView({ block: "center" })}
            >
                Go to the first
            </button>
        </div>
    );
}

/** The description, then everything that happened on the PR, as on GitHub's Conversation tab. */
export function ConversationTab() {
    const { route, detail } = useOpenPr();
    const { pr, timeline, threads, complete } = detail;
    const items = useMemo(() => buildConversation(timeline, threads), [timeline, threads]);
    const summary = useMemo(() => prUnresolvedSummary(threads, pr.reviews?.nodes ?? []), [threads, pr.reviews]);
    const [shown, setShown] = useState<Shown>("all");
    const visible = useMemo(
        () => (shown === "all" ? items : unresolvedOnly(items, summary.copilotVerdict?.id ?? null)),
        [shown, items, summary.copilotVerdict],
    );
    const { canWrite } = useWriteAccess(route);
    useKeys({
        n: () => stepThread(".conversation", 1),
        p: () => stepThread(".conversation", -1),
        c: () => {
            const box = document.querySelector<HTMLTextAreaElement>(".pr-comment textarea");
            if (!box) return false;
            box.scrollIntoView({ block: "center" });
            box.focus();
        },
    });
    return (
        <div className="conversation">
            <Card
                header={
                    <>
                        <Who actor={pr.author} /> opened this <When at={pr.createdAt} />
                    </>
                }
            >
                <CommentBody
                    kind="description"
                    emptyText="No description provided."
                    comment={{
                        id: pr.id,
                        body: pr.body,
                        bodyHTML: pr.bodyHTML,
                        viewerCanUpdate: pr.viewerCanUpdate,
                        viewerCanReact: pr.viewerCanReact,
                        reactionGroups: pr.reactionGroups,
                    }}
                />
            </Card>
            <div className="conversation-bar">
                <fieldset className="segmented" aria-label="Show in the conversation">
                    <button
                        type="button"
                        className="step-btn"
                        aria-pressed={shown === "all"}
                        onClick={() => setShown("all")}
                    >
                        Everything
                    </button>
                    <button
                        type="button"
                        className="step-btn"
                        aria-pressed={shown === "unresolved"}
                        onClick={() => setShown("unresolved")}
                    >
                        Unresolved <span className="tab-count">{summary.unresolved}</span>
                    </button>
                </fieldset>
            </div>
            <NewSince items={visible} />
            {visible.map((item) => (
                <Item key={itemKey(item)} item={item} route={route} />
            ))}
            {shown === "unresolved" && !visible.length && <div className="empty">Nothing is unresolved.</div>}
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

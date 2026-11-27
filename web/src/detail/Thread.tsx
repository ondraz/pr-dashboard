import { stepTo } from "../app/keys.ts";
import type { ReviewThread } from "../github/pullRequest.ts";
import { External } from "../list/PrRows.tsx";
import { hunkTail, isPendingThread } from "../logic/conversation.ts";
import { timeAgo } from "../logic/time.ts";
import { CommentBody } from "./CommentBody.tsx";
import { NewTag } from "./NewTag.tsx";
import { SuggestionActions } from "./Suggestions.tsx";
import { ThreadActions } from "./ThreadActions.tsx";

interface Actor {
    login: string;
    avatarUrl?: string;
    url?: string;
}

export function Who({ actor }: { actor: Actor | null | undefined }) {
    const login = actor?.login ?? "ghost";
    return (
        <span className="who">
            {actor?.avatarUrl && <img className="avatar" src={actor.avatarUrl} alt="" width={20} height={20} />}
            <External href={actor?.url ?? `https://github.com/${login}`}>{login}</External>
        </span>
    );
}

export function When({ at, href }: { at: string; href?: string }) {
    const text = timeAgo(at);
    return (
        <time className="when" dateTime={at} title={new Date(at).toLocaleString()}>
            {href ? <External href={href}>{text}</External> : text}
        </time>
    );
}

/** Scrolls to the next or previous unresolved thread inside `scope` and puts the focus on it; false at either end. */
export function stepThread(scope: string, direction: 1 | -1): boolean {
    const target = stepTo(Array.from(document.querySelectorAll(`${scope} .thread:not(.resolved)`)), direction);
    target?.querySelector("summary")?.focus({ preventScroll: true });
    return !!target;
}

/** A review thread: where it is, the diff it was left on unless it sits in a diff already, and every comment. */
export function Thread({ thread, inDiff = false }: { thread: ReviewThread; inDiff?: boolean }) {
    const comments = (thread.comments.nodes ?? []).filter((comment) => !!comment);
    const first = comments[0];
    const line = thread.line ?? thread.originalLine;
    const start = thread.startLine ?? thread.originalStartLine;
    const where =
        thread.subjectType === "FILE" ? "" : line ? `:${start && start !== line ? `${start}-` : ""}${line}` : "";
    return (
        <details className={`thread${thread.isResolved ? " resolved" : ""}`} open={!thread.isResolved}>
            <summary>
                <code>
                    {thread.path}
                    {where}
                </code>
                {isPendingThread(thread) && <span className="thread-tag pending">Pending</span>}
                {thread.isOutdated && <span className="thread-tag">Outdated</span>}
                {thread.isResolved && <span className="thread-tag">Resolved</span>}
            </summary>
            {!inDiff && first?.diffHunk && thread.subjectType !== "FILE" && (
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
                        <NewTag at={comment.createdAt} author={comment.author?.login} />
                        {comment.state === "PENDING" && comment !== first && (
                            <span className="thread-tag pending">Pending</span>
                        )}
                    </div>
                    <CommentBody kind="review-comment" comment={comment} />
                    <SuggestionActions commentId={comment.id} />
                </div>
            ))}
            <ThreadActions thread={thread} />
        </details>
    );
}

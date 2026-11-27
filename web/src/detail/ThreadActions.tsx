import { useDraft } from "../app/drafts.ts";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { ReviewThread } from "../github/pullRequest.ts";
import { replyToThread, setThreadResolved } from "../github/review.ts";
import { draftPrefix } from "../logic/drafts.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite, useReviewSubject } from "./useWrite.ts";

/**
 * A reply to a thread, which goes into the pending review like a new comment on the diff, unless the reader
 * explicitly posts it on its own; and resolving or unresolving the thread.
 */
export function ThreadActions({ thread }: { thread: ReviewThread }) {
    const { route } = useOpenPr();
    const { canWrite } = useWriteAccess(route);
    const subject = useReviewSubject();
    const [text, setText, clear] = useDraft(`${draftPrefix(route)}reply:${thread.id}`);
    const body = text ?? "";
    const toReview = usePrWrite((client, value: string) =>
        replyToThread(client, subject, thread.id, value, { single: false }),
    );
    const single = usePrWrite((client, value: string) =>
        replyToThread(client, subject, thread.id, value, { single: true }),
    );
    const resolve = usePrWrite((client, resolved: boolean) => setThreadResolved(client, thread.id, resolved));
    if (!canWrite) return null;
    const busy = toReview.isPending || single.isPending;
    const error = toReview.error ?? single.error ?? resolve.error;
    const send = (write: typeof toReview) => write.mutate(body, { onSuccess: clear });
    const canResolve = thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve;

    return (
        <div className="thread-actions">
            {thread.viewerCanReply && text !== null && (
                <form
                    className="thread-reply"
                    aria-label="Reply"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (body.trim() && !busy) send(toReview);
                    }}
                >
                    <MarkdownEditor
                        route={route}
                        label="Reply"
                        value={body}
                        onChange={setText}
                        placeholder="Reply..."
                        autoFocus
                    />
                    <div className="composer-actions">
                        <button type="button" className="step-btn" onClick={clear} disabled={busy}>
                            Cancel
                        </button>
                        {!subject.pendingReviewId && (
                            <button
                                type="button"
                                className="step-btn"
                                disabled={!body.trim() || busy}
                                onClick={() => send(single)}
                            >
                                Add single comment
                            </button>
                        )}
                        <button type="submit" className="primary-btn" disabled={!body.trim() || busy}>
                            {subject.pendingReviewId ? "Add review comment" : "Start a review"}
                        </button>
                    </div>
                </form>
            )}
            {error && <p className="error-text">{error.message}</p>}
            <div className="thread-buttons">
                {thread.viewerCanReply && text === null && (
                    <button type="button" className="reply-btn" onClick={() => setText("")}>
                        Reply...
                    </button>
                )}
                {canResolve && (
                    <button
                        type="button"
                        className="step-btn"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate(!thread.isResolved)}
                    >
                        {thread.isResolved ? "Unresolve conversation" : "Resolve conversation"}
                    </button>
                )}
            </div>
        </div>
    );
}

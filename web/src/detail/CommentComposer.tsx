import { drafts, useDraft } from "../app/drafts.ts";
import { addReviewComment, addSingleComment } from "../github/review.ts";
import { draftPrefix, targetSlot } from "../logic/drafts.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { type CommentTarget, type PatchLines, rangeStarts, suggestionBlock, targetLabel } from "../logic/review.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite, useReviewSubject } from "./useWrite.ts";

/** Where a draft comment on the diff is kept, which is also what keeps its box open. */
export function targetDraftKey(route: PrRoute, target: CommentTarget): string {
    return draftPrefix(route) + targetSlot(target);
}

/** Moves the draft to a range starting at another line, keeping its text. */
function moveDraft(from: string, to: string, text: string) {
    if (from === to) return;
    drafts.write(to, text);
    drafts.write(from, null);
}

/**
 * A new comment on a line, a range of lines, or a whole file. It goes into the pending review unless the
 * reader explicitly posts it on its own, and no review is pending to hold it.
 */
export function CommentComposer({ target, lines }: { target: CommentTarget; lines: PatchLines | null }) {
    const { route } = useOpenPr();
    const subject = useReviewSubject();
    const key = targetDraftKey(route, target);
    const [text, setText, clear] = useDraft(key);
    const body = text ?? "";
    const toReview = usePrWrite((client, value: string) => addReviewComment(client, subject, target, value));
    const single = usePrWrite((client, value: string) => addSingleComment(client, subject, target, value));
    const busy = toReview.isPending || single.isPending;
    const error = toReview.error ?? single.error;
    const send = (write: typeof toReview) => write.mutate(body, { onSuccess: clear });
    const starts = target.subject === "line" && lines ? rangeStarts(lines, target.side, target.line) : [];

    return (
        <form
            className="comment-composer"
            aria-label={`Comment on ${targetLabel(target)}`}
            onSubmit={(event) => {
                event.preventDefault();
                if (body.trim() && !busy) send(toReview);
            }}
        >
            {target.subject === "line" && starts.length > 0 && (
                <label className="composer-range">
                    Comment on lines from
                    <select
                        value={target.startLine ?? target.line}
                        onChange={(event) => {
                            const start = Number(event.target.value);
                            const moved: CommentTarget = {
                                ...target,
                                startLine: start === target.line ? null : start,
                            };
                            moveDraft(key, targetDraftKey(route, moved), body);
                        }}
                    >
                        {[...starts, target.line].map((line) => (
                            <option key={line} value={line}>
                                {line}
                            </option>
                        ))}
                    </select>
                    to {target.line}
                </label>
            )}
            <MarkdownEditor
                route={route}
                label={`Comment on ${targetLabel(target)}`}
                value={body}
                onChange={setText}
                placeholder="Leave a comment"
                suggestion={lines ? suggestionBlock(lines, target) : null}
                autoFocus
            />
            {error && <p className="error-text">{error.message}</p>}
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
    );
}

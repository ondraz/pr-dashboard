import { useState } from "react";
import { useDraft } from "../app/drafts.ts";
import { discardReview, submitReview } from "../github/review.ts";
import { draftPrefix, REVIEW_SLOT } from "../logic/drafts.ts";
import { type ReviewEvent, submitBlocker } from "../logic/review.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite, useReviewSubject } from "./useWrite.ts";

const EVENTS: readonly { event: ReviewEvent; label: string; hint: string }[] = [
    { event: "COMMENT", label: "Comment", hint: "Feedback without approving or asking for changes." },
    { event: "APPROVE", label: "Approve", hint: "These changes can merge." },
    { event: "REQUEST_CHANGES", label: "Request changes", hint: "These changes have to be addressed before merging." },
];

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The pending review's summary, its verdict, and sending or discarding it, as GitHub's Submit review dialog. */
export function ReviewPanel({ onDone }: { onDone: () => void }) {
    const { route, detail } = useOpenPr();
    const subject = useReviewSubject();
    const pending = detail.pr.pendingReview?.nodes?.[0]?.comments.totalCount ?? 0;
    const [text, setText, clear] = useDraft(draftPrefix(route) + REVIEW_SLOT);
    const body = text ?? "";
    const [event, setEvent] = useState<ReviewEvent>("COMMENT");
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const submit = usePrWrite((client, args: { event: ReviewEvent; body: string }) =>
        submitReview(client, subject, args.event, args.body),
    );
    const discard = usePrWrite((client, id: string) => discardReview(client, id));
    const blocker = submitBlocker(event, { body, pendingComments: pending, ownPr: detail.pr.viewerDidAuthor });
    const busy = submit.isPending || discard.isPending;
    const error = submit.error ?? discard.error;
    const done = () => {
        clear();
        onDone();
    };

    return (
        <form
            className="review-panel"
            aria-label="Submit review"
            onSubmit={(formEvent) => {
                formEvent.preventDefault();
                if (!blocker && !busy) submit.mutate({ event, body }, { onSuccess: done });
            }}
        >
            <h2>Finish your review</h2>
            <MarkdownEditor
                route={route}
                label="Review summary"
                value={body}
                onChange={setText}
                placeholder="Leave a comment"
                autoFocus
            />
            <fieldset className="review-events">
                <legend>Review</legend>
                {EVENTS.map((choice) => {
                    const refused = detail.pr.viewerDidAuthor && choice.event !== "COMMENT";
                    return (
                        <label key={choice.event} className={refused ? "muted" : undefined}>
                            <input
                                type="radio"
                                name="review-event"
                                value={choice.event}
                                checked={event === choice.event}
                                disabled={refused}
                                onChange={() => setEvent(choice.event)}
                            />
                            <span className="review-event-label">{choice.label}</span>
                            <span className="review-event-hint">
                                {refused ? "Not on your own pull request." : choice.hint}
                            </span>
                        </label>
                    );
                })}
            </fieldset>
            {error && <p className="error-text">{error.message}</p>}
            <div className="composer-actions">
                {subject.pendingReviewId &&
                    (confirmDiscard ? (
                        <>
                            <span className="muted">
                                Discard the review and its {plural(pending, "pending comment")}?
                            </span>
                            <button type="button" className="step-btn" onClick={() => setConfirmDiscard(false)}>
                                Keep it
                            </button>
                            <button
                                type="button"
                                className="danger-btn"
                                disabled={busy}
                                onClick={() => {
                                    const id = subject.pendingReviewId;
                                    if (id) discard.mutate(id, { onSuccess: done });
                                }}
                            >
                                Discard review
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="step-btn"
                            disabled={busy}
                            onClick={() => setConfirmDiscard(true)}
                        >
                            Discard review
                        </button>
                    ))}
                {blocker && <span className="muted">{blocker}</span>}
                <button type="submit" className="primary-btn" disabled={!!blocker || busy}>
                    Submit review
                </button>
            </div>
        </form>
    );
}

/** The button that opens the Submit review form, counting the comments waiting in the pending review. */
export function ReviewButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    const pending = useOpenPr().detail.pr.pendingReview?.nodes?.[0]?.comments.totalCount ?? 0;
    return (
        <button type="button" className="primary-btn review-btn" aria-expanded={open} onClick={onToggle}>
            {pending ? `Finish your review (${pending})` : "Review changes"}
        </button>
    );
}

import { useDraft } from "../app/drafts.ts";
import { setClosed } from "../github/manage.ts";
import { addPrComment } from "../github/review.ts";
import { draftPrefix, PR_COMMENT_SLOT } from "../logic/drafts.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite } from "./useWrite.ts";

/**
 * A comment on the PR itself, at the foot of its conversation; it posts when the reader presses Comment. Closing
 * and reopening sit beside it, as on GitHub, and post the comment first when there is one.
 */
export function PrComment() {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const [text, setText, clear] = useDraft(draftPrefix(route) + PR_COMMENT_SLOT);
    const body = text ?? "";
    const comment = usePrWrite((client, value: string) => addPrComment(client, pr.id, value));
    const toggle = usePrWrite(async (client, { close, value }: { close: boolean; value: string }) => {
        if (value.trim()) {
            await addPrComment(client, pr.id, value);
            clear();
        }
        await setClosed(client, pr.id, close);
    });
    const busy = comment.isPending || toggle.isPending;
    const error = comment.error ?? toggle.error;
    const close = pr.state === "OPEN" && pr.viewerCanClose;
    const reopen = pr.state === "CLOSED" && pr.viewerCanReopen;
    return (
        <form
            className="pr-comment"
            aria-label="Add a comment"
            onSubmit={(event) => {
                event.preventDefault();
                if (body.trim() && !busy) comment.mutate(body, { onSuccess: clear });
            }}
        >
            <MarkdownEditor
                route={route}
                label="Add a comment"
                value={body}
                onChange={setText}
                placeholder="Add your comment here..."
            />
            {error && <p className="error-text">{error.message}</p>}
            <div className="composer-actions">
                {(close || reopen) && (
                    <button
                        type="button"
                        className="step-btn"
                        disabled={busy}
                        onClick={() => toggle.mutate({ close, value: body }, { onSuccess: clear })}
                    >
                        {close
                            ? body.trim()
                                ? "Close with comment"
                                : "Close pull request"
                            : body.trim()
                              ? "Reopen with comment"
                              : "Reopen pull request"}
                    </button>
                )}
                <button type="submit" className="primary-btn" disabled={!body.trim() || busy}>
                    Comment
                </button>
            </div>
        </form>
    );
}

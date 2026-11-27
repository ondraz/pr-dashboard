import { useDraft } from "../app/drafts.ts";
import { addPrComment } from "../github/review.ts";
import { draftPrefix, PR_COMMENT_SLOT } from "../logic/drafts.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite } from "./useWrite.ts";

/** A comment on the PR itself, at the foot of its conversation; it posts when the reader presses Comment. */
export function PrComment() {
    const { route, detail } = useOpenPr();
    const [text, setText, clear] = useDraft(draftPrefix(route) + PR_COMMENT_SLOT);
    const body = text ?? "";
    const comment = usePrWrite((client, value: string) => addPrComment(client, detail.pr.id, value));
    return (
        <form
            className="pr-comment"
            aria-label="Add a comment"
            onSubmit={(event) => {
                event.preventDefault();
                if (body.trim() && !comment.isPending) comment.mutate(body, { onSuccess: clear });
            }}
        >
            <MarkdownEditor
                route={route}
                label="Add a comment"
                value={body}
                onChange={setText}
                placeholder="Add your comment here..."
            />
            {comment.error && <p className="error-text">{comment.error.message}</p>}
            <div className="composer-actions">
                <button type="submit" className="primary-btn" disabled={!body.trim() || comment.isPending}>
                    Comment
                </button>
            </div>
        </form>
    );
}

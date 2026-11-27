import { useState } from "react";
import { useDraft } from "../app/drafts.ts";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { ReactionGroupFieldsFragment } from "../github/gql/graphql.ts";
import { type CommentKind, deleteComment, editComment } from "../github/review.ts";
import { draftPrefix } from "../logic/drafts.ts";
import { Markdown } from "./Markdown.tsx";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { useOpenPr } from "./PrContext.tsx";
import { Reactions } from "./Reactions.tsx";
import { usePrWrite } from "./useWrite.ts";

export interface EditableComment {
    id: string;
    body: string;
    bodyHTML: string;
    viewerCanUpdate: boolean;
    /** A review's summary and the description cannot be deleted. */
    viewerCanDelete?: boolean;
    viewerCanReact: boolean;
    reactionGroups: readonly ReactionGroupFieldsFragment[] | null;
}

/**
 * A comment's text with its reactions, and, on the reader's own comments, Edit and Delete. An edit in progress
 * is a draft like any other, so it survives a refresh.
 */
export function CommentBody({
    kind,
    comment,
    emptyText,
}: {
    kind: CommentKind;
    comment: EditableComment;
    /** Said in place of an empty body. */
    emptyText?: string;
}) {
    const { route } = useOpenPr();
    const { canWrite } = useWriteAccess(route);
    const [text, setText, clear] = useDraft(`${draftPrefix(route)}edit:${comment.id}`);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const save = usePrWrite((client, body: string) => editComment(client, kind, comment.id, body));
    const deletable = kind === "review" || kind === "description" ? null : kind;
    const remove = usePrWrite((client) => {
        if (!deletable) throw new Error("This text cannot be deleted, only edited");
        return deleteComment(client, deletable, comment.id);
    });
    const canEdit = canWrite && comment.viewerCanUpdate;
    const canDelete = canWrite && !!deletable && !!comment.viewerCanDelete;

    if (text !== null && canEdit) {
        return (
            <form
                className="comment-edit"
                aria-label="Edit comment"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!save.isPending) save.mutate(text, { onSuccess: clear });
                }}
            >
                <MarkdownEditor route={route} label="Edit comment" value={text} onChange={setText} autoFocus />
                {save.error && <p className="error-text">{save.error.message}</p>}
                <div className="composer-actions">
                    <button type="button" className="step-btn" onClick={clear} disabled={save.isPending}>
                        Cancel
                    </button>
                    <button type="submit" className="primary-btn" disabled={save.isPending}>
                        Update comment
                    </button>
                </div>
            </form>
        );
    }

    return (
        <>
            {comment.bodyHTML.trim() ? (
                <Markdown html={comment.bodyHTML} />
            ) : (
                emptyText && <p className="muted">{emptyText}</p>
            )}
            <div className="comment-footer">
                <Reactions subjectId={comment.id} groups={comment.reactionGroups} canReact={comment.viewerCanReact} />
                {(canEdit || canDelete) && (
                    <span className="comment-actions">
                        {confirmDelete ? (
                            <>
                                <span className="muted">Delete this comment?</span>
                                <button type="button" className="link-btn" onClick={() => setConfirmDelete(false)}>
                                    Keep it
                                </button>
                                <button
                                    type="button"
                                    className="link-btn danger-link"
                                    disabled={remove.isPending}
                                    onClick={() => remove.mutate(undefined)}
                                >
                                    Delete
                                </button>
                            </>
                        ) : (
                            <>
                                {canEdit && (
                                    <button type="button" className="link-btn" onClick={() => setText(comment.body)}>
                                        Edit
                                    </button>
                                )}
                                {canDelete && (
                                    <button type="button" className="link-btn" onClick={() => setConfirmDelete(true)}>
                                        Delete
                                    </button>
                                )}
                            </>
                        )}
                    </span>
                )}
                {remove.error && <span className="error-text">{remove.error.message}</span>}
            </div>
        </>
    );
}

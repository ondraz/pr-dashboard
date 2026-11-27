import { useMemo, useState } from "react";
import { useDraft } from "../app/drafts.ts";
import { useWriteAccess } from "../app/writeAccess.tsx";
import { commitSuggestions } from "../github/suggestions.ts";
import { draftPrefix, SUGGESTIONS_SLOT } from "../logic/drafts.ts";
import { type Suggestion, suggestionHeadline, suggestionOf } from "../logic/suggestions.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite } from "./useWrite.ts";

/** Every suggestion in the PR's threads that can be committed now, by the id of the comment that makes it. */
function useCommittable(): ReadonlyMap<string, Suggestion> {
    const { route, detail } = useOpenPr();
    const { canWrite } = useWriteAccess(route);
    const { pr, threads } = detail;
    const allowed = canWrite && pr.state === "OPEN" && pr.viewerCanEditFiles && !pr.isCrossRepository;
    return useMemo(() => {
        const found = new Map<string, Suggestion>();
        if (!allowed) return found;
        for (const thread of threads) {
            for (const comment of thread.comments.nodes ?? []) {
                if (!comment) continue;
                const suggestion = suggestionOf({
                    threadId: thread.id,
                    path: thread.path,
                    subjectType: thread.subjectType,
                    diffSide: thread.diffSide,
                    startDiffSide: thread.startDiffSide ?? null,
                    line: thread.line ?? null,
                    startLine: thread.startLine ?? null,
                    isOutdated: thread.isOutdated,
                    isResolved: thread.isResolved,
                    comment,
                });
                if (suggestion) found.set(comment.id, suggestion);
            }
        }
        return found;
    }, [allowed, threads]);
}

/**
 * The suggestions gathered to commit together, kept like a draft so a reload keeps the batch. One that can no
 * longer be committed (its thread resolved or outdated) drops out of it.
 */
function useBatch(committable: ReadonlyMap<string, Suggestion>) {
    const { route } = useOpenPr();
    const [stored, store, clear] = useDraft(draftPrefix(route) + SUGGESTIONS_SLOT);
    const ids = useMemo<string[]>(() => {
        try {
            const parsed: unknown = JSON.parse(stored ?? "[]");
            return Array.isArray(parsed)
                ? parsed.filter((id): id is string => typeof id === "string" && committable.has(id))
                : [];
        } catch {
            return [];
        }
    }, [stored, committable]);
    const save = (next: string[]) => (next.length ? store(JSON.stringify(next)) : clear());
    return {
        ids,
        add: (id: string) => save([...ids.filter((other) => other !== id), id]),
        remove: (id: string) => save(ids.filter((other) => other !== id)),
        clear,
    };
}

/** The commit's message, GitHub's default to edit, and committing the suggestions to the PR's branch. */
function CommitForm({
    suggestions,
    onCommitted,
    onCancel,
}: {
    suggestions: Suggestion[];
    onCommitted: () => void;
    onCancel: () => void;
}) {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const [headline, setHeadline] = useState(() => suggestionHeadline(suggestions));
    const [body, setBody] = useState("");
    const commit = usePrWrite((client, message: string) =>
        commitSuggestions(client, { route, headOid: pr.headRefOid, headRefName: pr.headRefName }, suggestions, message),
    );
    const label = suggestions.length === 1 ? "Commit suggestion" : `Commit ${suggestions.length} suggestions`;
    return (
        <form
            className="suggestion-commit"
            aria-label={label}
            onSubmit={(event) => {
                event.preventDefault();
                if (!headline.trim() || commit.isPending) return;
                const message = body.trim() ? `${headline.trim()}\n\n${body}` : headline.trim();
                commit.mutate(message, { onSuccess: onCommitted });
            }}
        >
            <input
                aria-label="Commit headline"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
            />
            <textarea
                aria-label="Extended description"
                placeholder="Add an optional extended description"
                rows={3}
                value={body}
                onChange={(event) => setBody(event.target.value)}
            />
            {commit.error && <p className="error-text">{commit.error.message}</p>}
            <div className="composer-actions">
                <button type="button" className="step-btn" onClick={onCancel} disabled={commit.isPending}>
                    Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={!headline.trim() || commit.isPending}>
                    Commit changes
                </button>
            </div>
        </form>
    );
}

/** Under a comment that suggests a change: commit it alone, or gather it into the batch. */
export function SuggestionActions({ commentId }: { commentId: string }) {
    const committable = useCommittable();
    const suggestion = committable.get(commentId);
    const batch = useBatch(committable);
    const [committing, setCommitting] = useState(false);
    if (!suggestion) return null;
    if (committing) {
        const done = () => setCommitting(false);
        return <CommitForm suggestions={[suggestion]} onCommitted={done} onCancel={done} />;
    }
    const batched = batch.ids.includes(commentId);
    return (
        <div className="suggestion-actions">
            {!batch.ids.length && (
                <button type="button" className="step-btn" onClick={() => setCommitting(true)}>
                    Commit suggestion
                </button>
            )}
            <button
                type="button"
                className="step-btn"
                onClick={() => (batched ? batch.remove(commentId) : batch.add(commentId))}
            >
                {batched ? "Remove from batch" : "Add suggestion to batch"}
            </button>
        </div>
    );
}

/** The batch, wherever the PR's page is: how many suggestions it holds, and committing them as one commit. */
export function SuggestionBatch() {
    const committable = useCommittable();
    const batch = useBatch(committable);
    const [committing, setCommitting] = useState(false);
    const suggestions = batch.ids.flatMap((id) => committable.get(id) ?? []);
    if (!suggestions.length) return null;
    const count = `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`;
    return (
        <section className="suggestion-batch" aria-label="Suggestion batch">
            {committing ? (
                <CommitForm
                    suggestions={suggestions}
                    onCancel={() => setCommitting(false)}
                    onCommitted={() => {
                        setCommitting(false);
                        batch.clear();
                    }}
                />
            ) : (
                <>
                    <span>{count} in a batch</span>
                    <button type="button" className="step-btn" onClick={batch.clear}>
                        Clear batch
                    </button>
                    <button type="button" className="primary-btn" onClick={() => setCommitting(true)}>
                        Commit suggestions
                    </button>
                </>
            )}
        </section>
    );
}

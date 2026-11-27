import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import type { GitHubClient } from "../github/client.ts";
import {
    addToMergeQueue,
    disableAutoMerge,
    enableAutoMerge,
    loadMergeText,
    type ManagedPr,
    type MergeMessage,
    mergePullRequest,
    removeFromMergeQueue,
    setDraft,
    updateBranch,
} from "../github/manage.ts";
import {
    confirmLabel,
    type LandAction,
    landLabel,
    type MergeMethod,
    mergeActions,
    takesMessage,
} from "../logic/mergeActions.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite } from "./useWrite.ts";

const METHOD_NAME: Record<MergeMethod, string> = {
    MERGE: "Create a merge commit",
    SQUASH: "Squash and merge",
    REBASE: "Rebase and merge",
};

interface Landing {
    land: LandAction;
    method: MergeMethod | null;
    message: MergeMessage | null;
}

function land(client: GitHubClient, pr: ManagedPr, { land, method, message }: Landing) {
    switch (land) {
        case "merge":
            return mergePullRequest(client, pr, method ?? "MERGE", message);
        case "auto-merge":
            return enableAutoMerge(client, pr, method ?? "MERGE", message);
        case "enqueue":
            return addToMergeQueue(client, pr);
        case "queue-when-ready":
            return enableAutoMerge(client, pr, null, null);
    }
}

/** The commit message GitHub would write, to edit before it lands; a rebase or the queue takes none. */
function ConfirmLanding({
    action,
    method,
    busy,
    error,
    onConfirm,
    onCancel,
}: {
    action: LandAction;
    method: MergeMethod | null;
    busy: boolean;
    error: Error | null;
    onConfirm: (message: MergeMessage | null) => void;
    onCancel: () => void;
}) {
    const { route } = useOpenPr();
    const { github } = useDashboardState();
    const withMessage = takesMessage(action, method);
    const text = useQuery({
        queryKey: ["merge-text", github?.id, route.owner, route.repo, route.number, method],
        enabled: !!github && withMessage && !!method,
        staleTime: Number.POSITIVE_INFINITY,
        queryFn: () => {
            if (!github || !method) throw new Error("Not signed in");
            return loadMergeText(github.client, route, method);
        },
    });
    const [edited, setEdited] = useState<MergeMessage | null>(null);
    const message = edited ?? text.data ?? null;
    const waiting = withMessage && !message;
    return (
        <form
            className="merge-confirm"
            aria-label={confirmLabel(action, method)}
            onSubmit={(event) => {
                event.preventDefault();
                if (!busy && !waiting) onConfirm(withMessage ? message : null);
            }}
        >
            {withMessage &&
                (message ? (
                    <>
                        <input
                            aria-label="Commit headline"
                            value={message.headline}
                            onChange={(event) => setEdited({ ...message, headline: event.target.value })}
                        />
                        <textarea
                            aria-label="Commit message"
                            rows={5}
                            value={message.body}
                            onChange={(event) => setEdited({ ...message, body: event.target.value })}
                        />
                    </>
                ) : text.error ? (
                    <p className="error-text">Could not read the commit message: {text.error.message}</p>
                ) : (
                    <p className="muted">Reading the commit message...</p>
                ))}
            {error && <p className="error-text">{error.message}</p>}
            <div className="composer-actions">
                <button type="button" className="step-btn" onClick={onCancel} disabled={busy}>
                    Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={busy || waiting}>
                    {confirmLabel(action, method)}
                </button>
            </div>
        </form>
    );
}

/**
 * Landing the PR (merge now, auto-merge, the merge queue), taking that back, updating its branch and moving it
 * in and out of draft. Landing always asks for a confirmation first; the rest can be undone and acts at once.
 */
export function MergeActions() {
    const { detail } = useOpenPr();
    const { pr } = detail;
    const actions = mergeActions({
        state: pr.state,
        isDraft: pr.isDraft,
        mergeStateStatus: pr.mergeStateStatus,
        viewerCanUpdate: pr.viewerCanUpdate,
        viewerCanUpdateBranch: pr.viewerCanUpdateBranch,
        viewerCanEnableAutoMerge: pr.viewerCanEnableAutoMerge,
        viewerCanDisableAutoMerge: pr.viewerCanDisableAutoMerge,
        isMergeQueueEnabled: pr.isMergeQueueEnabled,
        autoMergeEnabled: !!pr.autoMergeRequest,
        queued: !!pr.mergeQueueEntry,
        methods: {
            merge: pr.baseRepository?.mergeCommitAllowed ?? false,
            squash: pr.baseRepository?.squashMergeAllowed ?? false,
            rebase: pr.baseRepository?.rebaseMergeAllowed ?? false,
            preferred: pr.baseRepository?.viewerDefaultMergeMethod ?? "MERGE",
        },
    });
    const managed: ManagedPr = { pullRequestId: pr.id, headOid: pr.headRefOid };
    const [picked, setPicked] = useState<MergeMethod | null>(null);
    const method = picked && actions.methods.includes(picked) ? picked : (actions.methods[0] ?? null);
    // The head the viewer saw when they asked to land the PR; a push after that makes GitHub refuse the merge.
    const [confirming, setConfirming] = useState<string | null>(null);
    const [updateMethod, setUpdateMethod] = useState<"MERGE" | "REBASE">("MERGE");

    const landing = usePrWrite((client, args: Landing & { headOid: string }) =>
        land(client, { pullRequestId: pr.id, headOid: args.headOid }, args),
    );
    const cancel = usePrWrite((client) =>
        actions.cancel === "dequeue" ? removeFromMergeQueue(client, pr.id) : disableAutoMerge(client, pr.id),
    );
    const update = usePrWrite((client, how: "MERGE" | "REBASE") => updateBranch(client, managed, how));
    const draft = usePrWrite((client, toDraft: boolean) => setDraft(client, pr.id, toDraft));
    const error = cancel.error ?? update.error ?? draft.error ?? (confirming !== null ? null : landing.error);

    const { land: action } = actions;
    if (!action && !actions.cancel && !actions.updateBranch && !actions.readyForReview && !actions.convertToDraft) {
        return null;
    }
    return (
        <div className="merge-actions">
            {confirming !== null && action ? (
                <ConfirmLanding
                    action={action}
                    method={method}
                    busy={landing.isPending}
                    error={landing.error}
                    onCancel={() => setConfirming(null)}
                    onConfirm={(message) =>
                        landing.mutate(
                            { land: action, method, message, headOid: confirming },
                            { onSuccess: () => setConfirming(null) },
                        )
                    }
                />
            ) : (
                <div className="merge-buttons">
                    {actions.readyForReview && (
                        <button
                            type="button"
                            className="primary-btn"
                            disabled={draft.isPending}
                            onClick={() => draft.mutate(false)}
                        >
                            Ready for review
                        </button>
                    )}
                    {action && (
                        <span className="merge-land">
                            {actions.methods.length > 1 && (
                                <select
                                    aria-label="Merge method"
                                    value={method ?? undefined}
                                    onChange={(event) => setPicked(event.target.value as MergeMethod)}
                                >
                                    {actions.methods.map((choice) => (
                                        <option key={choice} value={choice}>
                                            {METHOD_NAME[choice]}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <button type="button" className="primary-btn" onClick={() => setConfirming(pr.headRefOid)}>
                                {landLabel(action, method)}
                            </button>
                        </span>
                    )}
                    {actions.cancel && (
                        <button
                            type="button"
                            className="step-btn"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(undefined)}
                        >
                            {actions.cancel === "dequeue" ? "Remove from queue" : "Disable auto-merge"}
                        </button>
                    )}
                    {actions.updateBranch && (
                        <span className="merge-update">
                            <select
                                aria-label="Update method"
                                value={updateMethod}
                                onChange={(event) => setUpdateMethod(event.target.value as "MERGE" | "REBASE")}
                            >
                                <option value="MERGE">Update with merge commit</option>
                                <option value="REBASE">Update with rebase</option>
                            </select>
                            <button
                                type="button"
                                className="step-btn"
                                disabled={update.isPending}
                                onClick={() => update.mutate(updateMethod)}
                            >
                                Update branch
                            </button>
                        </span>
                    )}
                    {actions.convertToDraft && (
                        <button
                            type="button"
                            className="link-btn merge-to-draft"
                            disabled={draft.isPending}
                            onClick={() => draft.mutate(true)}
                        >
                            Convert to draft
                        </button>
                    )}
                </div>
            )}
            {error && <p className="error-text">{error.message}</p>}
        </div>
    );
}

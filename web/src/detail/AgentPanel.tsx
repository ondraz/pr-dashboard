import { useMemo, useState } from "react";
import type { PrSession } from "../../../shared/sessions.ts";
import { SparkIcon } from "../list/icons.tsx";
import { fixPrompt, promptThreads, reviewPrompt } from "../logic/agentPrompt.ts";
import { newSessionLinks, type PromptLink, resumeLink } from "../logic/sessionLinks.ts";
import { prUnresolvedSummary } from "../logic/unresolved.ts";
import { usePrListContext } from "./listContext.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestChecks } from "./usePullRequest.ts";

export type AgentTask = "fix" | "review";

const TASK = {
    fix: { heading: "Fix with Claude", role: "made", who: "made this PR" },
    review: { heading: "Review with Claude", role: "reviewed", who: "reviewed this PR" },
} as const;

// The sessions a prompt can be handed to; older ones are on the sidebar.
const SESSIONS_SHOWN = 3;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The prompt for `task`, from the head commit's checks and the PR's unresolved threads. */
function usePrompt(task: AgentTask) {
    const { route, detail } = useOpenPr();
    const { pr, threads } = detail;
    const checks = usePullRequestChecks(route, pr.headRefOid);
    return useMemo(() => {
        if (!checks.data) return { prompt: null, error: checks.error, failing: 0, threads: 0 };
        const promptPr = {
            owner: route.owner,
            repo: route.repo,
            number: pr.number,
            url: pr.url,
            title: pr.title,
            baseRefName: pr.baseRefName,
            headRefName: pr.headRefName,
            headRefOid: pr.headRefOid,
        };
        const unresolved = promptThreads(threads);
        const verdict = prUnresolvedSummary(threads, pr.reviews?.nodes ?? []).copilotVerdict;
        const copilot = verdict && {
            ...verdict,
            url: verdict.databaseId ? `${pr.url}#pullrequestreview-${verdict.databaseId}` : pr.url,
        };
        const input = { pr: promptPr, checks: checks.data.checks, threads: unresolved, copilot };
        return {
            prompt:
                task === "fix"
                    ? fixPrompt(input)
                    : reviewPrompt({ ...input, lastReviewedOid: pr.viewerLatestReview?.commit?.oid ?? null }),
            error: null,
            failing: checks.data.checks.filter((check) => check.group === "failing").length,
            threads: unresolved.length + (copilot ? 1 : 0),
        };
    }, [task, route, pr, threads, checks.data, checks.error]);
}

/** A link that copies the prompt as it opens, since most of them cannot carry it. */
function PromptAnchor({
    link,
    label,
    title,
    onOpen,
}: {
    link: Pick<PromptLink, "href">;
    label: string;
    title?: string;
    onOpen: () => void;
}) {
    return (
        <a className="step-btn agent-link" href={link.href} title={title} onClick={onOpen}>
            <SparkIcon />
            {label}
        </a>
    );
}

function SessionTargets({
    sessions,
    task,
    prompt,
    onOpen,
}: {
    sessions: PrSession[];
    task: AgentTask;
    prompt: string;
    onOpen: () => void;
}) {
    const links = sessions.slice(0, SESSIONS_SHOWN).flatMap((session) => {
        const link = resumeLink(session, TASK[task].role, prompt);
        return link ? [{ session, link }] : [];
    });
    if (!links.length) return <p className="muted">No Claude session {TASK[task].who} that this computer knows of.</p>;
    return (
        <ul className="agent-sessions">
            {links.map(({ session, link }) => (
                <li key={session.id} className={link.archived ? "archived" : undefined}>
                    <PromptAnchor
                        link={link}
                        label={`${link.carriesPrompt ? "Open" : "Copy and open"} in ${link.app}`}
                        title={link.title}
                        onOpen={onOpen}
                    />
                    <span className="session-title">{session.title || "Untitled session"}</span>
                    {session.archived && <span className="session-meta">archived</span>}
                </li>
            ))}
        </ul>
    );
}

/**
 * Builds the prompt for a Claude session to fix or review the PR, copies it, and opens the session that
 * made or reviewed the PR, or starts a new one. Nothing reaches GitHub from here.
 */
export function AgentPanel({ task, onClose }: { task: AgentTask; onClose: () => void }) {
    const { pr } = useOpenPr().detail;
    const context = usePrListContext(pr.url);
    const { prompt, error, failing, threads } = usePrompt(task);
    const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
    const copy = () => {
        if (!prompt) return;
        navigator.clipboard.writeText(prompt).then(
            () => setCopied("copied"),
            () => setCopied("failed"),
        );
    };

    return (
        <section className="review-panel agent-panel" aria-label={TASK[task].heading}>
            <div className="agent-panel-head">
                <h2>{TASK[task].heading}</h2>
                <button type="button" className="step-btn" onClick={onClose}>
                    Close
                </button>
            </div>
            {error && !prompt ? (
                <p className="error-text">The checks could not be read: {error.message}</p>
            ) : !prompt ? (
                <p className="muted">Reading the checks...</p>
            ) : (
                <>
                    <p className="muted">
                        {plural(failing, "failing check")} and {plural(threads, "unresolved thread")} go into the
                        prompt.
                    </p>
                    <textarea className="agent-prompt" aria-label="Prompt" readOnly value={prompt} rows={10} />
                    <div className="agent-targets">
                        <div>
                            <h3>The session that {TASK[task].who}</h3>
                            <SessionTargets
                                sessions={context[TASK[task].role]}
                                task={task}
                                prompt={prompt}
                                onOpen={copy}
                            />
                        </div>
                        <div>
                            <h3>A new session</h3>
                            <div className="agent-new">
                                {newSessionLinks(prompt).map((link) => (
                                    <PromptAnchor
                                        key={link.app}
                                        link={link}
                                        label={`New session in ${link.app}`}
                                        onOpen={copy}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="composer-actions">
                        {copied === "copied" && <span className="muted">Prompt copied</span>}
                        {copied === "failed" && (
                            <span className="error-text">Could not copy; select the prompt and copy it.</span>
                        )}
                        <button type="button" className="primary-btn" onClick={copy}>
                            Copy prompt
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}

/** The buttons that open the panel for either task. */
export function AgentButtons({ open, onOpen }: { open: AgentTask | null; onOpen: (task: AgentTask | null) => void }) {
    return (
        <>
            {(["fix", "review"] as const).map((task) => (
                <button
                    key={task}
                    type="button"
                    className="step-btn agent-btn"
                    aria-expanded={open === task}
                    onClick={() => onOpen(open === task ? null : task)}
                >
                    <SparkIcon />
                    {TASK[task].heading}
                </button>
            ))}
        </>
    );
}

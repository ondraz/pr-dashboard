import { useMemo, useState } from "react";
import type { PrSession } from "../../../shared/sessions.ts";
import { SparkIcon } from "../list/icons.tsx";
import { fixPrompt, promptThreads, reviewPrompt } from "../logic/agentPrompt.ts";
import { newSessionLinks, type PromptLink, resumeLink } from "../logic/sessionLinks.ts";
import { timeAgo } from "../logic/time.ts";
import { prUnresolvedSummary } from "../logic/unresolved.ts";
import { type PrListContext, usePrListContext } from "./listContext.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestChecks } from "./usePullRequest.ts";

export type AgentTask = "fix" | "review";

const TASK = {
    fix: { heading: "Fix with Claude", role: "made", who: "made this PR" },
    review: { heading: "Review with Claude", role: "reviewed", who: "reviewed this PR" },
} as const;

// The sessions a prompt can be handed to: those that made or reviewed the PR, then others in its
// repository. Older ones are a search away in the app.
const OWN_SESSIONS_SHOWN = 3;
const REPO_SESSIONS_SHOWN = 5;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The prompt for `task`, from the head commit's checks and the PR's unresolved threads. */
function usePrompt(task: AgentTask) {
    const { route, detail } = useOpenPr();
    const { pr, threads } = detail;
    const checks = usePullRequestChecks(route, pr.headRefOid);
    return useMemo(() => {
        // A sign-in that cannot read the checks still gets a prompt, which leaves the checks to the session.
        if (!checks.data && !checks.error) return { prompt: null, error: null, failing: 0, threads: 0 };
        const read = checks.data?.checks ?? null;
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
        const input = { pr: promptPr, checks: read, threads: unresolved, copilot };
        return {
            prompt:
                task === "fix"
                    ? fixPrompt(input)
                    : reviewPrompt({ ...input, lastReviewedOid: pr.viewerLatestReview?.commit?.oid ?? null }),
            error: read ? null : checks.error,
            failing: read ? read.filter((check) => check.group === "failing").length : null,
            threads: unresolved.length + (copilot ? 1 : 0),
        };
    }, [task, route, pr, threads, checks.data, checks.error]);
}

/** A link that copies the prompt as it opens, in case the app leaves its box empty. */
function PromptAnchor({
    link,
    label,
    title,
    primary = false,
    onOpen,
}: {
    link: Pick<PromptLink, "href">;
    label: string;
    title?: string;
    primary?: boolean;
    onOpen: () => void;
}) {
    return (
        <a
            className={`${primary ? "primary-btn" : "step-btn"} agent-link`}
            href={link.href}
            title={title}
            onClick={onOpen}
        >
            <SparkIcon />
            {label}
        </a>
    );
}

interface Target {
    session: PrSession;
    link: NonNullable<ReturnType<typeof resumeLink>>;
    /** Why it is offered: it made or reviewed the PR, or it works in the PR's repository. */
    reason: string;
}

/** The sessions that made or reviewed the PR first, then the repository's other recent desktop sessions. */
function sessionTargets(task: AgentTask, context: PrListContext, prompt: string, repo: string): Target[] {
    const role = TASK[task].role;
    const targets: Target[] = [];
    const add = (session: PrSession, reason: string) => {
        if (targets.some((target) => target.session.id === session.id)) return;
        const link = resumeLink(session, role, prompt);
        if (link) targets.push({ session, link, reason });
    };
    for (const session of context[role].slice(0, OWN_SESSIONS_SHOWN)) add(session, TASK[task].who);
    for (const session of (context.repo?.sessions ?? []).slice(0, REPO_SESSIONS_SHOWN)) add(session, `in ${repo}`);
    return targets;
}

function SessionTargets({
    targets,
    repo,
    onOpen,
}: {
    targets: Target[];
    repo: string;
    /** `carried`: the link hands the session the prompt; otherwise it has to be pasted. */
    onOpen: (carried: boolean) => void;
}) {
    if (!targets.length) return <p className="muted">No Claude session on this computer has worked in {repo}.</p>;
    return (
        <ul className="agent-sessions">
            {targets.map(({ session, link, reason }) => {
                const title = session.title || "Untitled session";
                return (
                    <li key={session.id} className={link.archived ? "archived" : undefined}>
                        <span className="session-title" title={title}>
                            {title}
                        </span>
                        <span className="session-meta">
                            {[reason, timeAgo(session.lastActivityAt), link.app === "VS Code" ? "VS Code" : null]
                                .concat(session.archived ? ["archived"] : [])
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                        <a
                            className="step-btn agent-link"
                            href={link.href}
                            title={link.title}
                            aria-label={
                                link.carriesPrompt
                                    ? `Send to ${title} in ${link.app}`
                                    : `Copy the prompt and open ${title} in ${link.app}`
                            }
                            onClick={() => onOpen(link.carriesPrompt)}
                        >
                            {link.carriesPrompt ? "Send" : "Copy & open"}
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * Builds the prompt for a Claude session to fix or review the PR, copies it, and opens the session that
 * made or reviewed the PR, or starts a new one. Nothing reaches GitHub from here.
 */
export function AgentPanel({ task, onClose }: { task: AgentTask; onClose: () => void }) {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    const context = usePrListContext(pr.url);
    const repo = `${route.owner}/${route.repo}`;
    const folder = context.repo?.folder ?? null;
    const { prompt, error, failing, threads } = usePrompt(task);
    const [copied, setCopied] = useState<"copied" | "paste" | "failed" | null>(null);
    // `paste`: the session opens without the prompt, so the reader is told to paste it there.
    const copy = (paste = false) => {
        if (!prompt) return;
        navigator.clipboard.writeText(prompt).then(
            () => setCopied(paste ? "paste" : "copied"),
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
            {!prompt ? (
                <p className="muted">Reading the checks...</p>
            ) : (
                <>
                    <p className="muted">
                        {failing === null ? (
                            <>
                                The checks could not be read ({error?.message}), so the prompt asks the session to read
                                them; {plural(threads, "unresolved thread")} go into it.
                            </>
                        ) : (
                            <>
                                {plural(failing, "failing check")} and {plural(threads, "unresolved thread")} go into
                                the prompt.
                            </>
                        )}
                    </p>
                    <textarea className="agent-prompt" aria-label="Prompt" readOnly value={prompt} rows={10} />
                    <div className="agent-targets">
                        <div>
                            <h3>A new session</h3>
                            <div className="agent-new">
                                {newSessionLinks(prompt, folder).map((link) => (
                                    <PromptAnchor
                                        key={link.app}
                                        link={link}
                                        label={`New session in ${link.app}`}
                                        primary={link.app === "Claude"}
                                        title={
                                            link.app === "Claude"
                                                ? folder
                                                    ? `Starts a desktop session in ${folder}`
                                                    : "Starts a desktop session; the app asks for its folder"
                                                : "Starts a session in the open VS Code window"
                                        }
                                        onOpen={() => copy()}
                                    />
                                ))}
                            </div>
                            <p className="muted agent-folder">
                                {folder ? (
                                    <>
                                        The desktop session opens in <code title={folder}>{folder}</code>.
                                    </>
                                ) : (
                                    <>No checkout of {repo} is known here, so the desktop app asks for its folder.</>
                                )}
                            </p>
                        </div>
                        <div>
                            <h3>An existing session</h3>
                            <SessionTargets
                                targets={sessionTargets(task, context, prompt, repo)}
                                repo={repo}
                                onOpen={(carried) => copy(!carried)}
                            />
                        </div>
                    </div>
                    <p className="muted">
                        New sessions and VS Code sessions open with the prompt in their box. The desktop app opens an
                        existing session without it, so <strong>Copy &amp; open</strong> copies it for you to paste
                        there.
                    </p>
                    <div className="composer-actions">
                        {copied === "copied" && <span className="muted">Prompt copied</span>}
                        {copied === "paste" && (
                            <span className="agent-paste">
                                Prompt copied: paste it into the session's box and press Enter.
                            </span>
                        )}
                        {copied === "failed" && (
                            <span className="error-text">Could not copy; select the prompt and copy it.</span>
                        )}
                        <button type="button" className="primary-btn" onClick={() => copy()}>
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

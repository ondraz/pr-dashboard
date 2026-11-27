import type { CheckEntry } from "./checks.ts";
import type { CopilotVerdict } from "./copilot.ts";

/** What a prompt says about the PR itself. */
export interface PromptPr {
    owner: string;
    repo: string;
    number: number;
    url: string;
    title: string;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
}

/** An unresolved review thread, as a prompt quotes it. */
export interface PromptThread {
    path: string;
    line: number | null;
    startLine: number | null;
    outdated: boolean;
    url: string | null;
    comments: { author: string; body: string }[];
}

/** What a thread from the PR page has that a prompt quotes. */
interface ThreadLike {
    isResolved: boolean;
    isOutdated: boolean;
    path: string;
    line: number | null;
    originalLine: number | null;
    startLine: number | null;
    originalStartLine: number | null;
    comments: {
        nodes?:
            | readonly ({ body: string; url: string; state: string; author?: { login: string } | null } | null)[]
            | null;
    };
}

export interface FixInput {
    pr: PromptPr;
    /** Null when the sign-in could not read the checks; the session is told to read them itself. */
    checks: readonly CheckEntry[] | null;
    threads: readonly PromptThread[];
    copilot: (CopilotVerdict & { url: string }) | null;
}

export interface ReviewInput extends FixInput {
    /** The commit the viewer last reviewed, when they did. */
    lastReviewedOid: string | null;
}

// Enough of a long comment or check summary to say what it is about; the link has the rest.
const QUOTE_LIMIT = 1500;
const ANNOTATIONS_PER_CHECK = 20;

const clip = (text: string, limit = QUOTE_LIMIT) =>
    text.length > limit ? `${text.slice(0, limit).trimEnd()} [...]` : text;

const indent = (text: string, by: string) =>
    text
        .split("\n")
        .map((line, n) => (n === 0 ? line : `${by}${line}`.trimEnd()))
        .join("\n");

const short = (oid: string) => oid.slice(0, 7);

/** The unresolved threads a prompt quotes, in the order the page has them; a pending review's are the viewer's own. */
export function promptThreads(threads: readonly ThreadLike[]): PromptThread[] {
    return threads.flatMap((thread) => {
        const comments = (thread.comments.nodes ?? []).filter((comment) => !!comment);
        if (thread.isResolved || !comments.length || comments[0]?.state === "PENDING") return [];
        return [
            {
                path: thread.path,
                line: thread.line ?? thread.originalLine,
                startLine: thread.startLine ?? thread.originalStartLine,
                outdated: thread.isOutdated,
                url: comments[0]?.url ?? null,
                comments: comments
                    .filter((comment) => comment.state !== "PENDING")
                    .map((comment) => ({ author: comment.author?.login ?? "ghost", body: comment.body.trim() })),
            },
        ];
    });
}

function header(pr: PromptPr, verb: string): string[] {
    return [
        `${verb} pull request ${pr.owner}/${pr.repo}#${pr.number}, "${pr.title}": ${pr.url}`,
        `It merges \`${pr.headRefName}\` into \`${pr.baseRefName}\`; the head commit is ${short(pr.headRefOid)}.`,
    ];
}

function checkSection(pr: PromptPr, checks: readonly CheckEntry[] | null, detailed: boolean): string[] {
    if (!checks) {
        return [
            "",
            `The checks could not be read here; see them with \`gh pr checks ${pr.number} --repo ${pr.owner}/${pr.repo}\`.`,
        ];
    }
    const failing = checks.filter((check) => check.group === "failing");
    if (!failing.length) return [];
    const lines = ["", "Failing checks:"];
    for (const check of failing) {
        lines.push(`- ${check.name} (${check.label.toLowerCase()})${check.title ? `: ${check.title}` : ""}`);
        if (!detailed) continue;
        if (check.actionsJobId) {
            lines.push(`  Log: gh run view --job ${check.actionsJobId} --log-failed --repo ${pr.owner}/${pr.repo}`);
        } else if (check.detailsUrl) {
            lines.push(`  Details: ${check.detailsUrl}`);
        }
        if (check.summary) lines.push(`  Summary: ${indent(clip(check.summary), "    ")}`);
        const notes = check.annotations.filter((annotation) => annotation.level !== "notice");
        for (const annotation of notes.slice(0, ANNOTATIONS_PER_CHECK)) {
            const where =
                annotation.startLine === annotation.endLine
                    ? `${annotation.endLine}`
                    : `${annotation.startLine}-${annotation.endLine}`;
            const title = annotation.title ? `${annotation.title}: ` : "";
            lines.push(`  - ${annotation.path}:${where}: ${indent(clip(`${title}${annotation.message}`), "    ")}`);
        }
        if (notes.length > ANNOTATIONS_PER_CHECK) {
            lines.push(`  - and ${notes.length - ANNOTATIONS_PER_CHECK} more annotations`);
        }
    }
    return lines;
}

function threadSection(threads: readonly PromptThread[], copilot: FixInput["copilot"]): string[] {
    if (!threads.length && !copilot) return [];
    const lines = ["", "Unresolved review threads:"];
    for (const thread of threads) {
        const at =
            thread.line === null
                ? thread.path
                : `${thread.path}:${thread.startLine && thread.startLine !== thread.line ? `${thread.startLine}-` : ""}${thread.line}`;
        const notes = [thread.outdated ? "outdated" : null, thread.url].filter(Boolean).join(", ");
        lines.push(`- ${at}${notes ? ` (${notes})` : ""}`);
        for (const comment of thread.comments) {
            lines.push(`  ${comment.author}: ${indent(clip(comment.body), "    ")}`);
        }
    }
    if (copilot) {
        lines.push(
            `- Copilot's latest review asks for changes without inline comments: ${copilot.label} (${copilot.url})`,
        );
    }
    return lines;
}

/** Asks a session to make the PR's failing checks pass and to address its unresolved review threads. */
export function fixPrompt({ pr, checks, threads, copilot }: FixInput): string {
    const owed = threads.length > 0 || !!copilot;
    if (!checks) {
        return [
            ...header(pr, "Fix"),
            ...checkSection(pr, checks, true),
            ...threadSection(threads, copilot),
            "",
            owed
                ? "Make any failing checks pass and address the unresolved review threads."
                : "Make any failing checks pass.",
            `Work on the branch \`${pr.headRefName}\`, commit the fixes and push them to it. Where a review comment needs no change, say why instead of changing the code.`,
        ].join("\n");
    }
    const failing = checks.some((check) => check.group === "failing");
    const task =
        failing && owed
            ? "Make the failing checks pass and address the unresolved review threads."
            : failing
              ? "Make the failing checks pass."
              : owed
                ? "Address the unresolved review threads."
                : "No check is failing and no review thread is open; check that the branch is ready to merge.";
    return [
        ...header(pr, "Fix"),
        ...checkSection(pr, checks, true),
        ...threadSection(threads, copilot),
        "",
        task,
        `Work on the branch \`${pr.headRefName}\`, commit the fixes and push them to it. Where a review comment needs no change, say why instead of changing the code.`,
    ].join("\n");
}

/** Asks a session to review the PR, from where the viewer's last review left off when there was one. */
export function reviewPrompt({ pr, checks, threads, copilot, lastReviewedOid }: ReviewInput): string {
    const since =
        lastReviewedOid && lastReviewedOid !== pr.headRefOid
            ? [
                  "",
                  `The last review was at ${short(lastReviewedOid)}; start with what changed since: git diff ${short(lastReviewedOid)}..${short(pr.headRefOid)}`,
              ]
            : [];
    return [
        ...header(pr, "Review"),
        ...since,
        ...checkSection(pr, checks, false),
        ...threadSection(threads, copilot),
        "",
        `Read the change with \`gh pr diff ${pr.number} --repo ${pr.owner}/${pr.repo}\` and the code around it.${threads.length ? " Check whether each unresolved thread has been addressed." : ""}`,
        "Report correctness bugs, security problems and anything that breaks the repository's conventions, most important first, each with its file and line.",
    ].join("\n");
}

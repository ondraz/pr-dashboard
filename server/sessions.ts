import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { PrSession, SessionsPayload } from "../shared/sessions.ts";

export const DESKTOP_SESSIONS_DIR = join(homedir(), "Library/Application Support/Claude/claude-code-sessions");
export const CLI_PROJECTS_DIR = join(homedir(), ".claude/projects");

/** Commands and tools that publish a review or a comment on a PR. */
export const REVIEW_ACTION =
    /gh pr (review|comment)\b|gh api\b[^|;&]*\/(pulls\/\d+\/(reviews|comments)|issues\/\d+\/comments)|^mcp__github__\S*(review|comment)|^Skill code-review\b.*--comment/;

interface TranscriptScan {
    title: string;
    made: Set<string>;
    reviewed: Set<string>;
}

type JsonObject = Record<string, unknown>;

/**
 * Which Claude session made or reviewed each PR, from the desktop app's session records and the
 * CLI and VS Code transcripts. Each transcript is re-read only when its modification time changes.
 */
export class SessionIndex {
    readonly #desktopDir: string;
    readonly #projectsDir: string;
    readonly #transcripts = new Map<string, { mtimeMs: number; scan: TranscriptScan }>();

    constructor(desktopDir: string, projectsDir: string) {
        this.#desktopDir = desktopDir;
        this.#projectsDir = projectsDir;
    }

    /**
     * Every session per PR and role, the most recently active first. `made` counts a PR the session
     * created or pushed; the desktop app marks a PR it only saw `onlySeen`, and that does not count.
     * `reviewed` counts a PR the session posted a review or comment on, which only the transcripts
     * record.
     */
    async read(): Promise<SessionsPayload> {
        const made = new Map<string, PrSession[]>();
        const desktopByCli = new Map<string, PrSession>();
        for (const path of await listFiles(this.#desktopDir, 2, (name) => /^local_.*\.json$/.test(name))) {
            const session = await readJsonObject(path);
            if (!session || !isNonEmptyString(session.sessionId)) continue;
            const entry: PrSession = {
                id: session.sessionId,
                title: isNonEmptyString(session.title) ? session.title : "",
                archived: Boolean(session.isArchived),
                lastActivityAt: typeof session.lastActivityAt === "number" ? session.lastActivityAt : 0,
            };
            if (isNonEmptyString(session.cliSessionId)) desktopByCli.set(session.cliSessionId, entry);
            for (const pr of Array.isArray(session.prs) ? session.prs : []) {
                if (isObject(pr) && isNonEmptyString(pr.url) && !pr.onlySeen) addSession(made, pr.url, entry);
            }
        }
        const reviewed = new Map<string, PrSession[]>();
        await this.#readTranscripts(desktopByCli, made, reviewed);
        return { made: newestFirst(made), reviewed: newestFirst(reviewed) };
    }

    /**
     * A transcript behind a desktop session links to that session; the PRs it made are already in
     * the desktop record, so only its reviews are taken.
     */
    async #readTranscripts(
        desktopByCli: Map<string, PrSession>,
        made: Map<string, PrSession[]>,
        reviewed: Map<string, PrSession[]>,
    ): Promise<void> {
        const seen = new Set<string>();
        for (const path of await listFiles(this.#projectsDir, 1, (name) => name.endsWith(".jsonl"))) {
            let cached = this.#transcripts.get(path);
            try {
                const { mtimeMs } = await stat(path);
                if (cached?.mtimeMs !== mtimeMs) {
                    cached = { mtimeMs, scan: await scanTranscript(path) };
                    this.#transcripts.set(path, cached);
                }
            } catch {
                continue;
            }
            seen.add(path);
            const id = basename(path, ".jsonl");
            const desktop = desktopByCli.get(id);
            const entry: PrSession = desktop ?? {
                id,
                kind: "cli",
                title: cached.scan.title,
                archived: false,
                lastActivityAt: Math.trunc(cached.mtimeMs),
            };
            if (!desktop) for (const url of cached.scan.made) addSession(made, url, entry);
            for (const url of cached.scan.reviewed) addSession(reviewed, url, entry);
        }
        for (const path of this.#transcripts.keys()) if (!seen.has(path)) this.#transcripts.delete(path);
    }
}

/**
 * Read one CLI or VS Code transcript: its title, and the PRs it made and reviewed.
 *
 * The CLI writes a `pr-link` line for any PR it notices, including ones it only viewed, so a link
 * counts by the tool call just before it: `git push` or `gh pr create` made the PR, a review or
 * comment posted on it reviewed it.
 */
async function scanTranscript(path: string): Promise<TranscriptScan> {
    const scan: TranscriptScan = { title: "", made: new Set(), reviewed: new Set() };
    let lastAction = "";
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    // Only the few line types that matter are parsed; the substring test skips the rest cheaply.
    for await (const line of lines) {
        if (line.includes('"tool_use"')) {
            const message = parseJsonObject(line)?.message;
            if (!isObject(message) || !Array.isArray(message.content)) continue;
            for (const block of message.content) {
                if (isObject(block) && block.type === "tool_use") lastAction = toolAction(block);
            }
        } else if (line.includes('"pr-link"') || line.includes('"ai-title"')) {
            const record = parseJsonObject(line);
            if (record?.type === "ai-title") {
                if (isNonEmptyString(record.aiTitle)) scan.title = record.aiTitle;
            } else if (record?.type === "pr-link" && isNonEmptyString(record.prUrl)) {
                if (lastAction.includes("git push") || lastAction.includes("gh pr create")) {
                    scan.made.add(record.prUrl);
                } else if (REVIEW_ACTION.test(lastAction)) {
                    scan.reviewed.add(record.prUrl);
                }
            }
        }
    }
    return scan;
}

/** A shell command as it ran, or the tool's name with its skill and arguments. */
function toolAction(block: JsonObject): string {
    const input = isObject(block.input) ? block.input : {};
    if (isNonEmptyString(input.command)) return input.command;
    return [block.name, input.skill, input.args].filter(isNonEmptyString).join(" ");
}

/** Several transcripts can stand for one desktop session, which is listed once. */
function addSession(byUrl: Map<string, PrSession[]>, url: string, entry: PrSession): void {
    const list = byUrl.get(url);
    if (!list) byUrl.set(url, [entry]);
    else if (!list.some((session) => session.id === entry.id)) list.push(entry);
}

function newestFirst(byUrl: Map<string, PrSession[]>): Record<string, PrSession[]> {
    return Object.fromEntries(
        [...byUrl].map(([url, list]) => [url, list.toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)]),
    );
}

/** Files `depth` directories below `dir` whose name matches; unreadable directories are skipped. */
async function listFiles(dir: string, depth: number, matches: (name: string) => boolean): Promise<string[]> {
    let names: string[];
    try {
        names = (await readdir(dir)).sort();
    } catch {
        return [];
    }
    if (depth === 0) return names.filter(matches).map((name) => join(dir, name));
    const nested = await Promise.all(names.map((name) => listFiles(join(dir, name), depth - 1, matches)));
    return nested.flat();
}

async function readJsonObject(path: string): Promise<JsonObject | undefined> {
    try {
        return parseJsonObject(await readFile(path, "utf8"));
    } catch {
        return undefined;
    }
}

function parseJsonObject(text: string): JsonObject | undefined {
    try {
        const value: unknown = JSON.parse(text);
        return isObject(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value !== "";
}

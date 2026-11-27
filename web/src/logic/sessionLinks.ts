import type { PrSession } from "../../../shared/sessions.ts";

export type SessionRole = "made" | "reviewed";

export interface SessionLink {
    href: string;
    app: "Claude" | "VS Code";
    title: string;
    archived: boolean;
}

/** The deep link that opens a session in the app it ran in, or null for an id that fits neither. */
export function sessionLink(session: PrSession | null | undefined, role: SessionRole): SessionLink | null {
    if (!session) return null;
    let href: string;
    if (/^local_[0-9a-f-]+$/i.test(session.id)) {
        href = `claude://claude.ai/epitaxy/${session.id}`;
    } else if (session.kind === "cli" && /^[0-9a-f-]{36}$/i.test(session.id)) {
        href = `vscode://anthropic.claude-code/open?session=${session.id}`;
    } else {
        return null;
    }
    const where = session.kind === "cli" ? " in VS Code" : "";
    const state = session.archived ? " (archived)" : "";
    const name = session.title ? `: ${session.title}` : "";
    return {
        href,
        app: session.kind === "cli" ? "VS Code" : "Claude",
        title: `Open the Claude session that ${role} this PR${where}${state}${name}`,
        archived: session.archived,
    };
}

/** A link that hands Claude a prompt; `carriesPrompt` is false where the prompt has to be pasted. */
export interface PromptLink {
    href: string;
    app: SessionLink["app"];
    carriesPrompt: boolean;
}

// The desktop app cuts a longer prompt short, and a URL this long is already unwieldy to hand to the OS.
export const LINK_PROMPT_LIMIT = 8000;

const fits = (prompt: string) => prompt.length > 0 && prompt.length <= LINK_PROMPT_LIMIT;

/**
 * Opens `session` for `prompt`. VS Code's link takes the prompt and puts it in the session's box; the
 * desktop app's link to a session takes none, so there it has to be pasted.
 */
export function resumeLink(
    session: PrSession,
    role: SessionRole,
    prompt: string,
): (SessionLink & { carriesPrompt: boolean }) | null {
    const link = sessionLink(session, role);
    if (!link) return null;
    if (link.app === "VS Code" && fits(prompt)) {
        return { ...link, href: `${link.href}&prompt=${encodeURIComponent(prompt)}`, carriesPrompt: true };
    }
    return { ...link, carriesPrompt: false };
}

/** Starts a new Claude Code session with `prompt`, in the desktop app or in VS Code. */
export function newSessionLinks(prompt: string): PromptLink[] {
    const carriesPrompt = fits(prompt);
    const query = (name: string) => (carriesPrompt ? `?${name}=${encodeURIComponent(prompt)}` : "");
    return [
        { app: "Claude", href: `claude://code/new${query("q")}`, carriesPrompt },
        { app: "VS Code", href: `vscode://anthropic.claude-code/open${query("prompt")}`, carriesPrompt },
    ];
}

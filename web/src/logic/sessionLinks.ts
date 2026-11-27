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

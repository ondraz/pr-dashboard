import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The gitignored file at the repository root that holds this machine's settings. */
export const LOCAL_CONFIG_FILE = fileURLToPath(new URL("../config.local.json", import.meta.url));

/**
 * The GitHub App's client id: `PR_DASHBOARD_CLIENT_ID`, else `githubAppClientId` in
 * `config.local.json`, else null, which leaves only a pasted token.
 */
export function readClientId(env: NodeJS.ProcessEnv = process.env, configFile = LOCAL_CONFIG_FILE): string | null {
    const fromEnv = env.PR_DASHBOARD_CLIENT_ID?.trim();
    if (fromEnv) return fromEnv;
    let text: string;
    try {
        text = readFileSync(configFile, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    const config: unknown = JSON.parse(text);
    const clientId = (config as { githubAppClientId?: unknown } | null)?.githubAppClientId;
    if (clientId === undefined) return null;
    if (typeof clientId !== "string" || !clientId.trim()) {
        throw new Error(`${configFile}: githubAppClientId must be a non-empty string`);
    }
    return clientId.trim();
}

/** Where the signed-in user's tokens are kept: `PR_DASHBOARD_AUTH_FILE`, else under the XDG config directory. */
export function authFilePath(env: NodeJS.ProcessEnv = process.env): string {
    if (env.PR_DASHBOARD_AUTH_FILE) return env.PR_DASHBOARD_AUTH_FILE;
    const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(configHome, "pr-dashboard", "auth.json");
}

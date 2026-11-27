import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GrantedTokens } from "./oauth.ts";

/** The tokens of the signed-in user, and the app they were issued to. */
export interface StoredTokens extends GrantedTokens {
    clientId: string;
}

function isStoredTokens(value: unknown): value is StoredTokens {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.clientId === "string" &&
        typeof v.accessToken === "string" &&
        typeof v.accessTokenExpiresAt === "number" &&
        typeof v.refreshToken === "string" &&
        typeof v.refreshTokenExpiresAt === "number"
    );
}

/** The refresh token lasts six months, so it lives in a file only the user can read. */
export class TokenStore {
    readonly path: string;

    constructor(path: string) {
        this.path = path;
    }

    /** The stored tokens, or null when there are none or the file is not ours to read. */
    async read(): Promise<StoredTokens | null> {
        let text: string;
        try {
            text = await readFile(this.path, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
        }
        try {
            const parsed: unknown = JSON.parse(text);
            return isStoredTokens(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    async write(tokens: StoredTokens): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temp = `${this.path}.${process.pid}.tmp`;
        await writeFile(temp, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
        // writeFile leaves the mode of a temp file left over from a crash as it was.
        await chmod(temp, 0o600);
        await rename(temp, this.path);
    }

    async clear(): Promise<void> {
        await rm(this.path, { force: true });
    }
}

import { readStored, writeStored } from "./storage.ts";

const TOKEN_KEY = "gh_token";

/** The saved token: `sessionStorage` unless the user asked to remember it across sessions. */
export function storedToken(): string | null {
    return readStored(TOKEN_KEY, "session") ?? readStored(TOKEN_KEY, "local");
}

export function isTokenRemembered(): boolean {
    return readStored(TOKEN_KEY, "local") !== null;
}

export function saveToken(token: string, remember: boolean): void {
    writeStored(TOKEN_KEY, remember ? null : token, "session");
    writeStored(TOKEN_KEY, remember ? token : null, "local");
}

export function clearToken(): void {
    writeStored(TOKEN_KEY, null, "session");
    writeStored(TOKEN_KEY, null, "local");
}

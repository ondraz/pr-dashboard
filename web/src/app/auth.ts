import type {
    AuthErrorPayload,
    DeviceCodePayload,
    PollPayload,
    TokenPayload,
    TokenRequest,
} from "../../../shared/auth.ts";
import type { AccessTokenSource } from "../github/client.ts";

/** The local server's sign-in routes. */
export interface AuthApi {
    token(refused?: string): Promise<TokenPayload>;
    start(): Promise<DeviceCodePayload>;
    poll(): Promise<PollPayload>;
    signOut(): Promise<void>;
}

export class LocalAuthApi implements AuthApi {
    private readonly fetch: typeof fetch;

    constructor(fetchImpl?: typeof fetch) {
        // Called as a method, the browser's own fetch would throw "Illegal invocation".
        this.fetch = fetchImpl ?? ((input, init) => fetch(input, init));
    }

    token(refused?: string): Promise<TokenPayload> {
        const body: TokenRequest = refused ? { refused } : {};
        return this.post("/auth/token", body);
    }

    start(): Promise<DeviceCodePayload> {
        return this.post("/auth/start");
    }

    poll(): Promise<PollPayload> {
        return this.post("/auth/poll");
    }

    async signOut(): Promise<void> {
        await this.post("/auth/sign-out");
    }

    private async post<T>(path: string, body?: unknown): Promise<T> {
        const res = await this.fetch(path, {
            method: "POST",
            cache: "no-store",
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 204) return undefined as T;
        const payload = (await res.json().catch(() => null)) as T | Partial<AuthErrorPayload> | null;
        if (!res.ok) {
            const message = (payload as Partial<AuthErrorPayload> | null)?.error;
            throw new Error(message ? `Sign-in failed: ${message}` : `Sign-in failed (${res.status})`);
        }
        if (payload === null) throw new Error("Sign-in failed: the server answered without JSON");
        return payload as T;
    }
}

export class SignedOutError extends Error {
    override name = "SignedOutError";

    constructor() {
        super("Signed out of GitHub");
    }
}

/** The page asks the server again when the token it holds has less than this left. */
export const TOKEN_MARGIN_MS = 5 * 60_000;

/**
 * The GitHub App's access token, held in memory only and renewed through the local server, which
 * keeps the refresh token. Calls `onSignedOut` once the server has no token to give.
 */
export class AppTokenSource implements AccessTokenSource {
    private token: string;
    private expiresAt: number;
    private asking: Promise<string | null> | null = null;
    private signedOut = false;
    private readonly api: AuthApi;
    private readonly onSignedOut: () => void;
    private readonly now: () => number;

    constructor(
        api: AuthApi,
        initial: { accessToken: string; expiresAt: number },
        onSignedOut: () => void,
        now: () => number = Date.now,
    ) {
        this.api = api;
        this.token = initial.accessToken;
        this.expiresAt = initial.expiresAt;
        this.onSignedOut = onSignedOut;
        this.now = now;
    }

    async current(): Promise<string> {
        if (this.signedOut) throw new SignedOutError();
        if (this.expiresAt - this.now() > TOKEN_MARGIN_MS) return this.token;
        const token = await this.ask();
        if (!token) throw new SignedOutError();
        return token;
    }

    refused(token: string): Promise<string | null> {
        if (this.signedOut) return Promise.resolve(null);
        // Another request already got a fresh one.
        if (token !== this.token) return Promise.resolve(this.token);
        return this.ask(token);
    }

    private ask(refused?: string): Promise<string | null> {
        this.asking ??= this.api
            .token(refused)
            .then((payload) => {
                if (payload.status === "signed-in") {
                    this.token = payload.accessToken;
                    this.expiresAt = payload.expiresAt;
                    return this.token;
                }
                this.signedOut = true;
                this.onSignedOut();
                return null;
            })
            .finally(() => {
                this.asking = null;
            });
        return this.asking;
    }
}

/** The verification page GitHub named, as long as it is on github.com. */
export function verificationPage(uri: string): string {
    const fallback = "https://github.com/login/device";
    try {
        const url = new URL(uri);
        return url.protocol === "https:" && url.hostname === "github.com" ? url.href : fallback;
    } catch {
        return fallback;
    }
}

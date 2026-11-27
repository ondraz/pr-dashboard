import { type Context, Hono } from "hono";
import type { AuthErrorPayload, DeviceCodePayload, PollPayload, TokenPayload, TokenRequest } from "../shared/auth.ts";
import { type DeviceCode, GitHubOAuth, type GrantedTokens, OAuthError } from "./oauth.ts";
import type { StoredTokens, TokenStore } from "./tokenStore.ts";

/** An access token with less than this left is refreshed before it is handed out. */
export const REFRESH_MARGIN_MS = 10 * 60_000;

export class NotConfiguredError extends Error {
    override name = "NotConfiguredError";

    constructor() {
        super("No GitHub App client id is configured");
    }
}

// GitHub's docs name the first both ways; the others mean the device code no longer counts.
const EXPIRED_CODES = new Set(["expired_token", "token_expired", "bad_verification_code", "incorrect_device_code"]);

interface PendingSignIn extends DeviceCode {
    nextPollAt: number;
}

export interface AuthServiceOptions {
    /** The GitHub App's client id, or null when none is configured and only a pasted token works. */
    clientId: string | null;
    store: TokenStore;
    /** Defaults to GitHub's own endpoints for `clientId`. */
    oauth?: GitHubOAuth;
    now?: () => number;
}

/**
 * Signing in through the GitHub App's device flow, and handing the page a current access token.
 * The refresh token never leaves the server.
 */
export class AuthService {
    readonly clientId: string | null;
    private readonly store: TokenStore;
    private readonly oauth: GitHubOAuth | null;
    private readonly now: () => number;
    private pending: PendingSignIn | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    constructor({ clientId, store, oauth, now = Date.now }: AuthServiceOptions) {
        this.clientId = clientId;
        this.store = store;
        this.now = now;
        this.oauth = oauth ?? (clientId ? new GitHubOAuth(clientId, { now }) : null);
    }

    /**
     * The access token, refreshed first when it is about to expire or GitHub refused it. Signed out
     * when there is none, or GitHub no longer takes the refresh token.
     */
    token(refused?: string): Promise<TokenPayload> {
        return this.exclusive(async () => {
            const { clientId, oauth } = this;
            if (!clientId || !oauth) return { status: "signed-out", configured: false };
            const stored = await this.store.read();
            if (!stored || stored.clientId !== clientId) return { status: "signed-out", configured: true };
            const now = this.now();
            if (stored.accessToken !== refused && stored.accessTokenExpiresAt - now > REFRESH_MARGIN_MS) {
                return signedIn(stored);
            }
            if (stored.refreshTokenExpiresAt <= now) return this.forget();
            // Refresh tokens are single use, so two refreshes at once would sign the user out;
            // `exclusive` runs one at a time.
            let tokens: GrantedTokens;
            try {
                tokens = await oauth.refresh(stored.refreshToken);
            } catch (error) {
                if (error instanceof OAuthError && error.code === "bad_refresh_token") return this.forget();
                if (stored.accessToken !== refused && stored.accessTokenExpiresAt > now) return signedIn(stored);
                throw error;
            }
            const next = { ...tokens, clientId };
            await this.store.write(next);
            return signedIn(next);
        });
    }

    /** Starts a sign-in, replacing any not finished: the user enters the returned code on GitHub. */
    start(): Promise<DeviceCodePayload> {
        return this.exclusive(async () => {
            if (!this.oauth) throw new NotConfiguredError();
            const code = await this.oauth.requestDeviceCode();
            this.pending = { ...code, nextPollAt: this.now() + code.interval * 1000 };
            return {
                userCode: code.userCode,
                verificationUri: code.verificationUri,
                expiresAt: code.expiresAt,
                interval: code.interval,
            };
        });
    }

    /** Asks GitHub whether the user entered the code, no more often than GitHub allows. */
    poll(): Promise<PollPayload> {
        return this.exclusive(async (): Promise<PollPayload> => {
            const { pending, oauth, clientId } = this;
            if (!pending || !oauth || !clientId) return { status: "expired" };
            const now = this.now();
            if (now >= pending.expiresAt) {
                this.pending = null;
                return { status: "expired" };
            }
            if (now < pending.nextPollAt) return { status: "pending", interval: pending.interval };
            pending.nextPollAt = now + pending.interval * 1000;
            let tokens: GrantedTokens;
            try {
                tokens = await oauth.pollDeviceToken(pending.deviceCode);
            } catch (error) {
                if (!(error instanceof OAuthError)) throw error;
                if (error.code === "authorization_pending") return { status: "pending", interval: pending.interval };
                if (error.code === "slow_down") {
                    pending.interval = error.interval ?? pending.interval + 5;
                    pending.nextPollAt = now + pending.interval * 1000;
                    return { status: "pending", interval: pending.interval };
                }
                this.pending = null;
                if (EXPIRED_CODES.has(error.code)) return { status: "expired" };
                if (error.code === "access_denied") return { status: "denied" };
                throw error;
            }
            this.pending = null;
            await this.store.write({ ...tokens, clientId });
            return { status: "signed-in" };
        });
    }

    /**
     * Forgets the tokens on this machine. GitHub keeps the authorization until the user revokes it,
     * which needs the app's client secret, so only they can do it on github.com.
     */
    signOut(): Promise<void> {
        return this.exclusive(async () => {
            this.pending = null;
            await this.store.clear();
        });
    }

    private async forget(): Promise<TokenPayload> {
        await this.store.clear();
        return { status: "signed-out", configured: true };
    }

    private exclusive<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }
}

function signedIn(tokens: StoredTokens): TokenPayload {
    return { status: "signed-in", accessToken: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt };
}

/**
 * Only the page itself may call these: a request another site makes carries its own `Origin` and a
 * cross-site `Sec-Fetch-Site`, so it cannot start a sign-in or sign the user out with a form.
 * A request without either header comes from outside a browser, which could read the token file anyway.
 */
export function isOwnRequest(headers: { get(name: string): string | null | undefined }): boolean {
    const site = headers.get("sec-fetch-site");
    if (site != null && site !== "same-origin") return false;
    const origin = headers.get("origin");
    if (origin != null && origin.toLowerCase() !== `http://${headers.get("host")?.toLowerCase() ?? ""}`) return false;
    return true;
}

function failure(c: Context, error: unknown) {
    const status = error instanceof NotConfiguredError ? 409 : 502;
    const body: AuthErrorPayload = { error: error instanceof Error ? error.message : String(error) };
    return c.json(body, status);
}

async function tokenRequest(c: Context): Promise<TokenRequest> {
    try {
        const body: unknown = await c.req.json();
        const refused = (body as TokenRequest | null)?.refused;
        return typeof refused === "string" ? { refused } : {};
    } catch {
        return {};
    }
}

/** `/auth/*`, all POST so that nothing caches them and every browser sends its `Origin`. */
export function authRoutes(auth: AuthService): Hono {
    const routes = new Hono();

    routes.use(async (c, next) => {
        if (!isOwnRequest({ get: (name) => c.req.header(name) })) return c.text("Only answered to this page", 403);
        await next();
        c.header("Cache-Control", "no-store");
    });

    routes.post("/token", async (c) => {
        try {
            return c.json(await auth.token((await tokenRequest(c)).refused));
        } catch (error) {
            return failure(c, error);
        }
    });

    routes.post("/start", async (c) => {
        try {
            return c.json(await auth.start());
        } catch (error) {
            return failure(c, error);
        }
    });

    routes.post("/poll", async (c) => {
        try {
            return c.json(await auth.poll());
        } catch (error) {
            return failure(c, error);
        }
    });

    routes.post("/sign-out", async (c) => {
        await auth.signOut();
        return c.body(null, 204);
    });

    // Anything else under /auth/ would otherwise fall through to the app's page.
    routes.all("*", (c) => c.json({ error: "No such sign-in route" } satisfies AuthErrorPayload, 404));

    return routes;
}

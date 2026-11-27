import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthService, authRoutes, isOwnRequest, REFRESH_MARGIN_MS } from "./auth.ts";
import { authFilePath, readClientId, sessionDirs } from "./config.ts";
import { GitHubOAuth, OAuthError } from "./oauth.ts";
import { CLI_PROJECTS_DIR, DESKTOP_SESSIONS_DIR } from "./sessions.ts";
import { type StoredTokens, TokenStore } from "./tokenStore.ts";

const CLIENT_ID = "Iv23liFAKECLIENTID";
const T0 = Date.parse("2026-11-27T09:00:00Z");
const HOUR = 3_600_000;

type Reply = Record<string, unknown> | Error;

/** GitHub's sign-in endpoints, answering each call with the next scripted reply. */
class FakeGitHub {
    readonly calls: { path: string; params: URLSearchParams; accept: string | null }[] = [];
    private readonly replies = new Map<string, Reply[]>();

    reply(path: string, ...replies: Reply[]): void {
        this.replies.set(path, [...(this.replies.get(path) ?? []), ...replies]);
    }

    callsTo(path: string): URLSearchParams[] {
        return this.calls.filter((call) => call.path === path).map((call) => call.params);
    }

    readonly fetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const params = new URLSearchParams(String(init?.body ?? ""));
        this.calls.push({ path: url.pathname, params, accept: new Headers(init?.headers).get("accept") });
        const next = this.replies.get(url.pathname)?.shift();
        if (!next) throw new Error(`Unexpected call to ${url.pathname}`);
        if (next instanceof Error) throw next;
        return Response.json(next);
    };
}

const DEVICE = "/login/device/code";
const TOKEN = "/login/oauth/access_token";

function deviceCode(overrides: Record<string, unknown> = {}) {
    return {
        device_code: "device-code-1",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
        ...overrides,
    };
}

function granted(n: number) {
    return {
        access_token: `ghu_access${n}`,
        expires_in: 28_800,
        refresh_token: `ghr_refresh${n}`,
        refresh_token_expires_in: 15_897_600,
        scope: "",
        token_type: "bearer",
    };
}

let dir: string;
let now: number;
let github: FakeGitHub;
let store: TokenStore;

function service(clientId: string | null = CLIENT_ID): AuthService {
    const oauth = clientId ? new GitHubOAuth(clientId, { fetch: github.fetch, now: () => now }) : undefined;
    return new AuthService({ clientId, store, oauth, now: () => now });
}

function stored(overrides: Partial<StoredTokens> = {}): StoredTokens {
    return {
        clientId: CLIENT_ID,
        accessToken: "ghu_access0",
        accessTokenExpiresAt: now + 8 * HOUR,
        refreshToken: "ghr_refresh0",
        refreshTokenExpiresAt: now + 4000 * HOUR,
        ...overrides,
    };
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pr-dashboard-auth-"));
    now = T0;
    github = new FakeGitHub();
    store = new TokenStore(join(dir, "config", "auth.json"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("AuthService sign-in", () => {
    it("signs in through the device flow, polling no faster than GitHub allows", async () => {
        const auth = service();
        github.reply(DEVICE, deviceCode());
        expect(await auth.token()).toEqual({ status: "signed-out", configured: true });

        expect(await auth.start()).toEqual({
            userCode: "WDJB-MJHT",
            verificationUri: "https://github.com/login/device",
            expiresAt: T0 + 900_000,
            interval: 5,
        });
        expect(github.callsTo(DEVICE)[0]?.get("client_id")).toBe(CLIENT_ID);

        // Too soon: answered without asking GitHub.
        expect(await auth.poll()).toEqual({ status: "pending", interval: 5 });
        expect(github.callsTo(TOKEN)).toHaveLength(0);

        github.reply(TOKEN, { error: "authorization_pending" });
        now += 5_000;
        expect(await auth.poll()).toEqual({ status: "pending", interval: 5 });

        github.reply(TOKEN, { error: "slow_down", interval: 10 });
        now += 5_000;
        expect(await auth.poll()).toEqual({ status: "pending", interval: 10 });
        now += 5_000;
        expect(await auth.poll()).toEqual({ status: "pending", interval: 10 });
        expect(github.callsTo(TOKEN)).toHaveLength(2);

        github.reply(TOKEN, granted(1));
        now += 5_000;
        expect(await auth.poll()).toEqual({ status: "signed-in" });
        const poll = github.callsTo(TOKEN)[2];
        expect(Object.fromEntries(poll ?? [])).toEqual({
            client_id: CLIENT_ID,
            device_code: "device-code-1",
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
        expect(github.calls.every((call) => call.accept === "application/json")).toBe(true);

        expect(await auth.token()).toEqual({
            status: "signed-in",
            accessToken: "ghu_access1",
            expiresAt: now + 28_800_000,
        });
        expect(await store.read()).toMatchObject({ clientId: CLIENT_ID, refreshToken: "ghr_refresh1" });
        expect(statSync(store.path).mode & 0o777).toBe(0o600);
        // Once signed in there is nothing left to poll.
        expect(await auth.poll()).toEqual({ status: "expired" });
    });

    it("reports a cancelled sign-in and an expired code", async () => {
        const auth = service();
        github.reply(DEVICE, deviceCode(), deviceCode());
        github.reply(TOKEN, { error: "access_denied", error_description: "The user cancelled" });
        await auth.start();
        now += 5_000;
        expect(await auth.poll()).toEqual({ status: "denied" });

        await auth.start();
        now += 900_000;
        expect(await auth.poll()).toEqual({ status: "expired" });
        expect(github.callsTo(TOKEN)).toHaveLength(1);
    });

    it("passes on what GitHub says when the app is misconfigured", async () => {
        const auth = service();
        github.reply(DEVICE, deviceCode());
        github.reply(TOKEN, { error: "device_flow_disabled" });
        await auth.start();
        now += 5_000;
        await expect(auth.poll()).rejects.toThrow("The GitHub App does not have the device flow enabled");
    });

    it("refuses a token that never expires", async () => {
        const auth = service();
        github.reply(DEVICE, deviceCode());
        github.reply(TOKEN, { access_token: "ghu_forever", scope: "", token_type: "bearer" });
        await auth.start();
        now += 5_000;
        await expect(auth.poll()).rejects.toThrow(/expiring user tokens/);
        expect(await store.read()).toBeNull();
    });

    it("cannot start without a client id", async () => {
        const auth = service(null);
        expect(await auth.token()).toEqual({ status: "signed-out", configured: false });
        await expect(auth.start()).rejects.toThrow("No GitHub App client id is configured");
        expect(await auth.poll()).toEqual({ status: "expired" });
    });
});

describe("AuthService token", () => {
    it("hands out the stored token while it has time left", async () => {
        await store.write(stored());
        expect(await service().token()).toEqual({
            status: "signed-in",
            accessToken: "ghu_access0",
            expiresAt: T0 + 8 * HOUR,
        });
        expect(github.calls).toHaveLength(0);
    });

    it("refreshes a token about to expire once, however many ask at the same time", async () => {
        await store.write(stored({ accessTokenExpiresAt: now + REFRESH_MARGIN_MS - 1 }));
        github.reply(TOKEN, granted(1));
        const auth = service();

        const answers = await Promise.all([auth.token(), auth.token(), auth.token()]);

        expect(answers.map((answer) => answer.status === "signed-in" && answer.accessToken)).toEqual([
            "ghu_access1",
            "ghu_access1",
            "ghu_access1",
        ]);
        expect(github.callsTo(TOKEN).map((params) => Object.fromEntries(params))).toEqual([
            { client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: "ghr_refresh0" },
        ]);
        expect(await store.read()).toMatchObject({ refreshToken: "ghr_refresh1", accessToken: "ghu_access1" });
    });

    it("refreshes a token GitHub refused, and only that one", async () => {
        await store.write(stored());
        github.reply(TOKEN, granted(1));
        const auth = service();
        expect(await auth.token("ghu_someone_else")).toMatchObject({ accessToken: "ghu_access0" });
        expect(await auth.token("ghu_access0")).toMatchObject({ accessToken: "ghu_access1" });
        expect(github.callsTo(TOKEN)).toHaveLength(1);
    });

    it("signs out when GitHub no longer takes the refresh token", async () => {
        await store.write(stored({ accessTokenExpiresAt: now }));
        github.reply(TOKEN, { error: "bad_refresh_token", error_description: "The refresh token passed is incorrect" });
        expect(await service().token()).toEqual({ status: "signed-out", configured: true });
        expect(await store.read()).toBeNull();
    });

    it("signs out without asking when the refresh token has expired", async () => {
        await store.write(stored({ accessTokenExpiresAt: now, refreshTokenExpiresAt: now }));
        expect(await service().token()).toEqual({ status: "signed-out", configured: true });
        expect(github.calls).toHaveLength(0);
        expect(await store.read()).toBeNull();
    });

    it("keeps the tokens when GitHub cannot be reached", async () => {
        await store.write(stored({ accessTokenExpiresAt: now }));
        github.reply(TOKEN, new TypeError("fetch failed"));
        await expect(service().token()).rejects.toThrow("fetch failed");
        expect(await store.read()).toMatchObject({ refreshToken: "ghr_refresh0" });
    });

    it("hands out a token with time left while GitHub cannot renew it, but never a refused one", async () => {
        await store.write(stored({ accessTokenExpiresAt: now + REFRESH_MARGIN_MS - 1 }));
        github.reply(TOKEN, new TypeError("fetch failed"), new TypeError("fetch failed"));
        const auth = service();
        expect(await auth.token()).toMatchObject({ status: "signed-in", accessToken: "ghu_access0" });
        await expect(auth.token("ghu_access0")).rejects.toThrow("fetch failed");
        expect(github.callsTo(TOKEN)).toHaveLength(2);
    });

    it("ignores tokens issued to another app", async () => {
        await store.write(stored({ clientId: "Iv23liANOTHERAPP" }));
        expect(await service().token()).toEqual({ status: "signed-out", configured: true });
    });

    it("forgets the tokens on sign-out", async () => {
        await store.write(stored());
        const auth = service();
        await auth.signOut();
        expect(await store.read()).toBeNull();
        expect(await auth.token()).toEqual({ status: "signed-out", configured: true });
    });
});

describe("authRoutes", () => {
    let routes: ReturnType<typeof authRoutes>;
    beforeEach(() => {
        routes = authRoutes(service());
    });

    const post = (path: string, headers: Record<string, string> = {}, body?: unknown) =>
        Promise.resolve(
            routes.request(`http://localhost:6789${path}`, {
                method: "POST",
                headers: { Host: "localhost:6789", ...headers },
                body: body === undefined ? undefined : JSON.stringify(body),
            }),
        );

    it("answers the page itself", async () => {
        await store.write(stored());
        const res = await post("/token", { "Sec-Fetch-Site": "same-origin", Origin: "http://localhost:6789" });
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(await res.json()).toMatchObject({ status: "signed-in", accessToken: "ghu_access0" });
    });

    it.each([
        { "Sec-Fetch-Site": "cross-site" },
        { "Sec-Fetch-Site": "same-site" },
        { "Sec-Fetch-Site": "none" },
        { Origin: "https://evil.example" },
        { Origin: "http://localhost:3000" },
        { Origin: "null" },
        { "Sec-Fetch-Site": "same-origin", Origin: "http://127.0.0.1:6789" },
    ] as Record<string, string>[])("refuses another site's request %j", async (headers) => {
        await store.write(stored());
        for (const path of ["/token", "/start", "/poll", "/sign-out"]) {
            const res = await post(path, headers);
            expect(res.status).toBe(403);
        }
        expect(await store.read()).not.toBeNull();
        expect(github.calls).toHaveLength(0);
    });

    it("takes the refused token from the body", async () => {
        await store.write(stored());
        github.reply(TOKEN, granted(1));
        const res = await post("/token", {}, { refused: "ghu_access0" });
        expect(await res.json()).toMatchObject({ accessToken: "ghu_access1" });
    });

    it("says why GitHub could not be asked", async () => {
        await store.write(stored({ accessTokenExpiresAt: now }));
        github.reply(TOKEN, new TypeError("fetch failed"));
        const res = await post("/token");
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "fetch failed" });
    });

    it("runs a sign-in and a sign-out", async () => {
        github.reply(DEVICE, deviceCode());
        expect(await (await post("/start")).json()).toMatchObject({ userCode: "WDJB-MJHT" });
        expect(await (await post("/poll")).json()).toEqual({ status: "pending", interval: 5 });
        await store.write(stored());
        expect((await post("/sign-out")).status).toBe(204);
        expect(await store.read()).toBeNull();
    });

    it("answers 409 when no app is configured", async () => {
        const res = await authRoutes(service(null)).request("http://localhost/start", { method: "POST" });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: "No GitHub App client id is configured" });
    });
});

describe("isOwnRequest", () => {
    const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

    it("takes a same-origin request, or one from outside a browser", () => {
        expect(isOwnRequest(headers({ host: "localhost:6789" }))).toBe(true);
        expect(
            isOwnRequest(
                headers({ host: "LOCALHOST:6789", origin: "http://localhost:6789", "sec-fetch-site": "same-origin" }),
            ),
        ).toBe(true);
    });
});

describe("OAuthError", () => {
    it("explains an unknown client id", () => {
        for (const code of ["incorrect_client_credentials", "Not Found"]) {
            expect(new OAuthError(code, "").message).toBe("GitHub does not know the configured client id");
        }
        expect(new OAuthError("unsupported_grant_type", "Bad grant").message).toBe(
            "Bad grant (unsupported_grant_type)",
        );
    });
});

describe("TokenStore", () => {
    it("reads a damaged file as no tokens", async () => {
        await store.write(stored());
        writeFileSync(store.path, "{ not json");
        expect(await store.read()).toBeNull();
        writeFileSync(store.path, JSON.stringify({ accessToken: 1 }));
        expect(await store.read()).toBeNull();
    });

    it("keeps the file private even over a leftover with a wider mode", async () => {
        await store.write(stored());
        writeFileSync(`${store.path}.${process.pid}.tmp`, "", { mode: 0o644 });
        await store.write(stored({ refreshToken: "ghr_refresh2" }));
        expect(statSync(store.path).mode & 0o777).toBe(0o600);
        expect(statSync(join(dir, "config")).mode & 0o777).toBe(0o700);
        expect(await store.read()).toMatchObject({ refreshToken: "ghr_refresh2" });
    });
});

describe("config", () => {
    it("takes the client id from the environment first, then the local config file", () => {
        const file = join(dir, "config.local.json");
        expect(readClientId({}, file)).toBeNull();
        writeFileSync(file, JSON.stringify({ githubAppClientId: " Iv23liFROMFILE " }));
        expect(readClientId({}, file)).toBe("Iv23liFROMFILE");
        expect(readClientId({ PR_DASHBOARD_CLIENT_ID: "Iv23liFROMENV" }, file)).toBe("Iv23liFROMENV");
        writeFileSync(file, JSON.stringify({}));
        expect(readClientId({}, file)).toBeNull();
        writeFileSync(file, JSON.stringify({ githubAppClientId: 42 }));
        expect(() => readClientId({}, file)).toThrow(/githubAppClientId must be a non-empty string/);
        writeFileSync(file, "{ githubAppClientId: ");
        expect(() => readClientId({}, file)).toThrow(file);
    });

    it("keeps the tokens under the user's config directory", () => {
        expect(authFilePath({ PR_DASHBOARD_AUTH_FILE: "/x/auth.json" })).toBe("/x/auth.json");
        expect(authFilePath({ XDG_CONFIG_HOME: "/home/dev/.config" })).toBe("/home/dev/.config/pr-dashboard/auth.json");
    });

    it("reads the sessions from Claude's own directories unless told otherwise", () => {
        expect(sessionDirs({})).toEqual({ desktop: DESKTOP_SESSIONS_DIR, projects: CLI_PROJECTS_DIR });
        expect(
            sessionDirs({ PR_DASHBOARD_DESKTOP_SESSIONS: "/x/desktop", PR_DASHBOARD_CLI_PROJECTS: "/x/projects" }),
        ).toEqual({ desktop: "/x/desktop", projects: "/x/projects" });
    });
});

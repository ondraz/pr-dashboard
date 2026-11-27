const GITHUB = "https://github.com";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const TIMEOUT_MS = 15_000;

/** A device code GitHub issued: the user enters `userCode` at `verificationUri`. */
export interface DeviceCode {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    /** Milliseconds since the epoch. */
    expiresAt: number;
    /** Seconds to wait between polls. */
    interval: number;
}

/** A user access token and the refresh token that renews it; times are milliseconds since the epoch. */
export interface GrantedTokens {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
}

/** GitHub answered a token request with an OAuth error, such as `authorization_pending`. */
export class OAuthError extends Error {
    override name = "OAuthError";
    readonly code: string;
    /** The longer wait GitHub asks for with `slow_down`, in seconds. */
    readonly interval: number | undefined;

    constructor(code: string, description: string, interval?: number) {
        super(OAuthError.explain(code, description));
        this.code = code;
        this.interval = interval;
    }

    private static explain(code: string, description: string): string {
        if (code === "device_flow_disabled") return "The GitHub App does not have the device flow enabled";
        // GitHub answers a client id it has never seen with a 404 and this as the error.
        if (code === "incorrect_client_credentials" || code === "Not Found") {
            return "GitHub does not know the configured client id";
        }
        return description ? `${description} (${code})` : `GitHub refused the request (${code})`;
    }
}

/**
 * GitHub's sign-in endpoints for one GitHub App, which browser JavaScript cannot call. The device
 * flow needs no client secret, neither to sign in nor to refresh, so none is configured anywhere.
 */
export class GitHubOAuth {
    private readonly clientId: string;
    private readonly fetch: typeof fetch;
    private readonly now: () => number;

    constructor(clientId: string, options: { fetch?: typeof fetch; now?: () => number } = {}) {
        this.clientId = clientId;
        this.fetch = options.fetch ?? globalThis.fetch;
        this.now = options.now ?? Date.now;
    }

    async requestDeviceCode(): Promise<DeviceCode> {
        const body = await this.post("/login/device/code", { client_id: this.clientId });
        const { device_code, user_code, verification_uri, expires_in, interval } = body;
        if (
            typeof device_code !== "string" ||
            typeof user_code !== "string" ||
            typeof verification_uri !== "string" ||
            typeof expires_in !== "number"
        ) {
            throw new Error("GitHub answered the device code request without a code");
        }
        return {
            deviceCode: device_code,
            userCode: user_code,
            verificationUri: verification_uri,
            expiresAt: this.now() + expires_in * 1000,
            interval: typeof interval === "number" ? interval : 5,
        };
    }

    /** The tokens once the user has entered the code; throws `OAuthError` while they have not. */
    async pollDeviceToken(deviceCode: string): Promise<GrantedTokens> {
        return this.grant({ client_id: this.clientId, device_code: deviceCode, grant_type: DEVICE_GRANT });
    }

    /** New tokens for a refresh token, which stops working once used. */
    async refresh(refreshToken: string): Promise<GrantedTokens> {
        return this.grant({ client_id: this.clientId, grant_type: "refresh_token", refresh_token: refreshToken });
    }

    private async grant(params: Record<string, string>): Promise<GrantedTokens> {
        const now = this.now();
        const { access_token, expires_in, refresh_token, refresh_token_expires_in } = await this.post(
            "/login/oauth/access_token",
            params,
        );
        if (typeof access_token !== "string") throw new Error("GitHub answered without an access token");
        if (
            typeof expires_in !== "number" ||
            typeof refresh_token !== "string" ||
            typeof refresh_token_expires_in !== "number"
        ) {
            throw new Error("GitHub issued a token that never expires: turn on expiring user tokens for the app");
        }
        return {
            accessToken: access_token,
            accessTokenExpiresAt: now + expires_in * 1000,
            refreshToken: refresh_token,
            refreshTokenExpiresAt: now + refresh_token_expires_in * 1000,
        };
    }

    private async post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
        const res = await this.fetch(`${GITHUB}${path}`, {
            method: "POST",
            headers: { Accept: "application/json" },
            body: new URLSearchParams(params),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        let body: unknown;
        try {
            body = await res.json();
        } catch {
            throw new Error(`GitHub answered ${res.status} without JSON`);
        }
        if (typeof body !== "object" || body === null) throw new Error(`GitHub answered ${res.status} without JSON`);
        const fields = body as Record<string, unknown>;
        // GitHub answers OAuth errors with a 200 as often as not, so the body decides.
        if (typeof fields.error === "string") {
            const description = typeof fields.error_description === "string" ? fields.error_description : "";
            const interval = typeof fields.interval === "number" ? fields.interval : undefined;
            throw new OAuthError(fields.error, description, interval);
        }
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        return fields;
    }
}

/** `POST /auth/token`: the access token the page uses, refreshed by the server when it is about to expire. */
export type TokenPayload =
    | {
          status: "signed-in";
          accessToken: string;
          /** Milliseconds since the epoch. */
          expiresAt: number;
      }
    | {
          status: "signed-out";
          /** Whether a GitHub App client id is configured, so signing in is possible at all. */
          configured: boolean;
      };

/** The body of `POST /auth/token`. */
export interface TokenRequest {
    /** An access token GitHub answered with a 401, which the server must not hand out again. */
    refused?: string;
}

/** `POST /auth/start`: the code the user enters on GitHub to sign in. */
export interface DeviceCodePayload {
    userCode: string;
    verificationUri: string;
    /** Milliseconds since the epoch. */
    expiresAt: number;
    /** Seconds the page should wait between calls to `/auth/poll`. */
    interval: number;
}

/** `POST /auth/poll`: how the sign-in started by `/auth/start` stands. */
export type PollPayload =
    | { status: "pending"; interval: number }
    | { status: "signed-in" }
    /** The code expired, or no sign-in was started. */
    | { status: "expired" }
    /** The user cancelled on GitHub. */
    | { status: "denied" };

/** The body of any `/auth/*` answer that is not a 200. */
export interface AuthErrorPayload {
    error: string;
}

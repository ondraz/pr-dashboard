import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TokenPayload } from "../../../shared/auth.ts";
import { AppTokenSource } from "./auth.ts";
import { useServices } from "./services.tsx";
import { clearToken, saveToken, storedToken } from "./token.ts";

/** How the page reaches GitHub: the GitHub App's renewing tokens, or a pasted read-only token. */
export type Credentials = { kind: "app"; source: AppTokenSource } | { kind: "token"; token: string };

export interface Auth {
    /** False until the server has said whether the user is signed in. */
    ready: boolean;
    /** The GitHub App when signed in, else a pasted token, else null. */
    credentials: Credentials | null;
    /** Whether the server has a GitHub App to sign in with. */
    appConfigured: boolean;
    /** Why the server could not say whether the user is signed in. */
    error: string | null;
    /** Picks up the sign-in the server just finished. */
    signedIn: () => Promise<void>;
    signOut: () => Promise<void>;
    saveToken: (token: string, remember: boolean) => void;
    clearToken: () => void;
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
    const auth = useContext(AuthContext);
    if (!auth) throw new Error("useAuth needs an AuthProvider");
    return auth;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const { auth: api } = useServices();
    const [ready, setReady] = useState(false);
    const [app, setApp] = useState<AppTokenSource | null>(null);
    const [appConfigured, setAppConfigured] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pasted, setPasted] = useState(storedToken);
    const appRef = useRef(app);
    appRef.current = app;

    const adopt = useCallback(
        (payload: TokenPayload) => {
            setAppConfigured(payload.status === "signed-in" || payload.configured);
            if (payload.status !== "signed-in") {
                setApp(null);
                return;
            }
            const source: AppTokenSource = new AppTokenSource(api, payload, () => {
                if (appRef.current === source) setApp(null);
            });
            setApp(source);
        },
        [api],
    );

    const ask = useCallback(async () => {
        try {
            adopt(await api.token());
            setError(null);
        } catch (failure) {
            // Without an answer the page cannot tell; a pasted token still works.
            setApp(null);
            setError(failure instanceof Error ? failure.message : String(failure));
        }
    }, [api, adopt]);

    useEffect(() => {
        let current = true;
        api.token()
            .then((payload) => {
                if (current) adopt(payload);
            })
            .catch((failure: unknown) => {
                // fetch itself failing means no server to ask at all: only a pasted token works.
                if (current && !(failure instanceof TypeError)) {
                    setError(failure instanceof Error ? failure.message : String(failure));
                }
            })
            .finally(() => {
                if (current) setReady(true);
            });
        return () => {
            current = false;
        };
    }, [api, adopt]);

    const credentials = useMemo<Credentials | null>(
        () => (app ? { kind: "app", source: app } : pasted ? { kind: "token", token: pasted } : null),
        [app, pasted],
    );

    const value = useMemo<Auth>(
        () => ({
            ready,
            credentials,
            appConfigured,
            error,
            signedIn: ask,
            signOut: async () => {
                await api.signOut();
                setApp(null);
            },
            saveToken: (token, remember) => {
                saveToken(token, remember);
                setPasted(token);
            },
            clearToken: () => {
                clearToken();
                setPasted(null);
            },
        }),
        [ready, credentials, appConfigured, error, ask, api],
    );

    return <AuthContext value={value}>{children}</AuthContext>;
}

import { type FormEvent, useEffect, useState } from "react";
import type { DeviceCodePayload } from "../../../shared/auth.ts";
import { useAuth } from "./AuthProvider.tsx";
import { verificationPage } from "./auth.ts";
import { useServices } from "./services.tsx";
import { isTokenRemembered } from "./token.ts";

type Step =
    | { kind: "idle" }
    | { kind: "starting" }
    | { kind: "code"; code: DeviceCodePayload }
    | { kind: "failed"; message: string };

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Signing in through the GitHub App: the user enters a code on GitHub while the page waits. */
function AppSignIn() {
    const { auth: api } = useServices();
    const { signedIn } = useAuth();
    const [step, setStep] = useState<Step>({ kind: "idle" });
    const [copied, setCopied] = useState(false);

    const start = async () => {
        setStep({ kind: "starting" });
        setCopied(false);
        try {
            setStep({ kind: "code", code: await api.start() });
        } catch (error) {
            setStep({ kind: "failed", message: messageOf(error) });
        }
    };

    const code = step.kind === "code" ? step.code : null;
    useEffect(() => {
        if (!code) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let active = true;
        const poll = async () => {
            try {
                const result = await api.poll();
                if (!active) return;
                if (result.status === "pending") timer = setTimeout(poll, result.interval * 1000);
                else if (result.status === "signed-in") await signedIn();
                else if (result.status === "denied")
                    setStep({ kind: "failed", message: "Sign-in was cancelled on GitHub." });
                else setStep({ kind: "failed", message: "The code expired before it was entered." });
            } catch (error) {
                if (active) setStep({ kind: "failed", message: messageOf(error) });
            }
        };
        timer = setTimeout(poll, code.interval * 1000);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [code, api, signedIn]);

    const copy = () => {
        if (!code) return;
        navigator.clipboard?.writeText(code.userCode).then(
            () => setCopied(true),
            () => undefined,
        );
    };

    if (code) {
        const page = verificationPage(code.verificationUri);
        return (
            <div className="app-sign-in">
                <div className="setup-hint">
                    Enter this code on{" "}
                    <a href={page} target="_blank" rel="noopener noreferrer">
                        {page.replace(/^https:\/\//, "")}
                    </a>
                    :
                </div>
                <div className="device-code-row">
                    <code className="device-code">{code.userCode}</code>
                    <button type="button" className="secondary-btn" onClick={copy}>
                        {copied ? "Copied" : "Copy"}
                    </button>
                    <span className="setup-hint" role="status">
                        Waiting for GitHub…
                    </span>
                    <button type="button" className="secondary-btn" onClick={() => setStep({ kind: "idle" })}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="app-sign-in">
            <div className="setup-hint">
                Sign in through the dashboard's GitHub App. The page gets a token that expires within 8 hours.
            </div>
            <div className="setup-row">
                <button type="button" onClick={start} disabled={step.kind === "starting"}>
                    Sign in with GitHub
                </button>
            </div>
            {step.kind === "failed" && (
                <div className="error setup-error" role="alert">
                    {step.message}
                </div>
            )}
        </div>
    );
}

function TokenForm({ onSave }: { onSave: (token: string, remember: boolean) => void }) {
    const [value, setValue] = useState("");
    const [remember, setRemember] = useState(isTokenRemembered);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const token = value.trim();
        if (token) onSave(token, remember);
    };
    return (
        <form onSubmit={submit}>
            <label htmlFor="token-input">
                Fine-grained GitHub token with <code>Pull requests</code> read access (
                <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    create one
                </a>
                )
            </label>
            <div className="setup-row">
                <input
                    id="token-input"
                    type="password"
                    placeholder="github_pat_..."
                    autoComplete="off"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                />
                <label className="remember-label">
                    <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{" "}
                    Remember across sessions
                </label>
                <button type="submit">Save &amp; Load</button>
            </div>
        </form>
    );
}

/** The ways in: the GitHub App when the server has one, and a pasted read-only token. */
export function SignIn({ onSaveToken }: { onSaveToken: (token: string, remember: boolean) => void }) {
    const { appConfigured, error } = useAuth();
    return (
        <div className="setup">
            {error && (
                <div className="error setup-error" role="alert">
                    {error}
                </div>
            )}
            {appConfigured && (
                <>
                    <AppSignIn />
                    <div className="setup-or">or, read-only, without the app</div>
                </>
            )}
            <TokenForm onSave={onSaveToken} />
        </div>
    );
}

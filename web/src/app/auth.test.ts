import { describe, expect, it, vi } from "vitest";
import type { TokenPayload } from "../../../shared/auth.ts";
import {
    AppTokenSource,
    type AuthApi,
    LocalAuthApi,
    SignedOutError,
    TOKEN_MARGIN_MS,
    verificationPage,
} from "./auth.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");

function api(answers: TokenPayload[]): AuthApi & { asked: (string | undefined)[] } {
    const asked: (string | undefined)[] = [];
    return {
        asked,
        token: async (refused) => {
            asked.push(refused);
            const next = answers.shift();
            if (!next) throw new Error("Asked once too often");
            return next;
        },
        start: () => Promise.reject(new Error("unused")),
        poll: () => Promise.reject(new Error("unused")),
        signOut: () => Promise.reject(new Error("unused")),
    };
}

const signedIn = (accessToken: string, expiresAt = NOW + 8 * 3_600_000): TokenPayload => ({
    status: "signed-in",
    accessToken,
    expiresAt,
});

const held = (accessToken: string) => ({ accessToken, expiresAt: NOW + 8 * 3_600_000 });

describe("AppTokenSource", () => {
    it("hands out the token it holds while it has time left, then asks once for a fresh one", async () => {
        let now = NOW;
        const server = api([signedIn("ghu_two")]);
        const source = new AppTokenSource(server, held("ghu_one"), vi.fn(), () => now);
        expect(await source.current()).toBe("ghu_one");
        expect(server.asked).toEqual([]);

        now = NOW + 8 * 3_600_000 - TOKEN_MARGIN_MS;
        expect(await Promise.all([source.current(), source.current()])).toEqual(["ghu_two", "ghu_two"]);
        expect(server.asked).toEqual([undefined]);
    });

    it("asks for a fresh token when GitHub refuses the one it holds, once for many requests", async () => {
        const server = api([signedIn("ghu_two")]);
        const source = new AppTokenSource(server, held("ghu_one"), vi.fn(), () => NOW);
        expect(await Promise.all([source.refused("ghu_one"), source.refused("ghu_one")])).toEqual([
            "ghu_two",
            "ghu_two",
        ]);
        // A request that went out with the old token while the new one was on its way.
        expect(await source.refused("ghu_one")).toBe("ghu_two");
        expect(server.asked).toEqual(["ghu_one"]);
    });

    it("reports the sign-out once and refuses from then on", async () => {
        const onSignedOut = vi.fn();
        const server = api([{ status: "signed-out", configured: true }]);
        const source = new AppTokenSource(server, held("ghu_one"), onSignedOut, () => NOW);
        expect(await source.refused("ghu_one")).toBeNull();
        expect(onSignedOut).toHaveBeenCalledTimes(1);
        await expect(source.current()).rejects.toBeInstanceOf(SignedOutError);
        expect(await source.refused("ghu_one")).toBeNull();
        expect(server.asked).toHaveLength(1);
    });
});

describe("LocalAuthApi", () => {
    it("posts to the server's sign-in routes", async () => {
        const calls: { url: string; init: RequestInit | undefined }[] = [];
        const fetchImpl = (async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            if (url === "/auth/sign-out") return new Response(null, { status: 204 });
            return Response.json({ status: "signed-out", configured: true });
        }) as typeof fetch;
        const local = new LocalAuthApi(fetchImpl);

        expect(await local.token("ghu_old")).toEqual({ status: "signed-out", configured: true });
        await local.signOut();

        expect(calls.map((call) => [call.url, call.init?.method, call.init?.body])).toEqual([
            ["/auth/token", "POST", JSON.stringify({ refused: "ghu_old" })],
            ["/auth/sign-out", "POST", undefined],
        ]);
    });

    it("passes on why the server failed", async () => {
        const failing = new LocalAuthApi((async () =>
            Response.json({ error: "fetch failed" }, { status: 502 })) as unknown as typeof fetch);
        await expect(failing.start()).rejects.toThrow("Sign-in failed: fetch failed");
        const html = new LocalAuthApi((async () => new Response("<!doctype html>")) as unknown as typeof fetch);
        await expect(html.token()).rejects.toThrow("the server answered without JSON");
    });
});

describe("verificationPage", () => {
    it("links only to github.com", () => {
        expect(verificationPage("https://github.com/login/device")).toBe("https://github.com/login/device");
        expect(verificationPage("https://evil.example/login/device")).toBe("https://github.com/login/device");
        expect(verificationPage("javascript:alert(1)")).toBe("https://github.com/login/device");
        expect(verificationPage("not a url")).toBe("https://github.com/login/device");
    });
});

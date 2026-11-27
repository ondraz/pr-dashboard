import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DIFF_INLINE_STYLES } from "../shared/diffStyles.ts";
import type { SessionsPayload } from "../shared/sessions.ts";
import { CONTENT_SECURITY_POLICY, createApp, createHttpServer, isAppRoute } from "./app.ts";
import { AuthService } from "./auth.ts";
import { servedByVite } from "./dev.ts";
import { SessionIndex } from "./sessions.ts";
import { TokenStore } from "./tokenStore.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const sessions = new SessionIndex(join(FIXTURES, "desktop"), join(FIXTURES, "projects"));

// A stand-in for web/dist, as `vite build` lays it out.
const WEB_ROOT = mkdtempSync(join(tmpdir(), "pr-dashboard-dist-"));
mkdirSync(join(WEB_ROOT, "assets"));
writeFileSync(
    join(WEB_ROOT, "index.html"),
    '<!doctype html><script type="module" src="/assets/index-abc123.js"></script>',
);
writeFileSync(join(WEB_ROOT, "assets", "index-abc123.js"), "console.log('app');");
writeFileSync(join(WEB_ROOT, "favicon.svg"), "<svg></svg>");
afterAll(() => rmSync(WEB_ROOT, { recursive: true, force: true }));

const auth = new AuthService({ clientId: null, store: new TokenStore(join(tmpdir(), "pr-dashboard-unused.json")) });
const app = createApp({ sessions, auth, webRoot: WEB_ROOT });

function get(path: string, host: string | null = "localhost:6789", init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (host !== null) headers.set("Host", host);
    return Promise.resolve(app.request(`http://localhost${path}`, { ...init, headers }));
}

describe("createApp", () => {
    it.each(["localhost:6789", "localhost", "127.0.0.1:6789", "[::1]:6789", "[::1]", "LOCALHOST:6789"])(
        "answers Host %j",
        async (host) => {
            expect((await get("/sessions.json", host)).status).toBe(200);
        },
    );

    it.each([
        "evil.example",
        "evil.example:6789",
        "localhost.evil.example",
        "127.0.0.1.nip.io:6789",
        "localhost:x",
        "",
    ])("refuses Host %j", async (host) => {
        const res = await get("/sessions.json", host);
        expect(res.status).toBe(403);
        expect(await res.text()).toBe("Only served to localhost");
    });

    it("refuses a request without a Host", async () => {
        expect((await get("/", null)).status).toBe(403);
    });

    it("serves the session map uncached and without CORS headers", async () => {
        const res = await get("/sessions.json?ts=1", "localhost:6789", { headers: { Origin: "https://evil.example" } });
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
        const body = (await res.json()) as SessionsPayload;
        expect(Object.keys(body)).toEqual(["made", "reviewed", "repos"]);
        expect(body.made["https://github.com/example-org/widgets/pull/1"]?.[0]?.title).toBe(
            "Add CSV export to widgets",
        );
    });

    it.each([
        "/",
        "/index.html",
        "/acme/widgets/pull/12",
        "/acme/widgets/pull/12/files",
        "/acme/widgets/pull/12/files/aaaaaaa..bbbbbbb",
        "/acme/web.site/pull/3",
    ])("serves the app with its CSP at %s", async (path) => {
        const res = await get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
        expect(res.headers.get("Cache-Control")).toBe("no-cache");
        expect(res.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
        expect(await res.text()).toMatch(/^<!doctype html>/i);
    });

    it("allows no inline style but the diff view's own, each by its hash", () => {
        const styleSrc = CONTENT_SECURITY_POLICY.split("; ").find((directive) => directive.startsWith("style-src "));
        const hashes = DIFF_INLINE_STYLES.map(
            (style) => `'sha256-${createHash("sha256").update(style).digest("base64")}'`,
        );
        expect(styleSrc).toBe(`style-src 'self' 'unsafe-hashes' ${hashes.join(" ")}`);
        expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    });

    it("serves the hashed bundle for good and other files revalidated", async () => {
        const bundle = await get("/assets/index-abc123.js");
        expect(bundle.status).toBe(200);
        expect(bundle.headers.get("Content-Type")).toMatch(/^text\/javascript/);
        expect(bundle.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
        expect(bundle.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect((await get("/favicon.svg")).headers.get("Cache-Control")).toBe("no-cache");
    });

    it("answers HEAD without a body", async () => {
        const res = await get("/", "localhost:6789", { method: "HEAD" });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("");
    });

    it.each([
        "/README.md",
        "/server/main.ts",
        "/package.json",
        "/.git",
        "/index.htm",
        "/assets/gone",
        "/assets/gone.js",
    ])("serves nothing else, such as %s", async (path) => {
        expect((await get(path)).status).toBe(404);
    });

    it("answers sign-in itself rather than with the page", async () => {
        const res = await get("/auth/token", "localhost:6789", { method: "POST" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "signed-out", configured: false });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        for (const [path, method] of [
            ["/auth/token", "GET"],
            ["/auth/nowhere", "POST"],
        ] as const) {
            const other = await get(path, "localhost:6789", { method });
            expect(other.status).toBe(404);
            expect(other.headers.get("Content-Type")).toMatch(/^application\/json/);
        }
        expect((await get("/auth/token", "evil.example", { method: "POST" })).status).toBe(403);
    });

    it("does not walk out of the build", async () => {
        expect((await get("/assets/../../package.json")).status).toBe(404);
        expect((await get("/%2e%2e/package.json")).status).toBe(404);
    });

    it("says so when the app is not built", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const unbuilt = createApp({ sessions, auth, webRoot: join(WEB_ROOT, "missing") });
        const res = await unbuilt.request("http://localhost/acme/widgets/pull/1", { headers: { Host: "localhost" } });
        expect(res.status).toBe(503);
        expect(await res.text()).toBe("The app is not built yet: run `make build`");
        error.mockRestore();
    });

    it("leaves the page to Vite under make dev", async () => {
        const dev = createApp({ sessions, auth, webRoot: null });
        expect((await dev.request("http://localhost/", { headers: { Host: "localhost" } })).status).toBe(404);
        expect((await dev.request("http://localhost/sessions.json", { headers: { Host: "localhost" } })).status).toBe(
            200,
        );
    });
});

describe("isAppRoute", () => {
    it("takes paths without a file name", () => {
        expect(
            [
                "/",
                "/acme/widgets/pull/1/commits/abc123",
                "/acme/next.js/pull/1",
                "/acme/widgets/pull/1/files/aaaaaaa..bbbbbbb",
            ].every(isAppRoute),
        ).toBe(true);
        expect(
            ["/favicon.ico", "/assets/x", "/robots.txt", "/a..b", "/acme/widgets/pull/1/files/aaaaaaa...bbbbbbb"].some(
                isAppRoute,
            ),
        ).toBe(false);
    });
});

describe("servedByVite", () => {
    const req = (url: string, host = "localhost:6789") => ({ url, headers: { host } });

    it("hands Vite the page and its modules, but not the server's own paths", () => {
        expect(servedByVite(req("/"))).toBe(true);
        expect(servedByVite(req("/src/main.tsx?t=1"))).toBe(true);
        expect(servedByVite(req("/sessions.json"))).toBe(false);
        expect(servedByVite(req("/sessions.json?ts=1"))).toBe(false);
        expect(servedByVite(req("/auth/token"))).toBe(false);
        expect(servedByVite(req("/authors"))).toBe(true);
    });

    it("leaves any other Host to the server, which refuses it", () => {
        expect(servedByVite(req("/", "evil.example"))).toBe(false);
    });
});

describe("createHttpServer", () => {
    it("checks the Host header, not the request target", async () => {
        const server = createHttpServer(app);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        const status = (path: string, host: string) =>
            new Promise<number | undefined>((resolve, reject) => {
                httpRequest({ host: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
                    res.resume();
                    resolve(res.statusCode);
                })
                    .on("error", reject)
                    .end();
            });
        try {
            expect(await status("/sessions.json", `localhost:${port}`)).toBe(200);
            expect(await status("/sessions.json", "evil.example")).toBe(403);
            expect(await status("http://localhost/sessions.json", "evil.example")).toBe(403);
        } finally {
            server.close();
        }
    });
});

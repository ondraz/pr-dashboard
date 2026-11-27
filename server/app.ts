import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type AuthService, authRoutes } from "./auth.ts";
import type { SessionIndex } from "./sessions.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The paths the server answers itself; everything else is the app. */
export function isServerPath(path: string): boolean {
    return path === "/sessions.json" || path.startsWith("/auth/");
}

/**
 * Only the bundle's own scripts and styles run, the page talks to nothing but this server and
 * GitHub's API, and it shows images only from GitHub.
 */
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https://github.com https://*.githubusercontent.com",
    "connect-src 'self' https://api.github.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join("; ");

export interface AppOptions {
    sessions: SessionIndex;
    auth: AuthService;
    /** The built app (`web/dist`), or null under `make dev`, where Vite serves it. */
    webRoot: string | null;
}

/**
 * The local server's routes. It answers only a loopback `Host`, so a site that rebinds its own
 * name to 127.0.0.1 gets nothing, and sends no CORS headers, so no other origin can read a response.
 */
export function createApp({ sessions, auth, webRoot }: AppOptions): Hono {
    const app = new Hono();

    app.use(async (c, next) => {
        if (!isLoopbackHost(c.req.header("host"))) return c.text("Only served to localhost", 403);
        await next();
    });

    app.get("/sessions.json", async (c) => {
        c.header("Cache-Control", "no-store");
        return c.json(await sessions.read());
    });

    app.route("/auth", authRoutes(auth));

    if (webRoot) serveBuild(app, webRoot);
    return app;
}

function serveBuild(app: Hono, webRoot: string): void {
    app.use(async (c, next) => {
        await next();
        c.res.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
        c.res.headers.set("X-Content-Type-Options", "nosniff");
        // Vite names every file under assets/ by its content hash.
        const hashed = c.res.ok && c.req.path.startsWith("/assets/");
        c.res.headers.set("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
    });

    app.use(serveStatic({ root: webRoot }));

    // Any path the router may own gets the page, so a link into the app survives a reload.
    app.get("*", async (c) => {
        if (!isAppRoute(c.req.path)) return c.notFound();
        let html: Buffer;
        try {
            html = await readFile(join(webRoot, "index.html"));
        } catch {
            return c.text("The app is not built yet: run `make build`", 503);
        }
        return c.body(new Uint8Array(html), 200, { "Content-Type": "text/html; charset=utf-8" });
    });
}

/** A path the page's router may own: not a file (no dot in its last segment), not under assets/. */
export function isAppRoute(path: string): boolean {
    return !path.startsWith("/assets/") && !/\.[^/]*$/.test(path);
}

export function createHttpServer(app: Hono): Server {
    return createServer(getRequestListener(app.fetch));
}

export function isLoopbackHost(header: string | undefined): boolean {
    return LOOPBACK_HOSTS.has(hostName(header));
}

/** The host name of a `Host` header without its port, or "" when it is missing or malformed. */
function hostName(header: string | undefined): string {
    const match = /^(\[[^\]]*\]|[^:[\]]*)(?::\d*)?$/.exec(header?.toLowerCase() ?? "");
    return match?.[1] ?? "";
}

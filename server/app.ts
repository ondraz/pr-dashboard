import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { SessionIndex } from "./sessions.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface AppOptions {
    sessions: SessionIndex;
    /** Path of the page served at `/`. */
    indexHtml: string;
}

/**
 * The local server's routes. It answers only a loopback `Host`, so a site that rebinds its own
 * name to 127.0.0.1 gets nothing, and sends no CORS headers, so no other origin can read a response.
 */
export function createApp({ sessions, indexHtml }: AppOptions): Hono {
    const app = new Hono();

    app.use(async (c, next) => {
        if (!LOOPBACK_HOSTS.has(hostName(c.req.header("host")))) return c.text("Only served to localhost", 403);
        await next();
    });

    app.get("/sessions.json", async (c) => {
        c.header("Cache-Control", "no-store");
        return c.json(await sessions.read());
    });

    const page = async () =>
        new Response(await readFile(indexHtml), {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
        });
    app.get("/", page);
    app.get("/index.html", page);

    return app;
}

export function createHttpServer(app: Hono): Server {
    return createServer(getRequestListener(app.fetch));
}

/** The host name of a `Host` header without its port, or "" when it is missing or malformed. */
function hostName(header: string | undefined): string {
    const match = /^(\[[^\]]*\]|[^:[\]]*)(?::\d*)?$/.exec(header?.toLowerCase() ?? "");
    return match?.[1] ?? "";
}

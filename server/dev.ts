import { createServer, type IncomingMessage, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import { isLoopbackHost, SERVER_PATHS } from "./app.ts";

/** Under `make dev`, Vite answers everything but the server's own paths, and only to a loopback Host. */
export function servedByVite(req: Pick<IncomingMessage, "url" | "headers">): boolean {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    return isLoopbackHost(req.headers.host) && !SERVER_PATHS.has(path);
}

/**
 * The same server with Vite as middleware instead of the build, for hot reload on the same port.
 * Vite's dev page runs inline scripts for hot reload, so it is served without the CSP.
 */
export async function createDevServer(app: Hono): Promise<Server> {
    const { createServer: createViteServer } = await import("vite");
    const server = createServer();
    const vite = await createViteServer({
        configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
        server: { middlewareMode: { server } },
        appType: "spa",
    });
    const api = getRequestListener(app.fetch);
    server.on("request", (req, res) => {
        if (servedByVite(req)) vite.middlewares(req, res, () => api(req, res));
        else void api(req, res);
    });
    server.on("close", () => void vite.close());
    return server;
}

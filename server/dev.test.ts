import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { AuthService } from "./auth.ts";
import { createDevServer } from "./dev.ts";
import { SessionIndex } from "./sessions.ts";
import { TokenStore } from "./tokenStore.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const sessions = new SessionIndex(join(FIXTURES, "desktop"), join(FIXTURES, "projects"));

describe("createDevServer", () => {
    let server: Awaited<ReturnType<typeof createDevServer>>;
    let port: number;

    beforeAll(async () => {
        server = await createDevServer(
            createApp({
                sessions,
                auth: new AuthService({
                    clientId: null,
                    store: new TokenStore(join(tmpdir(), "pr-dashboard-unused.json")),
                }),
                webRoot: null,
            }),
        );
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        ({ port } = server.address() as AddressInfo);
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const get = (path: string, headers: Record<string, string>) =>
        new Promise<{ status: number | undefined; headers: Record<string, unknown> }>((resolve, reject) => {
            httpRequest({ host: "127.0.0.1", port, path, headers }, (res) => {
                res.resume();
                resolve({ status: res.statusCode, headers: res.headers });
            })
                .on("error", reject)
                .end();
        });

    it("serves the page through Vite with no CORS header for another local origin", async () => {
        const res = await get("/", { Host: `localhost:${port}`, Origin: "http://localhost:3000" });
        expect(res.status).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("keeps the server's own paths and the Host check", async () => {
        expect((await get("/sessions.json", { Host: `localhost:${port}` })).status).toBe(200);
        expect((await get("/auth/token", { Host: `localhost:${port}` })).status).toBe(404);
        expect((await get("/", { Host: "evil.example" })).status).toBe(403);
    });
});

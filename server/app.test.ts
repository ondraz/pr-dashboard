import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionsPayload } from "../shared/sessions.ts";
import { createApp, createHttpServer } from "./app.ts";
import { SessionIndex } from "./sessions.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const INDEX_HTML = fileURLToPath(new URL("../index.html", import.meta.url));

const app = createApp({
    sessions: new SessionIndex(join(FIXTURES, "desktop"), join(FIXTURES, "projects")),
    indexHtml: INDEX_HTML,
});

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
        expect(Object.keys(body)).toEqual(["made", "reviewed"]);
        expect(body.made["https://github.com/example-org/widgets/pull/1"]?.title).toBe("Add CSV export to widgets");
    });

    it.each(["/", "/index.html"])("serves the dashboard at %s", async (path) => {
        const res = await get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
        expect(await res.text()).toMatch(/^<!DOCTYPE html>/i);
    });

    it("answers HEAD without a body", async () => {
        const res = await get("/", "localhost:6789", { method: "HEAD" });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("");
    });

    it.each(["/README.md", "/server/main.ts", "/package.json", "/.git", "/index.htm"])(
        "serves nothing else, such as %s",
        async (path) => {
            expect((await get(path)).status).toBe(404);
        },
    );
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

import { describe, expect, it } from "vitest";
import { fetchSessions } from "./sessions.ts";

describe("fetchSessions", () => {
    it("maps PR URLs to the sessions the server reports", async () => {
        const session = { id: "local_1", title: "Gears", archived: false, lastActivityAt: 1 };
        const sessions = await fetchSessions(async (url) => {
            expect(url).toBe("/sessions.json");
            return Response.json({ made: { "https://github.com/acme/widgets/pull/1": session }, reviewed: {} });
        });
        expect(sessions.made.get("https://github.com/acme/widgets/pull/1")).toEqual(session);
        expect(sessions.reviewed.size).toBe(0);
    });

    it("is empty when the server cannot answer", async () => {
        const failed = await fetchSessions(async () => new Response("nope", { status: 403 }));
        expect(failed.made.size + failed.reviewed.size).toBe(0);
        const offline = await fetchSessions(async () => {
            throw new TypeError("Failed to fetch");
        });
        expect(offline.made.size).toBe(0);
    });
});

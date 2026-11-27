import { describe, expect, it } from "vitest";
import { fetchSessions, latestSession } from "./sessions.ts";

describe("fetchSessions", () => {
    it("maps PR URLs to the sessions the server reports, newest first", async () => {
        const newer = { id: "local_1", title: "Gears", archived: false, lastActivityAt: 2 };
        const older = { id: "local_2", title: "Gears, first try", archived: true, lastActivityAt: 1 };
        const url = "https://github.com/acme/widgets/pull/1";
        const sessions = await fetchSessions(async (request) => {
            expect(request).toBe("/sessions.json");
            return Response.json({ made: { [url]: [newer, older] }, reviewed: {} });
        });
        expect(sessions.made.get(url)).toEqual([newer, older]);
        expect(latestSession(sessions, "made", url)).toEqual(newer);
        expect(latestSession(sessions, "reviewed", url)).toBeUndefined();
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

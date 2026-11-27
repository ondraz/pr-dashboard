import { describe, expect, it } from "vitest";
import { reviewers } from "./reviewers.ts";

const review = (login: string, state: string) => ({
    state,
    author: { login, avatarUrl: `https://avatars.example/${login}` },
});

describe("reviewers", () => {
    it("lists each reviewer's latest review and every pending request", () => {
        expect(
            reviewers(
                [{ login: "dave" }, { name: "Gears", combinedSlug: "acme/gears" }],
                [review("bob", "APPROVED"), review("carol", "CHANGES_REQUESTED"), review("erin", "COMMENTED")],
            ).map((reviewer) => [reviewer.name, reviewer.state, reviewer.team]),
        ).toEqual([
            ["bob", "APPROVED", false],
            ["carol", "CHANGES_REQUESTED", false],
            ["erin", "COMMENTED", false],
            ["dave", "REQUESTED", false],
            ["acme/gears", "REQUESTED", true],
        ]);
    });

    it("shows a reviewer asked again as requested", () => {
        expect(reviewers([{ login: "carol" }], [review("carol", "CHANGES_REQUESTED")])).toEqual([
            { name: "carol", state: "REQUESTED", team: false, avatarUrl: "https://avatars.example/carol" },
        ]);
    });

    it("leaves out a pending review and a deleted account", () => {
        expect(reviewers([null], [review("alice", "PENDING"), { state: "APPROVED", author: null }])).toEqual([]);
    });
});

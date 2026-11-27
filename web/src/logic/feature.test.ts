import { describe, expect, it } from "vitest";
import { featureKey, stackTrailer } from "./feature.ts";

describe("featureKey", () => {
    it("prefers a Part-of line in the body over a ticket and the branch", () => {
        expect(
            featureKey("WID-12: add sprockets", "wid-12-sprockets", "Intro\n  Part-of:  Sprocket Rollout  \nMore"),
        ).toEqual({ key: "part-of:sprocket rollout", label: "Sprocket Rollout", kind: "declared" });
    });

    it("reads Part-of in any case", () => {
        expect(featureKey("t", "b", "PART-OF: thing")?.key).toBe("part-of:thing");
    });

    it("ignores Part-of that is not on its own line", () => {
        expect(featureKey("Fix", "fix-it", "this is part-of: nothing")?.kind).toBe("branch");
    });

    it("reads a ticket at the start of the title, upper-cased", () => {
        expect(featureKey("wid-12: add sprockets", "some-branch", "")).toEqual({
            key: "ticket:WID-12",
            label: "WID-12",
            kind: "ticket",
        });
    });

    it.each([
        ["wid-12-sprockets", "WID-12"],
        ["dev/wid-12-sprockets", "WID-12"],
        ["dev/wid-12", "WID-12"],
        ["wid-12.sprockets", "WID-12"],
        ["wid-12_sprockets", "WID-12"],
    ])("reads a ticket at the start of branch segment %j", (branch, ticket) => {
        expect(featureKey("Add sprockets", branch, null)?.label).toBe(ticket);
    });

    it("does not read a ticket from the middle of a title or branch segment", () => {
        expect(featureKey("Bump gizmo to v2-3", "bump-gizmo-v2-3", "")).toEqual({
            key: "branch:bump-gizmo-v2-3",
            label: "bump-gizmo-v2-3",
            kind: "branch",
        });
    });

    it.each([
        "UTF-8 handling",
        "GPT-4 prompts",
        "SHA-256 digests",
        "RFC-9110 headers",
        "HTTP-2 support",
        "node-24 upgrade",
    ])("never reads %j as a ticket", (title) => {
        expect(featureKey(title, "feature-x", "")?.kind).toBe("branch");
    });

    it("falls back from a blocked title prefix to a ticket in the branch", () => {
        expect(featureKey("UTF-8 handling", "wid-7-utf8", "")?.label).toBe("WID-7");
    });

    it.each(["main", "master", "Develop", "dev", "trunk", "release", "staging", "production"])(
        "never groups by the generic branch %j",
        (branch) => {
            expect(featureKey("Tidy up", branch, "")).toBeNull();
        },
    );

    it("returns null without a branch", () => {
        expect(featureKey("Tidy up", "", null)).toBeNull();
        expect(featureKey(null, undefined, undefined)).toBeNull();
    });
});

describe("stackTrailer", () => {
    it("reads a Stack line on its own, trimmed", () => {
        expect(stackTrailer("Body\n stack:   sprocket chain \n")).toBe("sprocket chain");
    });

    it("is null without one", () => {
        expect(stackTrailer("no stack here: really")).toBeNull();
        expect(stackTrailer(null)).toBeNull();
        expect(stackTrailer("Stack:   ")).toBeNull();
    });
});

import { describe, expect, it } from "vitest";
import { githubPrUrl, parsePrNumber, prRouteOf } from "./prRoute.ts";

describe("prRouteOf", () => {
    it("reads owner, repository and number from a PR's GitHub URL", () => {
        expect(prRouteOf("https://github.com/acme/widgets.js/pull/12")).toEqual({
            owner: "acme",
            repo: "widgets.js",
            number: 12,
        });
        expect(githubPrUrl({ owner: "acme", repo: "widgets.js", number: 12 })).toBe(
            "https://github.com/acme/widgets.js/pull/12",
        );
    });

    it.each([
        "https://github.com/acme/widgets/issues/12",
        "https://github.com/acme/widgets/pull/12/files",
        "https://github.example.com/acme/widgets/pull/12",
        "https://github.com/acme/widgets/pull/012",
    ])("does not route %s", (url) => {
        expect(prRouteOf(url)).toBeNull();
    });
});

describe("parsePrNumber", () => {
    it("takes positive integers only", () => {
        expect(parsePrNumber("7")).toBe(7);
        expect(parsePrNumber("0")).toBeNull();
        expect(parsePrNumber("7a")).toBeNull();
        expect(parsePrNumber("-7")).toBeNull();
    });
});

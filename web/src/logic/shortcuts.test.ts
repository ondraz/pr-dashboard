import { describe, expect, it } from "vitest";
import { currentIndex, stepIndex } from "./shortcuts.ts";

describe("stepIndex", () => {
    // Three targets: one scrolled past, one on the reading line, one below it.
    const tops = [-400, 12, 600];

    it("goes forwards to the first target below the reading line", () => {
        expect(stepIndex(tops, 1, 12)).toBe(2);
        expect(stepIndex([100, 200], 1, 12)).toBe(0);
    });

    it("goes backwards to the last target above it", () => {
        expect(stepIndex(tops, -1, 12)).toBe(0);
    });

    it("stops at either end", () => {
        expect(stepIndex([-800, -400], 1, 12)).toBeNull();
        expect(stepIndex([12, 600], -1, 12)).toBeNull();
        expect(stepIndex([], 1, 12)).toBeNull();
    });
});

describe("currentIndex", () => {
    it("is the last target that reached the reading line", () => {
        expect(currentIndex([-400, 12, 600], 12)).toBe(1);
        expect(currentIndex([-900, -400], 12)).toBe(1);
    });

    it("is the first target while none has reached it", () => {
        expect(currentIndex([100, 600], 12)).toBe(0);
        expect(currentIndex([], 12)).toBeNull();
    });
});

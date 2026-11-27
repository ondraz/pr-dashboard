import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter.ts";

describe("createLimiter", () => {
    it("never runs more than the limit at once and runs every task", async () => {
        const limit = createLimiter(2);
        let active = 0;
        let peak = 0;
        const results = await Promise.all(
            [1, 2, 3, 4, 5].map((n) =>
                limit(async () => {
                    active++;
                    peak = Math.max(peak, active);
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    active--;
                    return n * 10;
                }),
            ),
        );
        expect(results).toEqual([10, 20, 30, 40, 50]);
        expect(peak).toBe(2);
    });

    it("passes a failure to its caller and frees the slot", async () => {
        const limit = createLimiter(1);
        const failed = limit(() => {
            throw new Error("boom");
        });
        const next = limit(() => "ok");
        await expect(failed).rejects.toThrow("boom");
        await expect(next).resolves.toBe("ok");
    });

    it("starts tasks in the order they were queued", async () => {
        const limit = createLimiter(1);
        const order: number[] = [];
        await Promise.all([1, 2, 3].map((n) => limit(() => order.push(n))));
        expect(order).toEqual([1, 2, 3]);
    });
});

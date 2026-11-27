import { describe, expect, it, vi } from "vitest";
import { LiveCheck } from "./liveCheck.ts";

function setup(reads: string[], busy = () => false) {
    const onChange = vi.fn();
    const probe = vi.fn(async () => {
        const next = reads.shift();
        if (next === undefined) throw new Error("offline");
        return next;
    });
    return { check: new LiveCheck({ probe, busy, onChange }), probe, onChange };
}

describe("LiveCheck", () => {
    it("refreshes only when the fingerprint moves away from the baseline", async () => {
        const { check, onChange } = setup(["a", "b"]);
        check.setBaseline("a");
        await check.check();
        expect(onChange).not.toHaveBeenCalled();
        await check.check();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("takes its first read as the baseline when it has none", async () => {
        const { check, onChange } = setup(["a", "a", "b"]);
        await check.check();
        await check.check();
        expect(onChange).not.toHaveBeenCalled();
        await check.check();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("does not check while a refresh runs, nor twice at once", async () => {
        let busy = true;
        const { check, probe } = setup(["a", "b"], () => busy);
        await check.check();
        expect(probe).not.toHaveBeenCalled();
        busy = false;
        await Promise.all([check.check(), check.check()]);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it("leaves a refresh that started during the probe alone", async () => {
        let busy = false;
        const onChange = vi.fn();
        const check = new LiveCheck({
            probe: async () => {
                busy = true;
                return "b";
            },
            busy: () => busy,
            onChange,
        });
        check.setBaseline("a");
        await check.check();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("logs a failed probe and keeps going", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { check, onChange } = setup([]);
        check.setBaseline("a");
        await check.check();
        expect(onChange).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith("Live change check failed:", expect.any(Error));
        warn.mockRestore();
    });
});

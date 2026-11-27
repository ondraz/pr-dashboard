// @vitest-environment jsdom
import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DIFF_INLINE_STYLES } from "../../../shared/diffStyles.ts";
import { unifiedDiffText } from "../logic/diff.ts";

const HUNKS = [
    "@@ -1,4 +1,4 @@",
    "-const ratio = gearRatio(12, 36);",
    "+const ratio = gearRatio(12, 48);",
    '-export const name = "spur";',
    '+export const label = "spur";',
    "-let teeth = count;",
    "+let teeth = count * 2;",
    "-if (worn) replace();",
    "+if (worn && loose) replace();",
].join("\n");

beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({
        font: "",
        measureText: (text: string) => ({ width: text.length * 7 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});
afterEach(cleanup);

describe("the diff view's inline styles", () => {
    it.each([
        ["unified", DiffModeEnum.Unified, true],
        ["split", DiffModeEnum.SplitGitHub, true],
        ["plain", DiffModeEnum.Unified, false],
    ])("are all among the ones the CSP allows by hash (%s)", (_, mode, highlight) => {
        const diffFile = DiffFile.createInstance({
            oldFile: { fileName: "gears.ts" },
            newFile: { fileName: "gears.ts" },
            hunks: [unifiedDiffText("gears.ts", "gears.ts", HUNKS)],
        });
        diffFile.initTheme("light");
        diffFile.init();
        diffFile.buildSplitDiffLines();
        diffFile.buildUnifiedDiffLines();
        const { container } = render(
            <DiffView diffFile={diffFile} diffViewMode={mode} diffViewHighlight={highlight} />,
        );

        const styles = [...container.querySelectorAll("[data-template] [style]")].map(
            (element) => element.getAttribute("style") ?? "",
        );
        expect(styles.some((style) => style.includes("--diff-add-content-highlight--"))).toBe(true);
        expect(styles.some((style) => style.includes("--diff-del-content-highlight--"))).toBe(true);
        expect(styles.filter((style) => !DIFF_INLINE_STYLES.includes(style))).toEqual([]);
    });
});

import { describe, expect, it } from "vitest";
import { draftPrefix, parseTargetSlot, targetSlot } from "./drafts.ts";
import {
    type CommentTarget,
    insertBlock,
    lineTarget,
    patchLines,
    rangeStarts,
    submitBlocker,
    suggestionBlock,
    targetLabel,
} from "./review.ts";

// Two hunks: lines 1-3 and 10-12 on the old side become 1-4 and 11-13 on the new.
const PATCH = [
    "@@ -1,3 +1,4 @@",
    " const teeth = 12;",
    "-const ratio = 2;",
    "+const ratio = 3;",
    "+const spin = true;",
    " export { teeth };",
    "@@ -10,3 +11,3 @@ function turn() {",
    " turn();",
    "-stop();",
    "+halt();",
    " done();",
    "\\ No newline at end of file",
].join("\n");

describe("patchLines", () => {
    it("numbers each side's lines and remembers their hunk", () => {
        const lines = patchLines(PATCH);
        expect([...lines.LEFT].map(([n, at]) => [n, at.hunk, at.text])).toEqual([
            [1, 0, "const teeth = 12;"],
            [2, 0, "const ratio = 2;"],
            [3, 0, "export { teeth };"],
            [10, 1, "turn();"],
            [11, 1, "stop();"],
            [12, 1, "done();"],
        ]);
        expect([...lines.RIGHT].map(([n, at]) => [n, at.hunk, at.text])).toEqual([
            [1, 0, "const teeth = 12;"],
            [2, 0, "const ratio = 3;"],
            [3, 0, "const spin = true;"],
            [4, 0, "export { teeth };"],
            [11, 1, "turn();"],
            [12, 1, "halt();"],
            [13, 1, "done();"],
        ]);
    });
});

describe("line targets", () => {
    const lines = patchLines(PATCH);

    it("offers the earlier lines of the same hunk as a range's start", () => {
        expect(rangeStarts(lines, "RIGHT", 3)).toEqual([1, 2]);
        expect(rangeStarts(lines, "RIGHT", 12)).toEqual([11]);
        expect(rangeStarts(lines, "RIGHT", 7)).toEqual([]);
    });

    it("spans a range within one hunk, whichever end it was started from", () => {
        expect(lineTarget(lines, "a.ts", "RIGHT", 3, 2)).toEqual({
            subject: "line",
            path: "a.ts",
            side: "RIGHT",
            line: 3,
            startLine: 2,
        });
        expect(lineTarget(lines, "a.ts", "RIGHT", 2, 3)).toMatchObject({ line: 3, startLine: 2 });
        expect(lineTarget(lines, "a.ts", "LEFT", 2)).toMatchObject({ side: "LEFT", line: 2, startLine: null });
    });

    it("keeps only the line when the range crosses hunks, and refuses a line the patch does not show", () => {
        expect(lineTarget(lines, "a.ts", "RIGHT", 12, 3)).toMatchObject({ line: 12, startLine: null });
        expect(lineTarget(lines, "a.ts", "RIGHT", 7)).toBeNull();
    });

    it("suggests a change only on the new side, from the lines as they are", () => {
        const range: CommentTarget = { subject: "line", path: "a.ts", side: "RIGHT", line: 3, startLine: 2 };
        expect(suggestionBlock(lines, range)).toBe("```suggestion\nconst ratio = 3;\nconst spin = true;\n```");
        expect(suggestionBlock(lines, { ...range, side: "LEFT", startLine: null })).toBeNull();
        expect(suggestionBlock(lines, { subject: "file", path: "a.ts" })).toBeNull();
    });

    it("names what a comment is on", () => {
        expect(targetLabel({ subject: "line", path: "a.ts", side: "RIGHT", line: 3, startLine: 2 })).toBe(
            "lines 2 to 3 on the new side",
        );
        expect(targetLabel({ subject: "line", path: "a.ts", side: "LEFT", line: 2, startLine: null })).toBe(
            "line 2 on the old side",
        );
        expect(targetLabel({ subject: "file", path: "a.ts" })).toBe("this file");
    });
});

describe("insertBlock", () => {
    it("puts the block on lines of its own at the caret", () => {
        expect(insertBlock("", 0, "X")).toEqual({ text: "X\n", caret: 2 });
        expect(insertBlock("Try this:", 9, "X")).toEqual({ text: "Try this:\nX\n", caret: 12 });
        expect(insertBlock("a\nb", 2, "X")).toEqual({ text: "a\nX\nb", caret: 4 });
    });
});

describe("submitBlocker", () => {
    const empty = { body: "", pendingComments: 0, ownPr: false };

    it("needs something said for a comment or a request for changes, but not for an approval", () => {
        expect(submitBlocker("APPROVE", empty)).toBeNull();
        expect(submitBlocker("COMMENT", empty)).toBe("Write a summary or add a comment first.");
        expect(submitBlocker("REQUEST_CHANGES", empty)).toBe("Say what needs to change.");
        expect(submitBlocker("COMMENT", { ...empty, body: "Fine." })).toBeNull();
        expect(submitBlocker("REQUEST_CHANGES", { ...empty, pendingComments: 2 })).toBeNull();
    });

    it("turns away approving or asking for changes on your own PR", () => {
        const own = { body: "Done.", pendingComments: 1, ownPr: true };
        expect(submitBlocker("APPROVE", own)).toBe("You cannot approve your own pull request.");
        expect(submitBlocker("REQUEST_CHANGES", own)).toBe("You cannot request changes on your own pull request.");
        expect(submitBlocker("COMMENT", own)).toBeNull();
    });
});

describe("draft slots", () => {
    it("round-trip every target, paths with colons included", () => {
        const targets: CommentTarget[] = [
            { subject: "line", path: "src/a:b.ts", side: "RIGHT", line: 3, startLine: 2 },
            { subject: "line", path: "a.ts", side: "LEFT", line: 7, startLine: null },
            { subject: "file", path: "docs/x.md" },
        ];
        for (const target of targets) expect(parseTargetSlot(targetSlot(target))).toEqual(target);
        expect(parseTargetSlot("comment")).toBeNull();
        expect(parseTargetSlot("line:UP:1-2:a.ts")).toBeNull();
    });

    it("keep each PR's drafts apart", () => {
        expect(draftPrefix({ owner: "acme", repo: "widgets", number: 12 })).toBe("draft:acme/widgets#12:");
    });
});

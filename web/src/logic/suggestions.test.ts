import { describe, expect, it } from "vitest";
import {
    applySuggestions,
    OverlappingSuggestions,
    type Suggestion,
    type SuggestionSource,
    suggestedLines,
    suggestionHeadline,
    suggestionOf,
} from "./suggestions.ts";

const at = (startLine: number, line: number, lines: string[], path = "src/gears.ts"): Suggestion => ({
    commentId: `C_${startLine}`,
    threadId: `T_${startLine}`,
    path,
    startLine,
    line,
    lines,
});

describe("suggestedLines", () => {
    it("reads the one suggestion block in a comment", () => {
        expect(suggestedLines("Try this:\n```suggestion\nconst ratio = 4;\nconst spin = false;\n```\nThanks")).toEqual([
            "const ratio = 4;",
            "const spin = false;",
        ]);
        expect(suggestedLines("````suggestion\r\nuse ``` here\r\n````")).toEqual(["use ``` here"]);
        expect(suggestedLines("~~~ suggestion\nx\n~~~")).toEqual(["x"]);
    });

    it("tells a block that deletes the lines from one that blanks them", () => {
        expect(suggestedLines("```suggestion\n```")).toEqual([]);
        expect(suggestedLines("```suggestion\n\n```")).toEqual([""]);
    });

    it("finds nothing to commit without exactly one closed block", () => {
        expect(suggestedLines("Looks fine")).toBeNull();
        expect(suggestedLines("```ts\nconst a = 1;\n```")).toBeNull();
        expect(suggestedLines("```suggestion\na\n```\nor\n```suggestion\nb\n```")).toBeNull();
        expect(suggestedLines("```suggestion\nnever closed")).toBeNull();
    });
});

describe("suggestionOf", () => {
    const source: SuggestionSource = {
        threadId: "T_1",
        path: "src/gears.ts",
        subjectType: "LINE",
        diffSide: "RIGHT",
        startDiffSide: "RIGHT",
        line: 3,
        startLine: 2,
        isOutdated: false,
        isResolved: false,
        comment: { id: "C_1", body: "```suggestion\nconst ratio = 4;\n```", state: "SUBMITTED" },
    };

    it("takes a submitted suggestion on current lines of the new side", () => {
        expect(suggestionOf(source)).toEqual({
            commentId: "C_1",
            threadId: "T_1",
            path: "src/gears.ts",
            startLine: 2,
            line: 3,
            lines: ["const ratio = 4;"],
        });
        expect(suggestionOf({ ...source, startLine: null, startDiffSide: null })?.startLine).toBe(3);
    });

    it("leaves out what GitHub would not commit", () => {
        expect(suggestionOf({ ...source, isOutdated: true, line: null })).toBeNull();
        expect(suggestionOf({ ...source, isResolved: true })).toBeNull();
        expect(suggestionOf({ ...source, diffSide: "LEFT" })).toBeNull();
        expect(suggestionOf({ ...source, startDiffSide: "LEFT" })).toBeNull();
        expect(suggestionOf({ ...source, subjectType: "FILE" })).toBeNull();
        expect(suggestionOf({ ...source, comment: { ...source.comment, state: "PENDING" } })).toBeNull();
        expect(suggestionOf({ ...source, comment: { ...source.comment, body: "No change here" } })).toBeNull();
    });
});

describe("applySuggestions", () => {
    const file = "one\ntwo\nthree\nfour\nfive\n";

    it("replaces each suggestion's lines, however many it brings", () => {
        expect(applySuggestions(file, [at(2, 3, ["TWO-THREE"]), at(5, 5, ["FIVE", "SIX"])])).toBe(
            "one\nTWO-THREE\nfour\nFIVE\nSIX\n",
        );
        expect(applySuggestions(file, [at(1, 1, [])])).toBe("two\nthree\nfour\nfive\n");
        expect(applySuggestions(file, [at(4, 4, [""])])).toBe("one\ntwo\nthree\n\nfive\n");
    });

    it("keeps the file's line endings and whether it ends with one", () => {
        expect(applySuggestions("a\r\nb\r\nc", [at(2, 2, ["B"])])).toBe("a\r\nB\r\nc");
    });

    it("refuses suggestions on the same lines, or on lines the file does not have", () => {
        expect(() => applySuggestions(file, [at(2, 3, ["x"]), at(3, 4, ["y"])])).toThrow(OverlappingSuggestions);
        expect(() => applySuggestions(file, [at(5, 6, ["x"])])).toThrow(RangeError);
    });
});

describe("suggestionHeadline", () => {
    it("names the file for one suggestion, as GitHub does", () => {
        expect(suggestionHeadline([at(2, 2, ["x"])])).toBe("Update gears.ts");
        expect(suggestionHeadline([at(2, 2, ["x"]), at(4, 4, ["y"])])).toBe("Apply suggestions from code review");
    });
});

import { describe, expect, it } from "vitest";
import { hideWhitespace } from "./whitespace.ts";

const patch = (...lines: string[]) => lines.join("\n");

describe("hideWhitespace", () => {
    it("leaves nothing when only the indentation changed", () => {
        const reindented = patch(
            "@@ -1,5 +1,5 @@",
            " function spin() {",
            "-  return 1;",
            "-  // done",
            "+    return 1;",
            "+\t// done",
            " }",
            " export {};",
        );
        expect(hideWhitespace(reindented)).toBe("");
    });

    it("shows a line whose change was only whitespace as it is now, keeping the real changes", () => {
        const mixed = patch(
            "@@ -10,4 +10,4 @@ class Gear",
            " const teeth = 12;",
            "-const  ratio = 2;",
            "-  spin();",
            "+const ratio = 3;",
            "+spin();",
            " export { teeth };",
        );
        expect(hideWhitespace(mixed)).toBe(
            patch(
                "@@ -10,4 +10,4 @@ class Gear",
                " const teeth = 12;",
                "-const  ratio = 2;",
                "+const ratio = 3;",
                " spin();",
                " export { teeth };",
            ),
        );
    });

    it("cuts a hunk down to three lines of context around what still changes", () => {
        const lines = Array.from({ length: 20 }, (_, n) => `line ${n + 1};`);
        const long = patch(
            "@@ -1,20 +1,20 @@",
            ...lines.slice(0, 1).map((line) => ` ${line}`),
            `-${lines[1]}`,
            `+    ${lines[1]}`,
            ...lines.slice(2, 16).map((line) => ` ${line}`),
            `-${lines[16]}`,
            "+line seventeen;",
            ...lines.slice(17).map((line) => ` ${line}`),
        );
        expect(hideWhitespace(long)).toBe(
            patch(
                "@@ -14,7 +14,7 @@",
                " line 14;",
                " line 15;",
                " line 16;",
                "-line 17;",
                "+line seventeen;",
                " line 18;",
                " line 19;",
                " line 20;",
            ),
        );
    });

    it("drops a hunk with only whitespace changes and keeps the others where they were", () => {
        const two = patch(
            "@@ -3,3 +3,3 @@ one",
            " a();",
            "-b( );",
            "+b();",
            " c();",
            "@@ -40,3 +40,4 @@ two",
            " x();",
            "+y();",
            " z();",
            " w();",
        );
        expect(hideWhitespace(two)).toBe(patch("@@ -40,3 +40,4 @@ two", " x();", "+y();", " z();", " w();"));
    });

    it("still shows blank lines added or removed, as git diff -w does", () => {
        expect(hideWhitespace(patch("@@ -1,2 +1,3 @@", " a();", "+", " b();"))).toBe(
            patch("@@ -1,2 +1,3 @@", " a();", "+", " b();"),
        );
    });

    it("keeps a new file's hunk as it is", () => {
        const added = patch("@@ -0,0 +1,2 @@", "+one", "+two", "\\ No newline at end of file");
        expect(hideWhitespace(added)).toBe(patch("@@ -0,0 +1,2 @@", "+one", "+two"));
    });

    it("keeps a deletion at the end of a file", () => {
        const removed = patch("@@ -4,3 +3,0 @@", "-x", "-y", "-z");
        expect(hideWhitespace(removed)).toBe(removed);
    });
});

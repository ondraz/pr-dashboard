import { describe, expect, it } from "vitest";
import {
    buildFileTree,
    type ChangedFile,
    fileAnchor,
    filterFiles,
    isLargeDiff,
    needsRawDiff,
    patchIsComplete,
    rawSectionOf,
    splitRawDiff,
    treeOrder,
    unifiedDiffText,
} from "./diff.ts";

const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({
    path,
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-old\n+new",
    ...extra,
});

describe("patchIsComplete", () => {
    it("accepts a patch whose lines add up to the file's counts", () => {
        expect(patchIsComplete(file("a.ts"))).toBe(true);
        // A deleted line that itself starts with dashes is still one deletion.
        expect(
            patchIsComplete(
                file("a.md", {
                    additions: 1,
                    deletions: 2,
                    patch: "@@ -1,3 +1,2 @@\n keep\n--- rule\n-gone\n+new\n\\ No newline at end of file",
                }),
            ),
        ).toBe(true);
    });

    it("refuses a patch GitHub cut short or left out", () => {
        expect(patchIsComplete(file("a.ts", { additions: 900 }))).toBe(false);
        expect(patchIsComplete(file("a.ts", { patch: null }))).toBe(false);
    });

    it("needs no patch for a file without changed lines", () => {
        expect(patchIsComplete(file("logo.png", { patch: null, additions: 0, deletions: 0 }))).toBe(true);
        expect(needsRawDiff(file("logo.png", { patch: null, additions: 0, deletions: 0 }))).toBe(false);
        expect(needsRawDiff(file("big.json", { patch: null, additions: 5000, deletions: 0 }))).toBe(true);
    });
});

describe("isLargeDiff", () => {
    it("holds back a diff of more than 400 changed lines", () => {
        expect(isLargeDiff({ additions: 200, deletions: 200 })).toBe(false);
        expect(isLargeDiff({ additions: 201, deletions: 200 })).toBe(true);
    });
});

const RAW = [
    "diff --git a/src/gears.ts b/src/gears.ts",
    "index 1111111..2222222 100644",
    "--- a/src/gears.ts",
    "+++ b/src/gears.ts",
    "@@ -1,2 +1,2 @@",
    " const teeth = 12;",
    "-const ratio = 2;",
    "+const ratio = 3;",
    "diff --git a/docs/old name.md b/docs/new name.md",
    "similarity index 90%",
    "rename from docs/old name.md",
    "rename to docs/new name.md",
    "index 3333333..4444444 100644",
    "--- a/docs/old name.md\t",
    "+++ b/docs/new name.md\t",
    "@@ -4 +4 @@",
    "-Old line",
    "+New line",
    "diff --git a/logo.png b/logo.png",
    "new file mode 100644",
    "index 0000000..5555555",
    "Binary files /dev/null and b/logo.png differ",
    'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
    "deleted file mode 100644",
    "index 6666666..0000000",
    '--- "a/caf\\303\\251.txt"',
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-espresso",
    "diff --git a/run.sh b/run.sh",
    "old mode 100644",
    "new mode 100755",
    "",
].join("\n");

describe("splitRawDiff", () => {
    const sections = splitRawDiff(RAW);

    it("cuts a raw diff into its files, each with its hunks", () => {
        expect(sections.map((section) => [section.oldPath, section.newPath])).toEqual([
            ["src/gears.ts", "src/gears.ts"],
            ["docs/old name.md", "docs/new name.md"],
            ["logo.png", "logo.png"],
            ["café.txt", "café.txt"],
            ["run.sh", "run.sh"],
        ]);
        expect(sections[0]?.hunks).toBe("@@ -1,2 +1,2 @@\n const teeth = 12;\n-const ratio = 2;\n+const ratio = 3;");
        expect(sections[3]?.hunks).toBe("@@ -1 +0,0 @@\n-espresso");
    });

    it("marks binary files and leaves a mode change without hunks", () => {
        expect(sections[2]).toMatchObject({ binary: true, hunks: null });
        expect(sections[4]).toMatchObject({ binary: false, hunks: null });
    });

    it("finds a file's section by its path, and by its old path for a rename", () => {
        const renamed = file("docs/new name.md", { status: "renamed", previousPath: "docs/old name.md" });
        expect(rawSectionOf(sections, renamed)?.hunks).toBe("@@ -4 +4 @@\n-Old line\n+New line");
        expect(rawSectionOf(sections, { ...renamed, previousPath: "docs/other.md" })).toBeUndefined();
        expect(rawSectionOf(sections, file("src/gears.ts"))?.newPath).toBe("src/gears.ts");
    });
});

describe("unifiedDiffText", () => {
    it("puts the file lines the diff view needs before the hunks", () => {
        expect(unifiedDiffText("a.ts", "b.ts", "@@ -1 +1 @@\n-x\n+y\n")).toBe(
            "--- a/a.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n",
        );
    });
});

describe("buildFileTree", () => {
    const files = [
        file("web/src/detail/FilesTab.tsx"),
        file("web/src/detail/FileDiff.tsx"),
        file("README.md"),
        file("web/src/logic/diff.ts"),
        file("Makefile"),
    ];

    it("folds directories that only hold one directory and lists directories first", () => {
        const tree = buildFileTree(files);
        expect(tree.map((node) => node.name)).toEqual(["web/src", "Makefile", "README.md"]);
        const src = tree[0];
        expect(src?.path).toBe("web/src");
        expect(src?.children.map((node) => node.name)).toEqual(["detail", "logic"]);
        expect(src?.children[0]?.children.map((node) => node.name)).toEqual(["FileDiff.tsx", "FilesTab.tsx"]);
    });

    it("orders the diffs as the tree lists the files", () => {
        expect(treeOrder(buildFileTree(files)).map((entry) => entry.path)).toEqual([
            "web/src/detail/FileDiff.tsx",
            "web/src/detail/FilesTab.tsx",
            "web/src/logic/diff.ts",
            "Makefile",
            "README.md",
        ]);
    });

    it("keeps a file and a directory of the same name apart", () => {
        const tree = buildFileTree([file("docs"), file("docs/index.md"), file("docs/guide.md")]);
        expect(tree.map((node) => [node.name, !!node.file])).toEqual([
            ["docs", false],
            ["docs", true],
        ]);
    });
});

describe("filterFiles", () => {
    const files = [
        file("web/src/FilesTab.tsx"),
        file("server/app.ts"),
        file("docs/new.md", { status: "renamed", previousPath: "docs/old.md" }),
    ];

    it("keeps the files whose path has every word, ignoring case", () => {
        expect(filterFiles(files, "  ").length).toBe(3);
        expect(filterFiles(files, "WEB tab").map((entry) => entry.path)).toEqual(["web/src/FilesTab.tsx"]);
        expect(filterFiles(files, ".ts").map((entry) => entry.path)).toEqual(["web/src/FilesTab.tsx", "server/app.ts"]);
    });

    it("matches a renamed file on its old path too", () => {
        expect(filterFiles(files, "old.md").map((entry) => entry.path)).toEqual(["docs/new.md"]);
    });
});

describe("fileAnchor", () => {
    it("gives every path its own id", () => {
        expect(fileAnchor("a b/c.ts")).toBe("diff-a%20b%2Fc.ts");
        expect(fileAnchor("ab/c.ts")).not.toBe(fileAnchor("a/bc.ts"));
    });
});

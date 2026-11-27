import { describe, expect, it } from "vitest";
import { checkAnnotation, checkRun, reviewThread, statusContext } from "../github/prFixtures.ts";
import { fixPrompt, type PromptPr, promptThreads, reviewPrompt } from "./agentPrompt.ts";
import { type CheckEntry, normalizeCheck } from "./checks.ts";

const pr: PromptPr = {
    owner: "acme",
    repo: "widgets",
    number: 12,
    url: "https://github.com/acme/widgets/pull/12",
    title: "Turn the gears",
    baseRefName: "mid",
    headRefName: "tip",
    headRefOid: "c0ffee00c0ffee",
};

const entries = (...nodes: Parameters<typeof normalizeCheck>[0][]) => nodes.map(normalizeCheck) as CheckEntry[];

const checks = entries(
    checkRun("test", "FAILURE", { title: "1 test failed", summary: "gears.test.ts\nturns once" }, [
        checkAnnotation("src/gears.ts", 12, "Expected 3 to be 4"),
        checkAnnotation("src/gears.ts", 20, "Slow test", { annotationLevel: "NOTICE" }),
    ]),
    checkRun("lint", "SUCCESS"),
    statusContext("deploy", "ERROR"),
);

const threads = promptThreads([
    reviewThread("T_1", "PRR_1", [
        { login: "bob", bodyHTML: "<p>Why 3?</p>" },
        { login: "alice", bodyHTML: "<p>It meshes.</p>" },
        { login: "alice", bodyHTML: "<p>Not sent yet.</p>", pending: true },
    ]),
    reviewThread("T_2", "PRR_1", [{ login: "bob", bodyHTML: "<p>Typo.</p>" }], { isResolved: true }),
    reviewThread("T_3", "PRR_3", [{ login: "alice", bodyHTML: "<p>My own draft.</p>", pending: true }]),
    reviewThread("T_4", "PRR_1", [{ login: "carol", bodyHTML: "<p>Was 2.</p>" }], {
        isOutdated: true,
        line: null,
        originalLine: 8,
        startLine: null,
        originalStartLine: 6,
    }),
]);

describe("promptThreads", () => {
    it("keeps the unresolved threads others can see, without anyone's unsent comments", () => {
        expect(threads).toEqual([
            {
                path: "src/gears.ts",
                line: 12,
                startLine: null,
                outdated: false,
                url: "https://github.com/acme/widgets/pull/12#discussion_r0",
                comments: [
                    { author: "bob", body: "Why 3?" },
                    { author: "alice", body: "It meshes." },
                ],
            },
            {
                path: "src/gears.ts",
                line: 8,
                startLine: 6,
                outdated: true,
                url: "https://github.com/acme/widgets/pull/12#discussion_r0",
                comments: [{ author: "carol", body: "Was 2." }],
            },
        ]);
    });
});

describe("fixPrompt", () => {
    it("names the PR, the failing checks with their logs and annotations, and the unresolved threads", () => {
        const copilot = {
            id: "PRR_9",
            databaseId: 9,
            label: "Changes recommended",
            owing: true,
            url: "https://github.com/acme/widgets/pull/12#pullrequestreview-9",
        };
        expect(fixPrompt({ pr, checks, threads, copilot })).toBe(
            [
                'Fix pull request acme/widgets#12, "Turn the gears": https://github.com/acme/widgets/pull/12',
                "It merges `tip` into `mid`; the head commit is c0ffee0.",
                "",
                "Failing checks:",
                "- CI / test (failure): 1 test failed",
                "  Log: gh run view --job 4004 --log-failed --repo acme/widgets",
                "  Summary: gears.test.ts",
                "    turns once",
                "  - src/gears.ts:12: Expected 3 to be 4",
                "- deploy (error): deploy says error",
                "  Details: https://ci.example.com/deploy",
                "",
                "Unresolved review threads:",
                "- src/gears.ts:12 (https://github.com/acme/widgets/pull/12#discussion_r0)",
                "  bob: Why 3?",
                "  alice: It meshes.",
                "- src/gears.ts:6-8 (outdated, https://github.com/acme/widgets/pull/12#discussion_r0)",
                "  carol: Was 2.",
                "- Copilot's latest review asks for changes without inline comments: Changes recommended (https://github.com/acme/widgets/pull/12#pullrequestreview-9)",
                "",
                "Make the failing checks pass and address the unresolved review threads.",
                "Work on the branch `tip`, commit the fixes and push them to it. Where a review comment needs no change, say why instead of changing the code.",
            ].join("\n"),
        );
    });

    it("asks only for what is owed", () => {
        const passing = entries(checkRun("lint", "SUCCESS"));
        expect(fixPrompt({ pr, checks, threads: [], copilot: null })).toContain("\nMake the failing checks pass.\n");
        expect(fixPrompt({ pr, checks: passing, threads, copilot: null })).toContain(
            "\nAddress the unresolved review threads.\n",
        );
        const nothing = fixPrompt({ pr, checks: passing, threads: [], copilot: null });
        expect(nothing).not.toContain("Failing checks");
        expect(nothing).toContain("No check is failing and no review thread is open");
    });

    it("cuts a long comment short", () => {
        const long = promptThreads([reviewThread("T_9", "PRR_1", [{ login: "bob", bodyHTML: "x".repeat(2000) }])]);
        const prompt = fixPrompt({ pr, checks: [], threads: long, copilot: null });
        expect(prompt).toContain(`  bob: ${"x".repeat(1500)} [...]\n`);
    });
});

describe("reviewPrompt", () => {
    it("starts from the last review, names the failing checks and asks whether threads were addressed", () => {
        const prompt = reviewPrompt({ pr, checks, threads, copilot: null, lastReviewedOid: "bbbbbbb2222" });
        expect(prompt.split("\n").slice(0, 7)).toEqual([
            'Review pull request acme/widgets#12, "Turn the gears": https://github.com/acme/widgets/pull/12',
            "It merges `tip` into `mid`; the head commit is c0ffee0.",
            "",
            "The last review was at bbbbbbb; start with what changed since: git diff bbbbbbb..c0ffee0",
            "",
            "Failing checks:",
            "- CI / test (failure): 1 test failed",
        ]);
        // The reviewer reads the checks for themselves; only their names go in.
        expect(prompt).not.toContain("gh run view");
        expect(prompt).toContain(
            "Read the change with `gh pr diff 12 --repo acme/widgets` and the code around it. Check whether each unresolved thread has been addressed.",
        );
    });

    it("reviews the whole change when there was no review, or it was of the head commit", () => {
        const fresh = reviewPrompt({ pr, checks: [], threads: [], copilot: null, lastReviewedOid: null });
        expect(fresh).not.toContain("last review");
        expect(fresh).not.toContain("Check whether each unresolved thread");
        expect(reviewPrompt({ pr, checks: [], threads: [], copilot: null, lastReviewedOid: pr.headRefOid })).toBe(
            fresh,
        );
    });
});

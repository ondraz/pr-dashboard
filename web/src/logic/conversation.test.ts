import { describe, expect, it } from "vitest";
import { pullCommit, reviewThread, timeline } from "../github/prFixtures.ts";
import {
    buildConversation,
    commentExcerpt,
    hunkTail,
    openThreads,
    threadLines,
    unresolvedOnly,
    withCommits,
} from "./conversation.ts";

describe("buildConversation", () => {
    it("keeps the timeline order and folds commits pushed in a row into one entry", () => {
        const items = buildConversation(
            [
                timeline.reviewRequested("RR_1", "bob"),
                timeline.commit("aaaaaaa1", "Cut the teeth"),
                timeline.commit("bbbbbbb2", "Oil the axle"),
                timeline.comment("IC_1", "bob", "<p>Nice.</p>"),
                timeline.commit("ccccccc3", "Fix the axle"),
                timeline.forcePush("FP_1", "ccccccc", "ddddddd"),
            ],
            [],
        );
        expect(items.map((item) => item.kind)).toEqual(["event", "commits", "comment", "commits", "event"]);
        const commits = items[1];
        expect(commits?.kind === "commits" && commits.commits.map((commit) => commit.messageHeadline)).toEqual([
            "Cut the teeth",
            "Oil the axle",
        ]);
    });

    it("hangs each thread off the review that started it, replies included", () => {
        const thread = reviewThread("T_1", "PRR_1", [
            { login: "bob", bodyHTML: "<p>Why 3?</p>" },
            { login: "alice", bodyHTML: "<p>It meshes.</p>", reviewId: "PRR_2" },
        ]);
        const items = buildConversation(
            [timeline.review("PRR_1", "bob", "CHANGES_REQUESTED"), timeline.review("PRR_2", "alice", "COMMENTED")],
            [thread],
        );
        // alice's reply is its own review with nothing else in it, so it shows in the thread only.
        expect(items).toEqual([
            { kind: "review", review: expect.objectContaining({ id: "PRR_1" }), threads: [thread] },
        ]);
    });

    it("shows a review with a body or a verdict even without threads", () => {
        const items = buildConversation(
            [
                timeline.review("PRR_1", "bob", "APPROVED"),
                timeline.review("PRR_2", "carol", "COMMENTED", "<p>One question.</p>"),
                timeline.review("PRR_3", "dave", "COMMENTED", "  "),
            ],
            [],
        );
        expect(items.map((item) => item.kind === "review" && item.review.id)).toEqual(["PRR_1", "PRR_2"]);
    });

    it("leaves the viewer's pending review and its threads out", () => {
        const items = buildConversation(
            [timeline.review("PRR_9", "alice", "PENDING", "<p>Draft</p>")],
            [reviewThread("T_9", "PRR_9", [{ login: "alice", bodyHTML: "<p>Draft note</p>" }])],
        );
        expect(items).toEqual([]);
    });

    it("leaves out a pending thread even when its review is not in the timeline read", () => {
        const pending = reviewThread("T_9", "PRR_9", [{ login: "alice", bodyHTML: "<p>Draft.</p>", pending: true }]);
        expect(buildConversation([], [pending])).toEqual([]);
    });

    it("lists threads whose review is not in the timeline after it", () => {
        const stray = reviewThread("T_2", "PRR_gone", [{ login: "bob", bodyHTML: "<p>Hm</p>" }]);
        const items = buildConversation([timeline.comment("IC_1", "bob", "<p>Hi</p>")], [stray]);
        expect(items.at(-1)).toEqual({ kind: "threads", threads: [stray] });
    });
});

describe("unresolvedOnly", () => {
    const open = reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why 3?</p>" }]);
    const resolved = reviewThread("T_2", "PRR_1", [{ login: "bob", bodyHTML: "<p>Typo</p>" }], { isResolved: true });
    const settled = reviewThread("T_3", "PRR_2", [{ login: "carol", bodyHTML: "<p>Rename</p>" }], {
        isResolved: true,
    });
    const stray = reviewThread("T_4", "PRR_gone", [{ login: "dave", bodyHTML: "<p>Hm</p>" }]);
    const items = buildConversation(
        [
            timeline.comment("IC_1", "bob", "<p>Hi</p>"),
            timeline.review("PRR_1", "bob", "CHANGES_REQUESTED"),
            timeline.commit("aaaaaaa1", "Fix it"),
            timeline.review("PRR_2", "carol", "COMMENTED"),
            timeline.review("PRR_3", "copilot-pull-request-reviewer", "COMMENTED", "<p>Changes recommended</p>"),
        ],
        [open, resolved, settled, stray],
    );

    it("keeps only the reviews with unresolved threads, and only those threads", () => {
        expect(unresolvedOnly(items, null)).toEqual([
            { kind: "review", review: expect.objectContaining({ id: "PRR_1" }), threads: [open] },
            { kind: "threads", threads: [stray] },
        ]);
    });

    it("keeps the review holding a standing verdict, though it has no thread", () => {
        expect(unresolvedOnly(items, "PRR_3").map((item) => item.kind === "review" && item.review.id)).toEqual([
            "PRR_1",
            "PRR_3",
            false,
        ]);
    });
});

describe("hunkTail", () => {
    it("keeps the last lines of the hunk without its header, marked by kind", () => {
        expect(hunkTail("@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e", 3)).toEqual([
            { text: "+c", kind: "add" },
            { text: "+d", kind: "add" },
            { text: " e", kind: "context" },
        ]);
        expect(hunkTail("@@ -1 +1 @@\n-b")).toEqual([{ text: "-b", kind: "del" }]);
    });
});

describe("withCommits", () => {
    const at = (oid: string, headline: string, committedDate: string) => ({
        ...pullCommit(oid, headline),
        committedDate,
    });

    it("places the commits the timeline lacks among its entries by commit date, in a row where they meet", () => {
        const merged = withCommits(
            [
                timeline.reviewRequested("RR_1", "bob"), // 2026-11-25T08:00
                timeline.comment("IC_1", "bob", "<p>Nice.</p>"), // 2026-11-25T10:00
            ],
            [
                at("ccccccc3", "Fix the axle", "2026-11-26T09:00:00Z"),
                at("aaaaaaa1", "Cut the teeth", "2026-11-24T09:00:00Z"),
                at("bbbbbbb2", "Oil the axle", "2026-11-25T09:00:00Z"),
            ],
        );
        expect(
            merged.map((node) =>
                node.__typename === "PullRequestCommit" ? node.commit.oid : "id" in node ? node.id : node.__typename,
            ),
        ).toEqual(["aaaaaaa1", "RR_1", "bbbbbbb2", "IC_1", "ccccccc3"]);
        const kinds = buildConversation(merged, []).map((item) => item.kind);
        expect(kinds).toEqual(["commits", "event", "commits", "comment", "commits"]);
    });

    it("leaves out commits the timeline already shows", () => {
        const shown = timeline.commit("aaaaaaa1", "Cut the teeth");
        const merged = withCommits([shown], [pullCommit("aaaaaaa1", "Cut the teeth")]);
        expect(merged).toEqual([shown]);
    });
});

describe("the side panel's unresolved list", () => {
    it("keeps threads that are neither resolved nor in the viewer's unsent review", () => {
        const open = reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why?</p>" }]);
        const resolved = reviewThread("T_2", "PRR_1", [{ login: "bob", bodyHTML: "<p>Ok.</p>" }], { isResolved: true });
        const pending = reviewThread("T_3", "PRR_2", [{ login: "alice", bodyHTML: "<p>Draft.</p>", pending: true }]);
        expect(openThreads([open, resolved, pending]).map((thread) => thread.id)).toEqual(["T_1"]);
    });

    it("names the lines a thread is on, and nothing for a comment on the whole file", () => {
        const thread = reviewThread("T_1", "PRR_1", [{ login: "bob", bodyHTML: "<p>Why?</p>" }]);
        expect(threadLines({ ...thread, startLine: 10, line: 12 })).toBe(":10-12");
        expect(threadLines({ ...thread, startLine: null, line: null, originalLine: 7 })).toBe(":7");
        expect(threadLines({ ...thread, subjectType: "FILE" })).toBe("");
    });

    it("shortens a comment to one plain line", () => {
        expect(commentExcerpt("**Why** `3`?\n\n```ts\nconst b = 3;\n```\nIt <b>meshes</b>.")).toBe("Why 3? It meshes.");
        expect(commentExcerpt("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
        expect(commentExcerpt("> Pass `chart_file_store` to _build_deps in agent_cli.py, _please_.")).toBe(
            "Pass chart_file_store to build_deps in agent_cli.py, please.",
        );
    });
});

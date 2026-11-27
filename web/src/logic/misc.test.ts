import { describe, expect, it } from "vitest";
import type { PrSession } from "../../../shared/sessions.ts";
import { ChangeFingerprint, type ProbeData, type PrProbe, prFingerprint } from "./fingerprint.ts";
import { labelColor } from "./labels.ts";
import { RefreshProgress } from "./progress.ts";
import { LINK_PROMPT_LIMIT, newSessionLinks, resumeLink, sessionLink } from "./sessionLinks.ts";
import { tabSearches } from "./tabs.ts";
import { timeAgo } from "./time.ts";

describe("timeAgo", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    it.each([
        ["2026-11-27T11:59:30Z", "just now"],
        ["2026-11-27T11:55:00Z", "5m ago"],
        ["2026-11-27T09:00:00Z", "3h ago"],
        ["2026-11-20T12:00:00Z", "7d ago"],
        ["2026-08-27T12:00:00Z", "3mo ago"],
    ])("%s is %s", (date, expected) => {
        expect(timeAgo(date, now)).toBe(expected);
    });
});

describe("labelColor", () => {
    it.each([
        ["bug", "hsl(348, 50%, 30%)"],
        ["enhancement", "hsl(332, 50%, 30%)"],
        ["a-really-long-label-name-for-testing", "hsl(206, 50%, 30%)"],
    ])("keeps %j at %s", (name, color) => {
        expect(labelColor(name)).toBe(color);
    });
});

describe("sessionLink", () => {
    const desktop: PrSession = {
        id: "local_11111111-1111-4111-8111-111111111111",
        title: "Add gears",
        archived: false,
        lastActivityAt: 0,
    };

    it("opens a desktop session in the Claude app", () => {
        expect(sessionLink(desktop, "made")).toEqual({
            href: "claude://claude.ai/epitaxy/local_11111111-1111-4111-8111-111111111111",
            app: "Claude",
            title: "Open the Claude session that made this PR: Add gears",
            archived: false,
        });
    });

    it("opens a CLI session in VS Code and says it is archived", () => {
        const link = sessionLink(
            { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "cli", title: "", archived: true, lastActivityAt: 0 },
            "reviewed",
        );
        expect(link).toEqual({
            href: "vscode://anthropic.claude-code/open?session=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            app: "VS Code",
            title: "Open the Claude session that reviewed this PR in VS Code (archived)",
            archived: true,
        });
    });

    it("refuses an id that fits neither app", () => {
        expect(sessionLink({ ...desktop, id: "local_x;y" }, "made")).toBeNull();
        expect(sessionLink({ ...desktop, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, "made")).toBeNull();
        expect(sessionLink(undefined, "made")).toBeNull();
    });
});

describe("prompt links", () => {
    const desktop: PrSession = {
        id: "local_11111111-1111-4111-8111-111111111111",
        title: "",
        archived: false,
        lastActivityAt: 0,
    };
    const cli: PrSession = { ...desktop, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "cli" };

    it("hands either app's session the prompt in its link", () => {
        expect(resumeLink(cli, "made", "Fix #12 & push")).toMatchObject({
            href: "vscode://anthropic.claude-code/open?session=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&prompt=Fix%20%2312%20%26%20push",
            carriesPrompt: true,
        });
        expect(resumeLink(desktop, "made", "Fix #12")).toMatchObject({
            href: "claude://claude.ai/epitaxy/local_11111111-1111-4111-8111-111111111111?q=Fix%20%2312",
            carriesPrompt: true,
        });
        expect(resumeLink({ ...desktop, id: "local_x;y" }, "made", "Fix")).toBeNull();
    });

    it("starts a new session with the prompt in either app", () => {
        expect(newSessionLinks("Fix #12")).toEqual([
            { app: "Claude", href: "claude://code/new?q=Fix%20%2312", carriesPrompt: true },
            { app: "VS Code", href: "vscode://anthropic.claude-code/open?prompt=Fix%20%2312", carriesPrompt: true },
        ]);
    });

    it("opens a new desktop session in the repository's checkout when one is known", () => {
        expect(newSessionLinks("Fix #12", "/work/widgets")[0]?.href).toBe(
            "claude://code/new?q=Fix%20%2312&folder=%2Fwork%2Fwidgets",
        );
        expect(newSessionLinks("x".repeat(LINK_PROMPT_LIMIT + 1), "/work/widgets")[0]?.href).toBe(
            "claude://code/new?folder=%2Fwork%2Fwidgets",
        );
    });

    it("leaves a prompt too long for a link to be pasted", () => {
        const long = "x".repeat(LINK_PROMPT_LIMIT + 1);
        expect(newSessionLinks(long).map((link) => [link.href, link.carriesPrompt])).toEqual([
            ["claude://code/new", false],
            ["vscode://anthropic.claude-code/open", false],
        ]);
        expect(resumeLink(cli, "reviewed", long)?.carriesPrompt).toBe(false);
        expect(resumeLink(desktop, "made", long)).toMatchObject({
            href: "claude://claude.ai/epitaxy/local_11111111-1111-4111-8111-111111111111",
            carriesPrompt: false,
        });
    });
});

describe("RefreshProgress", () => {
    it("reports every phase still running, and nothing once all are done", () => {
        const messages: string[] = [];
        const progress = new RefreshProgress(
            [
                ["repos", "repositories", 2],
                ["reviews", "reviews", 1],
            ],
            (message) => messages.push(message),
        );
        progress.advance("repos");
        progress.set("reviews", 1);
        progress.advance("repos");
        expect(messages).toEqual([
            "Loading… repositories 0/2 · reviews 0/1",
            "Loading… repositories 1/2 · reviews 0/1",
            "Loading… repositories 1/2",
        ]);
        expect(progress.message()).toBeNull();
    });
});

describe("tabSearches", () => {
    it("keeps a PR waiting for the viewer out of the reviewed search", () => {
        expect(tabSearches("alice")).toEqual({
            mine: "is:pr is:open author:alice",
            requested: "is:pr is:open review-requested:alice",
            reviewed: "is:pr is:open reviewed-by:alice -author:alice -review-requested:alice",
        });
    });
});

describe("ChangeFingerprint", () => {
    const node = (id: string, mergeable: string, updatedAt = "2026-11-27T10:00:00Z") => ({
        id,
        updatedAt,
        headRefOid: "sha",
        mergeable,
        reviewDecision: null,
        isDraft: false,
        mergeQueueEntry: null,
    });
    const data = (...nodes: ProbeData["mine"][]): ProbeData => ({ mine: nodes[0], requested: nodes[1] });

    it("does not depend on the order GitHub returns hits in", () => {
        const fingerprint = new ChangeFingerprint();
        const a = fingerprint.read(data({ issueCount: 2, nodes: [node("B", "MERGEABLE"), node("A", "MERGEABLE")] }));
        const b = fingerprint.read(data({ issueCount: 2, nodes: [node("A", "MERGEABLE"), node("B", "MERGEABLE")] }));
        expect(a).toBe(b);
    });

    it("changes when a PR is updated or moves between tabs", () => {
        const fingerprint = new ChangeFingerprint();
        const before = fingerprint.read(data({ issueCount: 1, nodes: [node("A", "MERGEABLE")] }));
        expect(
            fingerprint.read(data({ issueCount: 1, nodes: [node("A", "MERGEABLE", "2026-11-27T11:00:00Z")] })),
        ).not.toBe(before);
        expect(
            fingerprint.read(data({ issueCount: 0, nodes: [] }, { issueCount: 1, nodes: [node("A", "MERGEABLE")] })),
        ).not.toBe(before);
    });

    it("keeps the last known mergeability while GitHub recomputes it", () => {
        const fingerprint = new ChangeFingerprint();
        const before = fingerprint.read(data({ issueCount: 1, nodes: [node("A", "CONFLICTING")] }));
        expect(fingerprint.read(data({ issueCount: 1, nodes: [node("A", "UNKNOWN")] }))).toBe(before);
    });

    it("skips hits that are not pull requests", () => {
        const fingerprint = new ChangeFingerprint();
        expect(fingerprint.read(data({ issueCount: 1, nodes: [{}, null] }))).toBe(
            fingerprint.read(data({ issueCount: 1, nodes: [] })),
        );
    });
});

describe("prFingerprint", () => {
    const probe: PrProbe = {
        updatedAt: "2026-11-26T10:00:00Z",
        state: "OPEN",
        isDraft: false,
        headRefOid: "abc",
        mergeable: "UNKNOWN",
        mergeStateStatus: "UNKNOWN",
        reviewDecision: null,
        mergeQueueEntry: null,
        headCommit: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
    };

    it("moves when a check finishes or mergeability is worked out, which leave updatedAt alone", () => {
        const before = prFingerprint(probe);
        expect(prFingerprint({ ...probe })).toBe(before);
        expect(
            prFingerprint({
                ...probe,
                headCommit: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
            }),
        ).not.toBe(before);
        expect(prFingerprint({ ...probe, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" })).not.toBe(before);
        expect(prFingerprint({ ...probe, updatedAt: "2026-11-26T11:00:00Z" })).not.toBe(before);
    });
});

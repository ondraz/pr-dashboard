import { cp, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrSession } from "../shared/sessions.ts";
import { REVIEW_ACTION, SessionIndex } from "./sessions.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const W = "https://github.com/example-org/widgets/pull/";
const G = "https://github.com/example-org/gadgets/pull/";

const TRANSCRIPTS = {
    behindDesktop: "-home-dev-widgets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl",
    flakyTest: "-home-dev-widgets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl",
    gadgets: "-home-dev-gadgets/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl",
};

const csvExport: PrSession = {
    id: "local_11111111-1111-4111-8111-111111111111",
    title: "Add CSV export to widgets",
    archived: false,
    lastActivityAt: 1700000100000,
};
const archivedDesktop: PrSession = {
    id: "local_22222222-2222-4222-8222-222222222222",
    title: "",
    archived: true,
    lastActivityAt: 1700000200000,
};
const flakyTestCli: PrSession = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    kind: "cli",
    title: "Fix the flaky widget test",
    archived: false,
    lastActivityAt: 1700000300000,
};
const gadgetsCli: PrSession = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: "cli",
    title: "",
    archived: false,
    lastActivityAt: 1700000150000,
};

let root: string;
let index: SessionIndex;

async function touch(transcript: string, seconds: number): Promise<void> {
    await utimes(join(root, "projects", transcript), seconds, seconds);
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pr-dashboard-sessions-"));
    await cp(FIXTURES, root, { recursive: true });
    await touch(TRANSCRIPTS.behindDesktop, 1700000400);
    await touch(TRANSCRIPTS.flakyTest, 1700000300);
    await touch(TRANSCRIPTS.gadgets, 1700000150);
    index = new SessionIndex(join(root, "desktop"), join(root, "projects"));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("SessionIndex", () => {
    it("maps each PR to the newest session that made it and that reviewed it", async () => {
        expect(await index.read()).toEqual({
            made: {
                [`${W}1`]: csvExport,
                [`${G}7`]: archivedDesktop,
                [`${W}3`]: flakyTestCli,
            },
            reviewed: {
                [`${G}10`]: csvExport,
                [`${G}11`]: flakyTestCli,
                [`${G}13`]: flakyTestCli,
                [`${G}14`]: flakyTestCli,
                [`${G}16`]: gadgetsCli,
            },
        });
    });

    it("returns nothing when neither directory exists", async () => {
        const missing = new SessionIndex(join(root, "no-desktop"), join(root, "no-projects"));
        expect(await missing.read()).toEqual({ made: {}, reviewed: {} });
    });

    it("re-reads a transcript only when its modification time changes", async () => {
        await index.read();
        const path = join(root, "projects", TRANSCRIPTS.gadgets);
        await writeFile(path, "");
        await touch(TRANSCRIPTS.gadgets, 1700000150);
        expect((await index.read()).reviewed[`${G}16`]).toEqual(gadgetsCli);

        await touch(TRANSCRIPTS.gadgets, 1700000160);
        expect((await index.read()).reviewed[`${G}16`]).toBeUndefined();
    });

    it("forgets a transcript once it is deleted", async () => {
        await index.read();
        await rm(join(root, "projects", TRANSCRIPTS.flakyTest));
        const { made, reviewed } = await index.read();
        expect(made[`${W}3`]?.id).toBe("local_66666666-6666-4666-8666-666666666666");
        expect(reviewed[`${G}11`]).toBeUndefined();
    });
});

describe("REVIEW_ACTION", () => {
    it.each([
        "gh pr review 12 --approve",
        "gh pr comment 12 --body 'Thanks'",
        "gh api repos/o/r/pulls/12/reviews -f event=COMMENT",
        "gh api -X POST repos/o/r/pulls/12/comments -f body=x",
        "gh api repos/o/r/issues/12/comments -f body=x",
        "mcp__github__add_issue_comment",
        "mcp__github__pull_request_review_write",
        "Skill code-review high 12 --comment",
    ])("counts %j as a review", (action) => {
        expect(REVIEW_ACTION.test(action)).toBe(true);
    });

    it.each([
        "gh pr view 12",
        "gh api repos/o/r/pulls/12",
        "gh api repos/o/r/pulls/12 | jq '.comments'",
        "echo mcp__github__add_issue_comment",
        "Skill code-review high 12",
        "git push",
    ])("does not count %j as a review", (action) => {
        expect(REVIEW_ACTION.test(action)).toBe(false);
    });
});

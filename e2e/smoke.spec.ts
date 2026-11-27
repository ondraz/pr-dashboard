import { expect, type Page, test } from "@playwright/test";
import { FakeGitHub, HEAD, PR_ID, PR_PATH, TITLE } from "./fakeGitHub.ts";

let github: FakeGitHub;
let policyViolations: string[];

test.beforeEach(async ({ page }) => {
    github = new FakeGitHub();
    await github.install(page);
    policyViolations = [];
    page.on("console", (message) => {
        if (message.text().includes("Content Security Policy")) policyViolations.push(message.text());
    });
});

test.afterEach(() => {
    expect(github.unexpected).toEqual([]);
    expect(policyViolations).toEqual([]);
});

const gears = (page: Page) => page.getByRole("region", { name: "src/gears.ts" });

test("opens a PR from the list, reads it and reviews it", async ({ page }) => {
    await page.goto("/");
    const row = page.locator(".pr-item", { hasText: TITLE });
    await expect(row.getByRole("link", { name: TITLE })).toBeVisible();
    // The fixture sessions the server reads made this PR.
    await expect(row.getByRole("link", { name: /VS Code|Claude/ })).toBeVisible();

    await row.getByRole("link", { name: TITLE }).click();
    await expect(page).toHaveURL(PR_PATH);
    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(page.getByText("Close, one question.")).toBeVisible();

    await page.getByRole("button", { name: "Unresolved 1" }).click();
    await expect(page.getByText("Close, one question.")).toBeHidden();
    await expect(page.getByText("Why 3?")).toBeVisible();

    await page.getByRole("link", { name: /Files changed/ }).click();
    await expect(page).toHaveURL(`${PR_PATH}/files`);
    await expect(gears(page).getByText("const ratio = 3;")).toBeVisible();

    const line = gears(page).locator('td:has([data-line-new-num="2"])').first();
    await line.hover();
    await line.locator(".diff-add-widget").click();
    const form = page.getByRole("form", { name: "Comment on line 2 on the new side" });
    await form.getByRole("textbox").fill("Why not 4?");
    await form.getByRole("button", { name: "Start a review" }).click();
    await expect(form).toBeHidden();
    await expect(gears(page).getByText("Why not 4?")).toBeVisible();
    expect(github.writesOf("AddPendingReview")).toEqual([{ pullRequestId: PR_ID, commitOID: HEAD }]);
    expect(github.writesOf("AddReviewThread")).toMatchObject([
        { pullRequestReviewId: "PRR_new", body: "Why not 4?", path: "src/gears.ts", line: 2, side: "RIGHT" },
    ]);

    await page.getByRole("button", { name: "Finish your review (1)" }).click();
    const panel = page.getByRole("form", { name: "Submit review" });
    await panel.getByRole("radio", { name: /Approve/ }).check();
    await panel.getByRole("button", { name: "Submit review" }).click();
    await expect(panel).toBeHidden();
    expect(github.writesOf("SubmitReview")).toEqual([{ pullRequestReviewId: "PRR_new", event: "APPROVE", body: null }]);

    await page.getByRole("link", { name: "Pull requests" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
});

test("steps through the files by keyboard, marks one viewed and hides whitespace", async ({ page }) => {
    await page.goto(`${PR_PATH}/files`);
    await expect(gears(page).getByText("const ratio = 3;")).toBeVisible();

    await page.keyboard.press("j");
    await expect(page.getByRole("button", { name: "Collapse src/axle.ts" })).toBeFocused();
    await page.keyboard.press("v");
    await expect(page.getByText("1 / 2 viewed")).toBeVisible();
    expect(github.writesOf("MarkFileViewed")).toEqual([{ pullRequestId: PR_ID, path: "src/axle.ts" }]);
    await expect(page.getByRole("button", { name: "Expand src/axle.ts" })).toBeVisible();

    await page.getByRole("button", { name: "Expand src/axle.ts" }).click();
    await page.getByRole("checkbox", { name: "Hide whitespace" }).check();
    await expect(page.getByRole("region", { name: "src/axle.ts" }).getByText("Only whitespace changed.")).toBeVisible();
    await expect(gears(page).getByText("+spin();")).toBeHidden();
    await expect(gears(page).getByText("const ratio = 3;")).toBeVisible();

    await page.keyboard.press("?");
    await expect(page.getByRole("region", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Keyboard shortcuts" })).toBeHidden();
});

test("draws a very long diff as it scrolls", async ({ page }) => {
    const rows = Array.from({ length: 300 }, (_, n) => `+export const row${n} = ${n};`).join("\n");
    github.files = Array.from({ length: 12 }, (_, n) => ({
        filename: `src/table${String(n).padStart(2, "0")}.ts`,
        status: "added",
        additions: 300,
        deletions: 0,
        patch: `@@ -0,0 +1,300 @@\n${rows}`,
    }));
    github.fields = { ...github.fields, changedFiles: github.files.length };
    await page.goto(`${PR_PATH}/files`);
    const last = page.getByRole("region", { name: "src/table11.ts" });
    await expect(page.getByRole("region", { name: "src/table00.ts" }).getByText("row0 = 0;")).toBeVisible();
    await expect(last.locator(".file-placeholder")).toHaveCount(1);

    await last.scrollIntoViewIfNeeded();
    await expect(last.getByText("row299 = 299;")).toBeAttached();
    await expect(last.locator(".file-placeholder")).toHaveCount(0);
});

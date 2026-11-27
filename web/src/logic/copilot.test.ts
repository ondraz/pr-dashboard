import { describe, expect, it } from "vitest";
import { copilotVerdict, latestCopilotReview, type ReviewLike } from "./copilot.ts";

const review = (body: string, state = "COMMENTED"): ReviewLike => ({
    id: "PRR_1",
    databaseId: 101,
    state,
    body,
    author: { login: "copilot-pull-request-reviewer" },
});

describe("copilotVerdict", () => {
    it("reads the verdict below the overview title of a newer body", () => {
        const body = "<!-- copilot marker -->\n## Copilot review overview\n\n### ⚠️ Changes recommended\n\nDetails";
        expect(copilotVerdict(review(body))).toEqual({
            id: "PRR_1",
            databaseId: 101,
            label: "Changes recommended",
            owing: true,
        });
    });

    it("reads an older body that leads with the verdict", () => {
        expect(copilotVerdict(review("✅ Approval recommended\n\nAll good"))).toMatchObject({
            label: "Approval recommended",
            owing: false,
        });
    });

    it("prefers headings over plain lines", () => {
        expect(copilotVerdict(review('Some intro\n# "Changes recommended"'))?.label).toBe("Changes recommended");
    });

    it.each(["Needs a closer look", "Looks good to me", "No issues found", "No comments"])(
        "does not count %j as owing",
        (label) => {
            expect(copilotVerdict(review(`## ${label}`))?.owing).toBe(false);
        },
    );

    it("does not count an approving review as owing whatever it says", () => {
        expect(copilotVerdict(review("## Changes recommended", "APPROVED"))?.owing).toBe(false);
    });

    it.each(["Copilot wasn't able to review any files", "Copilot encountered an error"])(
        "is not a verdict when %j",
        (body) => {
            expect(copilotVerdict(review(body))).toBeNull();
        },
    );

    it("is null for an empty body or no review", () => {
        expect(copilotVerdict(review("<!-- only a marker -->\n## Copilot review overview"))).toBeNull();
        expect(copilotVerdict(null)).toBeNull();
    });

    it("cuts a long label to 60 characters", () => {
        expect(copilotVerdict(review(`## ${"x".repeat(80)}`))?.label).toHaveLength(60);
    });
});

describe("latestCopilotReview", () => {
    it("takes the newest review by Copilot", () => {
        const reviews: (ReviewLike | null)[] = [
            { id: "1", state: "COMMENTED", author: { login: "Copilot" } },
            { id: "2", state: "COMMENTED", author: { login: "copilot-pull-request-reviewer" } },
            { id: "3", state: "APPROVED", author: { login: "alice" } },
            null,
        ];
        expect(latestCopilotReview(reviews)?.id).toBe("2");
        expect(latestCopilotReview([{ id: "3", state: "APPROVED", author: null }])).toBeNull();
    });
});

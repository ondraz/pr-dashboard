import { describe, expect, it } from "vitest";
import { checkAnnotation, checkRun, statusContext } from "../github/prFixtures.ts";
import {
    annotationsByPath,
    type CheckEntry,
    checkDuration,
    groupChecks,
    normalizeCheck,
    placeAnnotations,
} from "./checks.ts";
import { checkGroup } from "./mergeBox.ts";

const entry = (node: Parameters<typeof normalizeCheck>[0]) => normalizeCheck(node) as CheckEntry;

describe("normalizeCheck", () => {
    it("names an Actions run by its workflow and job, with its log's job id and annotations", () => {
        const run = entry(
            checkRun("test", "FAILURE", { title: "2 tests failed", summary: "  gears.test.ts  \n" }, [
                checkAnnotation("src/gears.ts", 3, "Expected 3", { annotationLevel: "WARNING", title: "lint" }),
            ]),
        );
        expect(run).toMatchObject({
            kind: "run",
            name: "CI / test",
            source: "GitHub Actions",
            group: "failing",
            label: "Failure",
            title: "2 tests failed",
            summary: "gears.test.ts",
            actionsJobId: 4004,
            annotationCount: 1,
        });
        expect(run.annotations).toEqual([
            {
                id: "CR_test:0",
                check: "CI / test",
                level: "warning",
                path: "src/gears.ts",
                startLine: 3,
                endLine: 3,
                title: "lint",
                message: "Expected 3",
                rawDetails: null,
                blobUrl: "https://github.com/acme/widgets/blob/tip-sha/src/gears.ts#L3",
            },
        ]);
    });

    it("reads a run still going by its status, and one outside Actions by its app alone", () => {
        const running = entry(
            checkRun("build", null, { checkSuite: { app: { name: "Buildkite" }, workflowRun: null } }),
        );
        expect(running).toMatchObject({
            name: "build",
            group: "pending",
            label: "In progress",
            actionsJobId: null,
            source: "Buildkite",
        });
        expect(entry(checkRun("x", "SUCCESS", { detailsUrl: null })).detailsUrl).toBe(
            "https://github.com/acme/widgets/runs/4001",
        );
    });

    it("reads a commit status as a check", () => {
        expect(entry(statusContext("deploy", "ERROR"))).toMatchObject({
            kind: "status",
            name: "deploy",
            group: "failing",
            label: "Error",
            required: true,
            title: "deploy says error",
            detailsUrl: "https://ci.example.com/deploy",
            source: "ci-bot",
        });
    });
});

describe("checkGroup", () => {
    it("puts each state where GitHub's merge box counts it", () => {
        expect(["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR"].map(checkGroup)).toEqual(Array(4).fill("failing"));
        expect(["QUEUED", "IN_PROGRESS", "PENDING", "EXPECTED"].map(checkGroup)).toEqual(Array(4).fill("pending"));
        expect(["SKIPPED", "NEUTRAL"].map(checkGroup)).toEqual(["skipped", "skipped"]);
        expect(checkGroup("SUCCESS")).toBe("successful");
    });
});

describe("groupChecks", () => {
    it("lists failing first, then running, passed and skipped, each by name, leaving out empty groups", () => {
        const checks = [
            entry(checkRun("lint", "SUCCESS")),
            entry(checkRun("test", "FAILURE")),
            entry(checkRun("docs", "SKIPPED")),
            entry(checkRun("build", "SUCCESS")),
        ];
        expect(groupChecks(checks).map(({ group, checks: list }) => [group, list.map((c) => c.name)])).toEqual([
            ["failing", ["CI / test"]],
            ["successful", ["CI / build", "CI / lint"]],
            ["skipped", ["CI / docs"]],
        ]);
    });
});

describe("checkDuration", () => {
    it("says how long a finished run took", () => {
        expect(checkDuration("2026-11-26T10:00:00Z", "2026-11-26T10:00:42Z")).toBe("42s");
        expect(checkDuration("2026-11-26T10:00:00Z", "2026-11-26T10:01:05Z")).toBe("1m 05s");
        expect(checkDuration("2026-11-26T10:00:00Z", "2026-11-26T12:03:00Z")).toBe("2h 03m");
        expect(checkDuration("2026-11-26T10:00:00Z", null)).toBeNull();
    });
});

describe("annotations", () => {
    const checks = [
        entry(
            checkRun("lint", "FAILURE", {}, [
                checkAnnotation("src/gears.ts", 9, "unused", { annotationLevel: "NOTICE" }),
                checkAnnotation("src/axle.ts", 1, "missing semicolon"),
            ]),
        ),
        entry(checkRun("test", "FAILURE", {}, [checkAnnotation("src/gears.ts", 12, "assertion failed")])),
    ];

    it("gathers every check's annotations by file, failures first", () => {
        const byPath = annotationsByPath(checks);
        expect([...byPath.keys()]).toEqual(["src/gears.ts", "src/axle.ts"]);
        expect(byPath.get("src/gears.ts")?.map((a) => [a.check, a.endLine])).toEqual([
            ["CI / test", 12],
            ["CI / lint", 9],
        ]);
    });

    it("draws an annotation under the line it ends on when the diff shows it, and apart otherwise", () => {
        const gears = annotationsByPath(checks).get("src/gears.ts") ?? [];
        const { byLine, elsewhere } = placeAnnotations(gears, new Set([10, 11, 12]));
        expect([...byLine.keys()]).toEqual([12]);
        expect(elsewhere.map((a) => a.endLine)).toEqual([9]);
    });
});

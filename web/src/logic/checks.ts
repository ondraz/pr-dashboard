import type { CommitChecksQuery } from "../github/gql/graphql.ts";
import { type CheckGroup, checkGroup } from "./mergeBox.ts";

type Rollup = NonNullable<
    Extract<NonNullable<NonNullable<CommitChecksQuery["repository"]>["object"]>, { statusCheckRollup: unknown }>
>["statusCheckRollup"];
export type CheckNode = NonNullable<NonNullable<NonNullable<Rollup>["contexts"]["nodes"]>[number]>;

export type AnnotationLevel = "failure" | "warning" | "notice";

/** A note a check run left on a line of a file at the commit it ran on. */
export interface Annotation {
    /** The check run's id and the annotation's place among its annotations. */
    id: string;
    check: string;
    level: AnnotationLevel;
    path: string;
    startLine: number;
    endLine: number;
    title: string | null;
    message: string;
    rawDetails: string | null;
    blobUrl: string;
}

/** A check run or a commit status, read the same way. */
export interface CheckEntry {
    id: string;
    kind: "run" | "status";
    /** The workflow's name and the job's, or the status's context. */
    name: string;
    /** The GitHub App that ran it, or who set the status. */
    source: string | null;
    group: CheckGroup;
    /** GitHub's own word for where it stands: "Failure", "In progress", "Success". */
    label: string;
    required: boolean;
    /** The run's title, or the status's description. */
    title: string | null;
    summary: string | null;
    /** Where its log or its own page is; GitHub's page of the run when it names none. */
    detailsUrl: string | null;
    /** An Actions job, whose id is the run's, which `gh run view --job` reads the log of. */
    actionsJobId: number | null;
    startedAt: string | null;
    completedAt: string | null;
    annotations: Annotation[];
    /** All of the run's annotations, of which the first 50 are read. */
    annotationCount: number;
}

const LEVELS: Record<string, AnnotationLevel> = { FAILURE: "failure", WARNING: "warning", NOTICE: "notice" };

const words = (state: string) => state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, " ");

export function normalizeCheck(node: CheckNode): CheckEntry | null {
    if (node.__typename === "CheckRun") {
        const state = node.conclusion ?? node.status;
        const workflow = node.checkSuite.workflowRun?.workflow.name;
        const name = workflow ? `${workflow} / ${node.name}` : node.name;
        return {
            id: node.id,
            kind: "run",
            name,
            source: node.checkSuite.app?.name ?? null,
            group: checkGroup(state),
            label: words(state),
            required: node.isRequired,
            title: node.title || null,
            summary: node.summary?.trim() || null,
            detailsUrl: node.detailsUrl ?? node.url,
            actionsJobId: node.checkSuite.workflowRun && node.databaseId ? node.databaseId : null,
            startedAt: node.startedAt,
            completedAt: node.completedAt,
            annotations: (node.annotations?.nodes ?? []).flatMap((annotation, n) =>
                annotation
                    ? [
                          {
                              id: `${node.id}:${n}`,
                              check: name,
                              level: LEVELS[annotation.annotationLevel ?? ""] ?? "notice",
                              path: annotation.path,
                              startLine: annotation.location.start.line,
                              endLine: annotation.location.end.line,
                              title: annotation.title || null,
                              message: annotation.message,
                              rawDetails: annotation.rawDetails || null,
                              blobUrl: annotation.blobUrl,
                          },
                      ]
                    : [],
            ),
            annotationCount: node.annotations?.totalCount ?? 0,
        };
    }
    if (node.__typename === "StatusContext") {
        return {
            id: node.id,
            kind: "status",
            name: node.context,
            source: node.creator?.login ?? null,
            group: checkGroup(node.state),
            label: words(node.state),
            required: node.isRequired,
            title: node.description || null,
            summary: null,
            detailsUrl: node.targetUrl,
            actionsJobId: null,
            startedAt: node.createdAt,
            completedAt: null,
            annotations: [],
            annotationCount: 0,
        };
    }
    return null;
}

export const GROUP_ORDER: readonly CheckGroup[] = ["failing", "pending", "successful", "skipped"];

/** The checks by where they stand, failing first as GitHub lists them, each group by name. */
export function groupChecks(checks: readonly CheckEntry[]): { group: CheckGroup; checks: CheckEntry[] }[] {
    return GROUP_ORDER.map((group) => ({
        group,
        checks: checks.filter((check) => check.group === group).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter(({ checks: list }) => list.length > 0);
}

/** "1m 05s" from a run's start to its end, or null while either is missing. */
export function checkDuration(startedAt: string | null, completedAt: string | null): string | null {
    if (!startedAt || !completedAt) return null;
    const seconds = Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Every check's annotations by the file they are on, the most severe first, then by line. */
export function annotationsByPath(checks: readonly CheckEntry[]): Map<string, Annotation[]> {
    const severity: Record<AnnotationLevel, number> = { failure: 0, warning: 1, notice: 2 };
    const byPath = new Map<string, Annotation[]>();
    for (const check of checks) {
        for (const annotation of check.annotations) {
            byPath.set(annotation.path, [...(byPath.get(annotation.path) ?? []), annotation]);
        }
    }
    for (const list of byPath.values()) {
        list.sort((a, b) => severity[a.level] - severity[b.level] || a.endLine - b.endLine);
    }
    return byPath;
}

/** A file's annotations split by whether the diff shows the line each one ends on, which is where it is drawn. */
export function placeAnnotations(
    annotations: readonly Annotation[],
    shownLines: ReadonlySet<number> | ReadonlyMap<number, unknown>,
): { byLine: Map<number, Annotation[]>; elsewhere: Annotation[] } {
    const byLine = new Map<number, Annotation[]>();
    const elsewhere: Annotation[] = [];
    for (const annotation of annotations) {
        if (shownLines.has(annotation.endLine)) {
            byLine.set(annotation.endLine, [...(byLine.get(annotation.endLine) ?? []), annotation]);
        } else {
            elsewhere.push(annotation);
        }
    }
    return { byLine, elsewhere };
}

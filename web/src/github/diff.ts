import type { ChangedFile, FileStatus } from "../logic/diff.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import type { GitHubClient } from "./client.ts";

interface RestFile {
    filename: string;
    previous_filename?: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
}

const STATUSES: readonly FileStatus[] = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"];

export function changedFile(file: RestFile): ChangedFile {
    return {
        path: file.filename,
        previousPath: file.previous_filename ?? null,
        status: STATUSES.find((status) => status === file.status) ?? "modified",
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch ?? null,
    };
}

/** The PR's changed files with their patches, as the REST API lists them. */
export async function loadPullFiles(client: GitHubClient, route: PrRoute): Promise<ChangedFile[]> {
    const files = await client.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
        owner: route.owner,
        repo: route.repo,
        pull_number: route.number,
        per_page: 100,
    });
    return files.map(changedFile);
}

/**
 * The PR's whole diff as `git diff` prints it, for the files whose REST patch was left out or cut. GitHub
 * refuses a diff past its own size limit, which the caller reports as such.
 */
export async function loadPullRawDiff(client: GitHubClient, route: PrRoute): Promise<string> {
    const { data } = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: route.owner,
        repo: route.repo,
        pull_number: route.number,
        mediaType: { format: "diff" },
    });
    return asText(data);
}

function asText(data: unknown): string {
    if (typeof data !== "string") throw new Error("GitHub sent no diff");
    return data;
}

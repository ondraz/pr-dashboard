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
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    throw new Error("GitHub sent no text");
}

// GitHub pages a commit's files 300 at a time, up to 3,000.
const COMMIT_PAGE_CAP = 10;

export interface CommitDiff {
    files: ChangedFile[];
    message: string;
    author: string;
    committedAt: string | null;
    htmlUrl: string;
    /** False when the commit has more files than GitHub lists. */
    complete: boolean;
}

/** One commit's changed files and what it says about itself. */
export async function loadCommitDiff(client: GitHubClient, route: PrRoute, sha: string): Promise<CommitDiff> {
    const files: ChangedFile[] = [];
    for (let page = 1; ; page++) {
        const { data, headers } = await client.request("GET /repos/{owner}/{repo}/commits/{ref}", {
            owner: route.owner,
            repo: route.repo,
            ref: sha,
            page,
        });
        files.push(...(data.files ?? []).map(changedFile));
        const more = /rel="next"/.test(headers.link ?? "");
        if (!more || page === COMMIT_PAGE_CAP) {
            return {
                files,
                message: data.commit.message,
                author: data.author?.login ?? data.commit.author?.name ?? "unknown",
                committedAt: data.commit.committer?.date ?? data.commit.author?.date ?? null,
                htmlUrl: data.html_url,
                complete: !more,
            };
        }
    }
}

/** GitHub lists at most this many files of a comparison. */
export const COMPARE_FILES_CAP = 300;

export interface CompareDiff {
    files: ChangedFile[];
    /** `diverged` when `from` is no longer an ancestor of `to`, as after a force-push. */
    status: string;
    complete: boolean;
}

/** The changes from `from` to `to`, as `git diff from...to` gives them. */
export async function loadCompareDiff(
    client: GitHubClient,
    route: PrRoute,
    from: string,
    to: string,
): Promise<CompareDiff> {
    const { data } = await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        owner: route.owner,
        repo: route.repo,
        basehead: `${from}...${to}`,
    });
    const files = (data.files ?? []).map(changedFile);
    return { files, status: data.status, complete: files.length < COMPARE_FILES_CAP };
}

export async function loadCommitRawDiff(client: GitHubClient, route: PrRoute, sha: string): Promise<string> {
    const { data } = await client.request("GET /repos/{owner}/{repo}/commits/{ref}", {
        owner: route.owner,
        repo: route.repo,
        ref: sha,
        mediaType: { format: "diff" },
    });
    return asText(data);
}

export async function loadCompareRawDiff(
    client: GitHubClient,
    route: PrRoute,
    from: string,
    to: string,
): Promise<string> {
    const { data } = await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        owner: route.owner,
        repo: route.repo,
        basehead: `${from}...${to}`,
        mediaType: { format: "diff" },
    });
    return asText(data);
}

/** A file's text at one commit, to show the lines around a diff's hunks. */
export async function loadFileText(client: GitHubClient, route: PrRoute, path: string, ref: string): Promise<string> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const { data } = await client.request(`GET /repos/{owner}/{repo}/contents/${encoded}`, {
        owner: route.owner,
        repo: route.repo,
        ref,
        mediaType: { format: "raw" },
    });
    return asText(data);
}

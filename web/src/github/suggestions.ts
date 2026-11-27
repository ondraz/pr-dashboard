import type { PrRoute } from "../logic/prRoute.ts";
import { applySuggestions, type Suggestion } from "../logic/suggestions.ts";
import { type GitHubClient, graphql as runGraphql, writeError } from "./client.ts";
import { loadFileText } from "./diff.ts";
import { graphql } from "./gql/index.ts";
import { setThreadResolved } from "./review.ts";

/** The head commit's tree, and the modes of the files in one of its directories (the root when not nested). */
export const suggestionTreeQuery = graphql(`
    query SuggestionTree($owner: String!, $name: String!, $commit: GitObjectID!, $dir: String!, $nested: Boolean!) {
        repository(owner: $owner, name: $name) {
            commit: object(oid: $commit) {
                ... on Commit {
                    tree {
                        oid
                        entries {
                            name
                            mode
                        }
                    }
                }
            }
            dir: object(expression: $dir) @include(if: $nested) {
                ... on Tree {
                    entries {
                        name
                        mode
                    }
                }
            }
        }
    }
`);

/** The branch the suggestions are committed to, at the commit the page shows. */
export interface SuggestionTarget {
    route: PrRoute;
    headOid: string;
    headRefName: string;
}

type FileMode = "100644" | "100755";

interface TreeInfo {
    treeOid: string;
    mode: FileMode;
}

const isFileMode = (mode: string): mode is FileMode => mode === "100644" || mode === "100755";

async function treeInfo(client: GitHubClient, target: SuggestionTarget, path: string): Promise<TreeInfo> {
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? "" : path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data } = await runGraphql(client, suggestionTreeQuery, {
        owner: target.route.owner,
        name: target.route.repo,
        commit: target.headOid,
        dir: `${target.headOid}:${dir}`,
        nested: dir !== "",
    });
    const commit = data.repository?.commit;
    const tree = commit && "tree" in commit ? commit.tree : null;
    const folder = data.repository?.dir;
    const entries = dir ? (folder && "entries" in folder ? folder.entries : null) : tree?.entries;
    const entry = entries?.find((candidate) => candidate.name === name);
    if (!tree || !entry) throw new Error(`${path} is not in the head commit`);
    const mode = entry.mode.toString(8).padStart(6, "0");
    if (!isFileMode(mode)) throw new Error(`${path} is not a regular file`);
    return { treeOid: tree.oid, mode };
}

/**
 * Commits the suggestions to the PR's branch as one commit on top of the head the page shows, through the Git
 * Data API, then resolves their threads. The branch only moves forward from that head: if anyone pushed since,
 * GitHub refuses the update and nothing changes.
 */
export async function commitSuggestions(
    client: GitHubClient,
    target: SuggestionTarget,
    suggestions: readonly Suggestion[],
    message: string,
): Promise<void> {
    const { route, headOid } = target;
    const byPath = Map.groupBy(suggestions, (suggestion) => suggestion.path);
    const files = await Promise.all(
        [...byPath].map(async ([path, changes]) => {
            const [info, text] = await Promise.all([
                treeInfo(client, target, path),
                loadFileText(client, route, path, headOid),
            ]);
            return { path, info, content: applySuggestions(text, changes) };
        }),
    );
    const baseTree = files[0]?.info.treeOid;
    if (!baseTree) return;
    const repo = { owner: route.owner, repo: route.repo };
    try {
        const tree = await client.request("POST /repos/{owner}/{repo}/git/trees", {
            ...repo,
            base_tree: baseTree,
            tree: files.map((file) => ({
                path: file.path,
                mode: file.info.mode,
                type: "blob" as const,
                content: file.content,
            })),
        });
        const commit = await client.request("POST /repos/{owner}/{repo}/git/commits", {
            ...repo,
            message,
            tree: tree.data.sha,
            parents: [headOid],
        });
        const branch = target.headRefName.split("/").map(encodeURIComponent).join("/");
        await client.request(`PATCH /repos/{owner}/{repo}/git/refs/heads/${branch}`, {
            ...repo,
            sha: commit.data.sha,
            force: false,
        });
    } catch (error) {
        throw writeError(error);
    }
    // The commit is in; a thread left open only means one more click, so a failure here is not the commit's.
    await Promise.allSettled(
        [...new Set(suggestions.map((suggestion) => suggestion.threadId))].map((threadId) =>
            setThreadResolved(client, threadId, true),
        ),
    );
}

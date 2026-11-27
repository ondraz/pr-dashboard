import type { PrRoute } from "../logic/prRoute.ts";
import { buildStackIndex, type PullDetail, type StackNode } from "../logic/stacks.ts";
import type { GitHubClient } from "./client.ts";
import { splitRepo } from "./repos.ts";
import { fetchStackParents } from "./stackParents.ts";

const HOP_CAP = 5;

/** The open PR whose head is `label` (`owner:branch`) in `repoFullName`, or null. */
export async function fetchOpenPrByHead(
    client: GitHubClient,
    repoFullName: string,
    label: string,
): Promise<PullDetail | null> {
    const { owner, repo } = splitRepo(repoFullName);
    const { data } = await client.request("GET /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        state: "open",
        head: label,
        per_page: 1,
    });
    return data[0] ?? null;
}

async function fetchOpenPrsOnBase(client: GitHubClient, repoFullName: string, branch: string): Promise<PullDetail[]> {
    const { owner, repo } = splitRepo(repoFullName);
    const { data } = await client.request("GET /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        state: "open",
        base: branch,
        per_page: 100,
    });
    return data;
}

/**
 * The stack a PR sits in, bottom first: the open PRs below it down to the base branch, anyone's,
 * and the ones stacked on top of it, up to five levels each way. Empty for a PR on its own.
 */
export async function loadStack(client: GitHubClient, route: PrRoute): Promise<StackNode[]> {
    const repoFullName = `${route.owner}/${route.repo}`;
    const { data: pr } = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: route.owner,
        repo: route.repo,
        pull_number: route.number,
    });
    const below = await fetchStackParents(repoFullName, [pr], (repo, label) => fetchOpenPrByHead(client, repo, label));

    // Only a branch of this repository can be the base of another PR in it.
    const ownBranch = (candidate: PullDetail) => candidate.head?.repo?.full_name === repoFullName;
    const known = new Set([pr.number, ...below.map((candidate) => candidate.number)]);
    const above: PullDetail[] = [];
    let frontier: PullDetail[] = ownBranch(pr) ? [pr] : [];
    for (let hop = 0; hop < HOP_CAP && frontier.length; hop++) {
        const found = await Promise.all(
            frontier.map((parent) => fetchOpenPrsOnBase(client, repoFullName, parent.head?.ref ?? "")),
        );
        frontier = found.flat().filter((candidate) => !known.has(candidate.number));
        for (const candidate of frontier) known.add(candidate.number);
        above.push(...frontier);
        frontier = frontier.filter(ownBranch);
    }

    const node = buildStackIndex([pr, ...below, ...above], repoFullName).get(pr.number);
    return node?.stack && node.stack.size > 1 ? node.stack.ordered : [];
}

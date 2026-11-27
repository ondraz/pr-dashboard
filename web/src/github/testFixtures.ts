/** Fictional GitHub API payloads for the tests: only the fields the dashboard reads. */

export function searchHit(repo: string, number: number, extra: Record<string, unknown> = {}) {
    return {
        id: number,
        node_id: `PR_${repo}_${number}`,
        number,
        title: `Change ${number}`,
        html_url: `https://github.com/${repo}/pull/${number}`,
        repository_url: `https://api.github.com/repos/${repo}`,
        user: { login: "alice" },
        state: "open",
        draft: false,
        body: "",
        labels: [],
        created_at: "2026-11-20T10:00:00Z",
        updated_at: "2026-11-25T10:00:00Z",
        ...extra,
    };
}

export function pullJson(
    repo: string,
    number: number,
    head: string,
    base: string,
    extra: Record<string, unknown> = {},
) {
    const owner = repo.split("/")[0];
    const side = (ref: string) => ({
        label: `${owner}:${ref}`,
        ref,
        sha: `${ref}-sha`,
        repo: { full_name: repo, default_branch: "main" },
    });
    return {
        number,
        title: `Change ${number}`,
        html_url: `https://github.com/${repo}/pull/${number}`,
        body: "",
        draft: false,
        mergeable: true,
        updated_at: "2026-11-25T10:00:00Z",
        user: { login: "alice" },
        requested_reviewers: [],
        auto_merge: null,
        head: side(head),
        base: side(base),
        ...extra,
    };
}

export function review(login: string, state: string, commit_id: string, submitted_at = "2026-11-24T10:00:00Z") {
    return { id: Math.floor(Math.random() * 1e9), user: { login }, state, commit_id, submitted_at };
}

export function thread(isResolved: boolean, starter: string, lastAuthor: string, reviewId = "PRR_any", totalCount = 1) {
    return {
        isResolved,
        comments: { totalCount, nodes: [{ pullRequestReview: { id: reviewId }, author: { login: starter } }] },
        lastComment: { nodes: [{ author: { login: lastAuthor } }] },
    };
}

export function outstanding(
    threads: ReturnType<typeof thread>[],
    { reviews = [] as unknown[], nextCursor = null as string | null, mergeQueueEntry = null as unknown } = {},
) {
    return {
        reviewThreads: { pageInfo: { hasNextPage: nextCursor !== null, endCursor: nextCursor }, nodes: threads },
        reviews: { nodes: reviews },
        mergeQueueEntry,
    };
}

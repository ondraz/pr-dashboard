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
    {
        reviews = [] as unknown[],
        nextCursor = null as string | null,
        mergeQueueEntry = null as unknown,
        isDraft = false,
        headRefOid = "head-sha",
        verdicts = [] as { state: string; author: { login: string } }[],
        viewerReviews = undefined as unknown[] | undefined,
    } = {},
) {
    return {
        reviewThreads: { pageInfo: { hasNextPage: nextCursor !== null, endCursor: nextCursor }, nodes: threads },
        reviews: { nodes: reviews },
        mergeQueueEntry,
        isDraft,
        headRefOid,
        latestOpinionatedReviews: { nodes: verdicts },
        ...(viewerReviews ? { viewerReviews: { nodes: viewerReviews } } : {}),
    };
}

/**
 * What the batched query answers for one PR, as GitHub would: its threads, draft state and head,
 * each reviewer's latest approval or change request, and the viewer's own reviews when asked.
 */
export function batchPullRequest(
    pull: ReturnType<typeof pullJson> | undefined,
    reviews: readonly ReturnType<typeof review>[],
    threads: ReturnType<typeof thread>[],
    viewer: string | null,
) {
    const latest = new Map<string, ReturnType<typeof review>>();
    for (const one of reviews) if (one.state !== "COMMENTED") latest.set(one.user.login, one);
    return outstanding(threads, {
        isDraft: !!pull?.draft,
        headRefOid: pull?.head.sha ?? "unknown-sha",
        verdicts: [...latest.values()].map((one) => ({ state: one.state, author: one.user })),
        viewerReviews: viewer
            ? reviews
                  .filter((one) => one.user.login === viewer)
                  .map((one) => ({
                      state: one.state,
                      submittedAt: one.submitted_at,
                      commit: { oid: one.commit_id },
                      author: one.user,
                  }))
            : undefined,
    });
}

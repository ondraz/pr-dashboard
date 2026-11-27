/** Fictional PR page payloads for the tests, typed as the GraphQL documents read them. */
import type { CheckNode } from "../logic/checks.ts";
import type { PullCommit, PullRequestFields, ReviewThread, TimelineNode } from "./pullRequest.ts";

type Of<T extends TimelineNode["__typename"]> = Extract<TimelineNode, { __typename: T }>;

export const actor = (login: string) => ({
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/1?v=4`,
    url: `https://github.com/${login}`,
});

export function pullCommit(oid: string, headline: string, login = "alice"): PullCommit {
    return {
        oid,
        abbreviatedOid: oid.slice(0, 7),
        messageHeadline: headline,
        committedDate: "2026-11-25T09:00:00Z",
        url: `https://github.com/acme/widgets/commit/${oid}`,
        author: { name: login, avatarUrl: actor(login).avatarUrl, user: { login } },
    };
}

export const timeline = {
    comment: (id: string, login: string, bodyHTML: string): Of<"IssueComment"> => ({
        __typename: "IssueComment",
        id,
        createdAt: "2026-11-25T10:00:00Z",
        url: `https://github.com/acme/widgets/pull/12#issuecomment-${id}`,
        body: bodyHTML.replace(/<[^>]+>/g, ""),
        bodyHTML,
        author: actor(login),
        viewerCanUpdate: false,
        viewerCanDelete: false,
        viewerCanReact: true,
        reactionGroups: [],
    }),
    review: (
        id: string,
        login: string,
        state: Of<"PullRequestReview">["state"],
        bodyHTML = "",
    ): Of<"PullRequestReview"> => ({
        __typename: "PullRequestReview",
        id,
        createdAt: "2026-11-25T11:00:00Z",
        submittedAt: "2026-11-25T11:00:00Z",
        url: `https://github.com/acme/widgets/pull/12#pullrequestreview-${id}`,
        state,
        body: bodyHTML.replace(/<[^>]+>/g, ""),
        bodyHTML,
        author: actor(login),
        viewerCanUpdate: false,
        viewerCanReact: true,
        reactionGroups: [],
    }),
    commit: (oid: string, headline: string): Of<"PullRequestCommit"> => ({
        __typename: "PullRequestCommit",
        id: `PRC_${oid}`,
        commit: pullCommit(oid, headline),
    }),
    forcePush: (id: string, before: string, after: string): Of<"HeadRefForcePushedEvent"> => ({
        __typename: "HeadRefForcePushedEvent",
        id,
        createdAt: "2026-11-25T12:00:00Z",
        actor: actor("alice"),
        beforeCommit: { abbreviatedOid: before },
        afterCommit: { abbreviatedOid: after },
    }),
    reviewRequested: (id: string, reviewer: string): Of<"ReviewRequestedEvent"> => ({
        __typename: "ReviewRequestedEvent",
        id,
        createdAt: "2026-11-25T08:00:00Z",
        actor: actor("alice"),
        requestedReviewer: { login: reviewer },
    }),
    labeled: (id: string, name: string): Of<"LabeledEvent"> => ({
        __typename: "LabeledEvent",
        id,
        createdAt: "2026-11-25T08:30:00Z",
        actor: actor("alice"),
        label: { name, color: "0e8a16" },
    }),
    renamed: (id: string, previousTitle: string, currentTitle: string): Of<"RenamedTitleEvent"> => ({
        __typename: "RenamedTitleEvent",
        id,
        createdAt: "2026-11-25T08:45:00Z",
        actor: actor("alice"),
        previousTitle,
        currentTitle,
    }),
};

export function reviewThread(
    id: string,
    reviewId: string,
    comments: { login: string; bodyHTML: string; reviewId?: string; pending?: boolean }[],
    extra: Partial<ReviewThread> = {},
): ReviewThread {
    return {
        id,
        isResolved: false,
        isOutdated: false,
        path: "src/gears.ts",
        line: 12,
        originalLine: 12,
        startLine: null,
        originalStartLine: null,
        diffSide: "RIGHT",
        startDiffSide: null,
        subjectType: "LINE",
        viewerCanReply: true,
        viewerCanResolve: true,
        viewerCanUnresolve: false,
        comments: {
            totalCount: comments.length,
            nodes: comments.map((comment, n) => ({
                id: `${id}_c${n}`,
                createdAt: "2026-11-25T11:00:00Z",
                url: `https://github.com/acme/widgets/pull/12#discussion_r${n}`,
                body: comment.bodyHTML.replace(/<[^>]+>/g, ""),
                bodyHTML: comment.bodyHTML,
                state: comment.pending ? "PENDING" : "SUBMITTED",
                diffHunk: "@@ -10,3 +10,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
                author: actor(comment.login),
                pullRequestReview: { id: comment.reviewId ?? reviewId },
                viewerCanUpdate: false,
                viewerCanDelete: false,
                viewerCanReact: true,
                reactionGroups: [],
            })),
        },
        ...extra,
    };
}

export function pullRequestFields(extra: Partial<PullRequestFields> = {}): PullRequestFields {
    return {
        id: "PR_12",
        number: 12,
        title: "Turn the gears",
        url: "https://github.com/acme/widgets/pull/12",
        state: "OPEN",
        isDraft: false,
        createdAt: "2026-11-20T10:00:00Z",
        updatedAt: "2026-11-26T10:00:00Z",
        author: actor("alice"),
        baseRefName: "mid",
        baseRefOid: "mid-sha",
        headRefName: "tip",
        headRepositoryOwner: { login: "acme" },
        isCrossRepository: false,
        body: "Turns them.",
        bodyHTML: "<p>Turns them.</p>",
        viewerCanReact: true,
        reactionGroups: [],
        headRefOid: "tip-sha",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviewDecision: "REVIEW_REQUIRED",
        headCommit: {
            nodes: [
                {
                    commit: {
                        oid: "tip-sha",
                        statusCheckRollup: {
                            state: "SUCCESS",
                            contexts: {
                                checkRunCountsByState: [{ state: "SUCCESS", count: 4 }],
                                statusContextCountsByState: [],
                            },
                        },
                    },
                },
            ],
        },
        autoMergeRequest: null,
        mergeQueueEntry: null,
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [] },
        closingIssuesReferences: { nodes: [] },
        changedFiles: 3,
        commits: { totalCount: 2 },
        viewerDidAuthor: false,
        pendingReview: { nodes: [] },
        viewerLatestReview: null,
        reviews: { nodes: [] },
        viewerCanUpdate: true,
        viewerCanEditFiles: true,
        viewerCanUpdateBranch: false,
        viewerCanEnableAutoMerge: true,
        viewerCanDisableAutoMerge: true,
        viewerCanClose: true,
        viewerCanReopen: true,
        isMergeQueueEnabled: false,
        baseRepository: {
            mergeCommitAllowed: true,
            squashMergeAllowed: true,
            rebaseMergeAllowed: true,
            viewerDefaultMergeMethod: "SQUASH",
        },
        ...extra,
    };
}

/** A `PullRequestDetail` response: the PR, its timeline and its threads, each in one page. */
export function pullRequestResponse(
    fields: PullRequestFields,
    nodes: TimelineNode[],
    threads: ReviewThread[],
    { timelineCursor = null as string | null, threadCursor = null as string | null } = {},
) {
    const page = <N>(list: N[], cursor: string | null) => ({
        pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
        nodes: list,
    });
    return {
        data: {
            repository: {
                pullRequest: {
                    ...fields,
                    reviewThreads: page(threads, threadCursor),
                    timelineItems: page(nodes, timelineCursor),
                },
            },
        },
    };
}

type CheckRunNode = Extract<CheckNode, { __typename: "CheckRun" }>;
type AnnotationNode = NonNullable<NonNullable<NonNullable<CheckRunNode["annotations"]>["nodes"]>[number]>;

export function checkAnnotation(
    path: string,
    line: number,
    message: string,
    extra: Partial<AnnotationNode> = {},
): AnnotationNode {
    return {
        annotationLevel: "FAILURE",
        path,
        location: { start: { line }, end: { line } },
        title: null,
        message,
        rawDetails: null,
        blobUrl: `https://github.com/acme/widgets/blob/tip-sha/${path}#L${line}`,
        ...extra,
    };
}

/** An Actions job's check run; its database id is the job's. */
export function checkRun(
    name: string,
    conclusion: CheckRunNode["conclusion"],
    extra: Partial<CheckRunNode> = {},
    annotations: AnnotationNode[] = [],
): CheckRunNode {
    return {
        __typename: "CheckRun",
        id: `CR_${name}`,
        databaseId: 4000 + name.length,
        name,
        status: conclusion ? "COMPLETED" : "IN_PROGRESS",
        conclusion,
        detailsUrl: `https://github.com/acme/widgets/actions/runs/1/job/${4000 + name.length}`,
        url: `https://github.com/acme/widgets/runs/${4000 + name.length}`,
        startedAt: "2026-11-26T10:00:00Z",
        completedAt: conclusion ? "2026-11-26T10:01:05Z" : null,
        title: null,
        summary: null,
        isRequired: false,
        checkSuite: { app: { name: "GitHub Actions" }, workflowRun: { workflow: { name: "CI" } } },
        annotations: { totalCount: annotations.length, nodes: annotations },
        ...extra,
    };
}

export function statusContext(context: string, state: Extract<CheckNode, { __typename: "StatusContext" }>["state"]) {
    return {
        __typename: "StatusContext" as const,
        id: `SC_${context}`,
        context,
        state,
        description: `${context} says ${state.toLowerCase()}`,
        targetUrl: `https://ci.example.com/${context}`,
        createdAt: "2026-11-26T10:00:00Z",
        isRequired: true,
        creator: { login: "ci-bot" },
    };
}

/** A `CommitChecks` response: one page of the commit's checks, `null` for a commit without any. */
export function commitChecksResponse(nodes: CheckNode[] | null, state = "FAILURE", cursor: string | null = null) {
    return {
        data: {
            repository: {
                object: {
                    statusCheckRollup: nodes && {
                        state,
                        contexts: { pageInfo: { hasNextPage: cursor !== null, endCursor: cursor }, nodes },
                    },
                },
            },
        },
    };
}

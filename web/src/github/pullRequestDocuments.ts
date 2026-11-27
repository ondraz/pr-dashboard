import { graphql } from "./gql/index.ts";

export const actorFieldsFragment = graphql(`
    fragment ActorFields on Actor {
        login
        avatarUrl(size: 40)
        url
    }
`);

export const requestedReviewerFragment = graphql(`
    fragment RequestedReviewerFields on RequestedReviewer {
        ... on User {
            login
        }
        ... on Bot {
            login
        }
        ... on Mannequin {
            login
        }
        ... on Team {
            name
            combinedSlug
        }
    }
`);

export const pullCommitFragment = graphql(`
    fragment PullCommitFields on Commit {
        oid
        abbreviatedOid
        messageHeadline
        committedDate
        url
        author {
            name
            avatarUrl(size: 40)
            user {
                login
            }
        }
    }
`);

/** The events the Conversation tab shows, in the order GitHub recorded them. */
export const timelinePageFragment = graphql(`
    fragment TimelinePage on PullRequestTimelineItemsConnection {
        pageInfo {
            hasNextPage
            endCursor
        }
        nodes {
            __typename
            ... on IssueComment {
                id
                createdAt
                url
                bodyHTML
                author {
                    ...ActorFields
                }
            }
            ... on PullRequestReview {
                id
                createdAt
                submittedAt
                url
                state
                bodyHTML
                author {
                    ...ActorFields
                }
            }
            ... on PullRequestCommit {
                id
                commit {
                    ...PullCommitFields
                }
            }
            ... on HeadRefForcePushedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                beforeCommit {
                    abbreviatedOid
                }
                afterCommit {
                    abbreviatedOid
                }
            }
            ... on ReviewRequestedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                requestedReviewer {
                    ...RequestedReviewerFields
                }
            }
            ... on ReviewRequestRemovedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                requestedReviewer {
                    ...RequestedReviewerFields
                }
            }
            ... on ReviewDismissedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                dismissedReview: review {
                    author {
                        login
                    }
                }
            }
            ... on LabeledEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                label {
                    name
                    color
                }
            }
            ... on UnlabeledEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                label {
                    name
                    color
                }
            }
            ... on RenamedTitleEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                previousTitle
                currentTitle
            }
            ... on BaseRefChangedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                previousRefName
                currentRefName
            }
            ... on ReadyForReviewEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
            }
            ... on ConvertToDraftEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
            }
            ... on ClosedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
            }
            ... on ReopenedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
            }
            ... on MergedEvent {
                id
                createdAt
                actor {
                    ...ActorFields
                }
                mergeRefName
                mergeCommit: commit {
                    abbreviatedOid
                }
            }
        }
    }
`);

export const reviewThreadDetailPageFragment = graphql(`
    fragment ReviewThreadDetailPage on PullRequestReviewThreadConnection {
        pageInfo {
            hasNextPage
            endCursor
        }
        nodes {
            id
            isResolved
            isOutdated
            path
            line
            originalLine
            startLine
            originalStartLine
            diffSide
            subjectType
            comments(first: 100) {
                totalCount
                nodes {
                    id
                    createdAt
                    url
                    bodyHTML
                    diffHunk
                    author {
                        ...ActorFields
                    }
                    pullRequestReview {
                        id
                    }
                }
            }
        }
    }
`);

/** What the merge box and the live check read of the head commit's checks. */
export const headChecksFragment = graphql(`
    fragment HeadChecks on PullRequest {
        headCommit: commits(last: 1) {
            nodes {
                commit {
                    oid
                    statusCheckRollup {
                        state
                        contexts(first: 1) {
                            checkRunCountsByState {
                                state
                                count
                            }
                            statusContextCountsByState {
                                state
                                count
                            }
                        }
                    }
                }
            }
        }
    }
`);

/** The fields whose change means the open PR should be read again. */
export const pullRequestProbeFragment = graphql(`
    fragment PullRequestProbeFields on PullRequest {
        updatedAt
        state
        isDraft
        headRefOid
        mergeable
        mergeStateStatus
        reviewDecision
        mergeQueueEntry {
            position
        }
        headCommit: commits(last: 1) {
            nodes {
                commit {
                    statusCheckRollup {
                        state
                    }
                }
            }
        }
    }
`);

export const pullRequestProbeQuery = graphql(`
    query PullRequestProbe($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                ...PullRequestProbeFields
            }
        }
    }
`);

/**
 * Everything the PR page shows but the commit list, in one request. The timeline and the review
 * threads are paged on their own when a PR has more than 100 of either.
 */
export const pullRequestDetailQuery = graphql(`
    query PullRequestDetail($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                id
                number
                title
                url
                state
                isDraft
                createdAt
                updatedAt
                author {
                    ...ActorFields
                }
                baseRefName
                baseRefOid
                headRefName
                headRepositoryOwner {
                    login
                }
                isCrossRepository
                body
                bodyHTML
                ...PullRequestProbeFields
                ...HeadChecks
                autoMergeRequest {
                    mergeMethod
                    enabledBy {
                        login
                    }
                }
                mergeQueueEntry {
                    position
                    state
                }
                reviewRequests(first: 50) {
                    nodes {
                        requestedReviewer {
                            ...RequestedReviewerFields
                        }
                    }
                }
                latestReviews(first: 50) {
                    nodes {
                        state
                        submittedAt
                        author {
                            ...ActorFields
                        }
                    }
                }
                assignees(first: 20) {
                    nodes {
                        ...ActorFields
                    }
                }
                labels(first: 50) {
                    nodes {
                        name
                    }
                }
                milestone {
                    title
                    url
                }
                closingIssuesReferences(first: 20) {
                    nodes {
                        number
                        title
                        url
                        state
                        repository {
                            nameWithOwner
                        }
                    }
                }
                changedFiles
                commits {
                    totalCount
                }
                viewerLatestReview {
                    submittedAt
                    commit {
                        oid
                    }
                }
                reviews(last: 20) {
                    nodes {
                        id
                        databaseId
                        state
                        body
                        author {
                            login
                        }
                    }
                }
                reviewThreads(first: 100) {
                    ...ReviewThreadDetailPage
                }
                timelineItems(
                    first: 100
                    itemTypes: [
                        ISSUE_COMMENT
                        PULL_REQUEST_REVIEW
                        PULL_REQUEST_COMMIT
                        HEAD_REF_FORCE_PUSHED_EVENT
                        REVIEW_REQUESTED_EVENT
                        REVIEW_REQUEST_REMOVED_EVENT
                        REVIEW_DISMISSED_EVENT
                        LABELED_EVENT
                        UNLABELED_EVENT
                        RENAMED_TITLE_EVENT
                        BASE_REF_CHANGED_EVENT
                        READY_FOR_REVIEW_EVENT
                        CONVERT_TO_DRAFT_EVENT
                        CLOSED_EVENT
                        REOPENED_EVENT
                        MERGED_EVENT
                    ]
                ) {
                    ...TimelinePage
                }
            }
        }
    }
`);

export const timelinePageQuery = graphql(`
    query PullRequestTimelinePage($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                timelineItems(
                    first: 100
                    after: $after
                    itemTypes: [
                        ISSUE_COMMENT
                        PULL_REQUEST_REVIEW
                        PULL_REQUEST_COMMIT
                        HEAD_REF_FORCE_PUSHED_EVENT
                        REVIEW_REQUESTED_EVENT
                        REVIEW_REQUEST_REMOVED_EVENT
                        REVIEW_DISMISSED_EVENT
                        LABELED_EVENT
                        UNLABELED_EVENT
                        RENAMED_TITLE_EVENT
                        BASE_REF_CHANGED_EVENT
                        READY_FOR_REVIEW_EVENT
                        CONVERT_TO_DRAFT_EVENT
                        CLOSED_EVENT
                        REOPENED_EVENT
                        MERGED_EVENT
                    ]
                ) {
                    ...TimelinePage
                }
            }
        }
    }
`);

export const reviewThreadDetailPageQuery = graphql(`
    query ReviewThreadDetailPage($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                reviewThreads(first: 100, after: $after) {
                    ...ReviewThreadDetailPage
                }
            }
        }
    }
`);

export const pullRequestCommitsQuery = graphql(`
    query PullRequestCommits($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                commits(first: 100, after: $after) {
                    totalCount
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        commit {
                            ...PullCommitFields
                        }
                    }
                }
            }
        }
    }
`);

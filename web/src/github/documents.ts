import { graphql } from "./gql/index.ts";

export const changeProbeQuery = graphql(`
    query ChangeProbe($mine: String!, $requested: String!, $reviewed: String!) {
        mine: search(type: ISSUE, query: $mine, first: 100) {
            ...ChangeProbeHits
        }
        requested: search(type: ISSUE, query: $requested, first: 100) {
            ...ChangeProbeHits
        }
        reviewed: search(type: ISSUE, query: $reviewed, first: 100) {
            ...ChangeProbeHits
        }
    }

    fragment ChangeProbeHits on SearchResultItemConnection {
        issueCount
        nodes {
            ... on PullRequest {
                id
                updatedAt
                headRefOid
                mergeable
                reviewDecision
                isDraft
                mergeQueueEntry {
                    position
                }
            }
        }
    }
`);

export const reviewThreadPageFragment = graphql(`
    fragment ReviewThreadPage on PullRequestReviewThreadConnection {
        pageInfo {
            hasNextPage
            endCursor
        }
        nodes {
            isResolved
            comments(first: 1) {
                totalCount
                nodes {
                    state
                    pullRequestReview {
                        id
                    }
                    author {
                        login
                    }
                }
            }
            lastComment: comments(last: 1) {
                nodes {
                    author {
                        login
                    }
                }
            }
        }
    }
`);

/** Reads 20 reviews, newest last, to find Copilot's latest. */
export const outstandingWorkFragment = graphql(`
    fragment OutstandingWork on PullRequest {
        reviewThreads(first: 100) {
            ...ReviewThreadPage
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
        mergeQueueEntry {
            position
            state
        }
        isDraft
        headRefOid
        # Each reviewer's latest approval or change request, which decides the PR's review state.
        latestOpinionatedReviews(first: 100) {
            nodes {
                state
                author {
                    login
                }
            }
        }
        # The viewer's own reviews, oldest first, for the review tabs; asked for only there.
        viewerReviews: reviews(last: 100, author: $viewer) @include(if: $withViewer) {
            nodes {
                state
                submittedAt
                commit {
                    oid
                }
                author {
                    login
                }
            }
        }
    }
`);

export const reviewThreadsPageQuery = graphql(`
    query ReviewThreadsPage($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
                reviewThreads(first: 100, after: $after) {
                    ...ReviewThreadPage
                }
            }
        }
    }
`);

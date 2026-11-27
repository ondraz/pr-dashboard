/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n    query ChangeProbe($mine: String!, $requested: String!, $reviewed: String!) {\n        mine: search(type: ISSUE, query: $mine, first: 100) {\n            ...ChangeProbeHits\n        }\n        requested: search(type: ISSUE, query: $requested, first: 100) {\n            ...ChangeProbeHits\n        }\n        reviewed: search(type: ISSUE, query: $reviewed, first: 100) {\n            ...ChangeProbeHits\n        }\n    }\n\n    fragment ChangeProbeHits on SearchResultItemConnection {\n        issueCount\n        nodes {\n            ... on PullRequest {\n                id\n                updatedAt\n                headRefOid\n                mergeable\n                reviewDecision\n                isDraft\n                mergeQueueEntry {\n                    position\n                }\n            }\n        }\n    }\n": typeof types.ChangeProbeDocument,
    "\n    fragment ReviewThreadPage on PullRequestReviewThreadConnection {\n        pageInfo {\n            hasNextPage\n            endCursor\n        }\n        nodes {\n            isResolved\n            comments(first: 1) {\n                totalCount\n                nodes {\n                    pullRequestReview {\n                        id\n                    }\n                    author {\n                        login\n                    }\n                }\n            }\n            lastComment: comments(last: 1) {\n                nodes {\n                    author {\n                        login\n                    }\n                }\n            }\n        }\n    }\n": typeof types.ReviewThreadPageFragmentDoc,
    "\n    fragment OutstandingWork on PullRequest {\n        reviewThreads(first: 100) {\n            ...ReviewThreadPage\n        }\n        reviews(last: 20) {\n            nodes {\n                id\n                databaseId\n                state\n                body\n                author {\n                    login\n                }\n            }\n        }\n        mergeQueueEntry {\n            position\n            state\n        }\n    }\n": typeof types.OutstandingWorkFragmentDoc,
    "\n    query ReviewThreadsPage($owner: String!, $name: String!, $number: Int!, $after: String) {\n        repository(owner: $owner, name: $name) {\n            pullRequest(number: $number) {\n                reviewThreads(first: 100, after: $after) {\n                    ...ReviewThreadPage\n                }\n            }\n        }\n    }\n": typeof types.ReviewThreadsPageDocument,
};
const documents: Documents = {
    "\n    query ChangeProbe($mine: String!, $requested: String!, $reviewed: String!) {\n        mine: search(type: ISSUE, query: $mine, first: 100) {\n            ...ChangeProbeHits\n        }\n        requested: search(type: ISSUE, query: $requested, first: 100) {\n            ...ChangeProbeHits\n        }\n        reviewed: search(type: ISSUE, query: $reviewed, first: 100) {\n            ...ChangeProbeHits\n        }\n    }\n\n    fragment ChangeProbeHits on SearchResultItemConnection {\n        issueCount\n        nodes {\n            ... on PullRequest {\n                id\n                updatedAt\n                headRefOid\n                mergeable\n                reviewDecision\n                isDraft\n                mergeQueueEntry {\n                    position\n                }\n            }\n        }\n    }\n": types.ChangeProbeDocument,
    "\n    fragment ReviewThreadPage on PullRequestReviewThreadConnection {\n        pageInfo {\n            hasNextPage\n            endCursor\n        }\n        nodes {\n            isResolved\n            comments(first: 1) {\n                totalCount\n                nodes {\n                    pullRequestReview {\n                        id\n                    }\n                    author {\n                        login\n                    }\n                }\n            }\n            lastComment: comments(last: 1) {\n                nodes {\n                    author {\n                        login\n                    }\n                }\n            }\n        }\n    }\n": types.ReviewThreadPageFragmentDoc,
    "\n    fragment OutstandingWork on PullRequest {\n        reviewThreads(first: 100) {\n            ...ReviewThreadPage\n        }\n        reviews(last: 20) {\n            nodes {\n                id\n                databaseId\n                state\n                body\n                author {\n                    login\n                }\n            }\n        }\n        mergeQueueEntry {\n            position\n            state\n        }\n    }\n": types.OutstandingWorkFragmentDoc,
    "\n    query ReviewThreadsPage($owner: String!, $name: String!, $number: Int!, $after: String) {\n        repository(owner: $owner, name: $name) {\n            pullRequest(number: $number) {\n                reviewThreads(first: 100, after: $after) {\n                    ...ReviewThreadPage\n                }\n            }\n        }\n    }\n": types.ReviewThreadsPageDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query ChangeProbe($mine: String!, $requested: String!, $reviewed: String!) {\n        mine: search(type: ISSUE, query: $mine, first: 100) {\n            ...ChangeProbeHits\n        }\n        requested: search(type: ISSUE, query: $requested, first: 100) {\n            ...ChangeProbeHits\n        }\n        reviewed: search(type: ISSUE, query: $reviewed, first: 100) {\n            ...ChangeProbeHits\n        }\n    }\n\n    fragment ChangeProbeHits on SearchResultItemConnection {\n        issueCount\n        nodes {\n            ... on PullRequest {\n                id\n                updatedAt\n                headRefOid\n                mergeable\n                reviewDecision\n                isDraft\n                mergeQueueEntry {\n                    position\n                }\n            }\n        }\n    }\n"): typeof import('./graphql').ChangeProbeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    fragment ReviewThreadPage on PullRequestReviewThreadConnection {\n        pageInfo {\n            hasNextPage\n            endCursor\n        }\n        nodes {\n            isResolved\n            comments(first: 1) {\n                totalCount\n                nodes {\n                    pullRequestReview {\n                        id\n                    }\n                    author {\n                        login\n                    }\n                }\n            }\n            lastComment: comments(last: 1) {\n                nodes {\n                    author {\n                        login\n                    }\n                }\n            }\n        }\n    }\n"): typeof import('./graphql').ReviewThreadPageFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    fragment OutstandingWork on PullRequest {\n        reviewThreads(first: 100) {\n            ...ReviewThreadPage\n        }\n        reviews(last: 20) {\n            nodes {\n                id\n                databaseId\n                state\n                body\n                author {\n                    login\n                }\n            }\n        }\n        mergeQueueEntry {\n            position\n            state\n        }\n    }\n"): typeof import('./graphql').OutstandingWorkFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query ReviewThreadsPage($owner: String!, $name: String!, $number: Int!, $after: String) {\n        repository(owner: $owner, name: $name) {\n            pullRequest(number: $number) {\n                reviewThreads(first: 100, after: $after) {\n                    ...ReviewThreadPage\n                }\n            }\n        }\n    }\n"): typeof import('./graphql').ReviewThreadsPageDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

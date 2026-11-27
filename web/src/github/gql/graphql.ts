/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** The possible states for a merge queue entry. */
export type MergeQueueEntryState =
  /** The entry is currently waiting for checks to pass. */
  | 'AWAITING_CHECKS'
  /** The entry is currently locked. */
  | 'LOCKED'
  /** The entry is currently mergeable. */
  | 'MERGEABLE'
  /** The entry is currently queued. */
  | 'QUEUED'
  /** The entry is currently unmergeable. */
  | 'UNMERGEABLE';

/** Whether or not a PullRequest can be merged. */
export type MergeableState =
  /** The pull request cannot be merged due to merge conflicts. */
  | 'CONFLICTING'
  /** The pull request can be merged. */
  | 'MERGEABLE'
  /** The mergeability of the pull request is still being calculated. */
  | 'UNKNOWN';

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

/** The possible states of a pull request review. */
export type PullRequestReviewState =
  /** A review allowing the pull request to merge. */
  | 'APPROVED'
  /** A review blocking the pull request from merging. */
  | 'CHANGES_REQUESTED'
  /** An informational review. */
  | 'COMMENTED'
  /** A review that has been dismissed. */
  | 'DISMISSED'
  /** A review that has not yet been submitted. */
  | 'PENDING';

export type ChangeProbeQueryVariables = Exact<{
  mine: string;
  requested: string;
  reviewed: string;
}>;


export type ChangeProbeQuery = { mine: { issueCount: number, nodes: Array<
      | { id: string, updatedAt: string, headRefOid: string, mergeable: MergeableState, reviewDecision: PullRequestReviewDecision | null, isDraft: boolean, mergeQueueEntry: { position: number } | null }
      | Record<PropertyKey, never>
     | null> | null }, requested: { issueCount: number, nodes: Array<
      | { id: string, updatedAt: string, headRefOid: string, mergeable: MergeableState, reviewDecision: PullRequestReviewDecision | null, isDraft: boolean, mergeQueueEntry: { position: number } | null }
      | Record<PropertyKey, never>
     | null> | null }, reviewed: { issueCount: number, nodes: Array<
      | { id: string, updatedAt: string, headRefOid: string, mergeable: MergeableState, reviewDecision: PullRequestReviewDecision | null, isDraft: boolean, mergeQueueEntry: { position: number } | null }
      | Record<PropertyKey, never>
     | null> | null } };

export type ChangeProbeHitsFragment = { issueCount: number, nodes: Array<
    | { id: string, updatedAt: string, headRefOid: string, mergeable: MergeableState, reviewDecision: PullRequestReviewDecision | null, isDraft: boolean, mergeQueueEntry: { position: number } | null }
    | Record<PropertyKey, never>
   | null> | null };

export type ReviewThreadPageFragment = { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ isResolved: boolean, comments: { totalCount: number, nodes: Array<{ pullRequestReview: { id: string } | null, author:
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
         | null } | null> | null }, lastComment: { nodes: Array<{ author:
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
         | null } | null> | null } } | null> | null };

export type OutstandingWorkFragment = { reviewThreads: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ isResolved: boolean, comments: { totalCount: number, nodes: Array<{ pullRequestReview: { id: string } | null, author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null } | null> | null }, lastComment: { nodes: Array<{ author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null } | null> | null } } | null> | null }, reviews: { nodes: Array<{ id: string, databaseId: number | null, state: PullRequestReviewState, body: string, author:
        | { login: string }
        | { login: string }
        | { login: string }
        | { login: string }
        | { login: string }
       | null } | null> | null } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null };

export type ReviewThreadsPageQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  after?: string | null | undefined;
}>;


export type ReviewThreadsPageQuery = { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ isResolved: boolean, comments: { totalCount: number, nodes: Array<{ pullRequestReview: { id: string } | null, author:
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
               | null } | null> | null }, lastComment: { nodes: Array<{ author:
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
               | null } | null> | null } } | null> | null } } | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const ChangeProbeHitsFragmentDoc = new TypedDocumentString(`
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
    `, {"fragmentName":"ChangeProbeHits"}) as unknown as TypedDocumentString<ChangeProbeHitsFragment, unknown>;
export const ReviewThreadPageFragmentDoc = new TypedDocumentString(`
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
    `, {"fragmentName":"ReviewThreadPage"}) as unknown as TypedDocumentString<ReviewThreadPageFragment, unknown>;
export const OutstandingWorkFragmentDoc = new TypedDocumentString(`
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
}
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
}`, {"fragmentName":"OutstandingWork"}) as unknown as TypedDocumentString<OutstandingWorkFragment, unknown>;
export const ChangeProbeDocument = new TypedDocumentString(`
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
}`) as unknown as TypedDocumentString<ChangeProbeQuery, ChangeProbeQueryVariables>;
export const ReviewThreadsPageDocument = new TypedDocumentString(`
    query ReviewThreadsPage($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        ...ReviewThreadPage
      }
    }
  }
}
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
}`) as unknown as TypedDocumentString<ReviewThreadsPageQuery, ReviewThreadsPageQueryVariables>;
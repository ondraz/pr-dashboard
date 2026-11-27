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

/** Represents available types of methods to use when merging a pull request. */
export type PullRequestMergeMethod =
  /** Add all commits from the head branch to the base branch with a merge commit. */
  | 'MERGE'
  /** Add all commits from the head branch onto the base branch individually. */
  | 'REBASE'
  /** Combine all commits from the head branch into a single commit in the base branch. */
  | 'SQUASH';

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

/** The possible subject types of a pull request review comment. */
export type PullRequestReviewThreadSubjectType =
  /** A comment that has been made against the file of a pull request */
  | 'FILE'
  /** A comment that has been made against the line of a pull request */
  | 'LINE';

/** The possible states of a pull request. */
export type PullRequestState =
  /** A pull request that has been closed without being merged. */
  | 'CLOSED'
  /** A pull request that has been closed by being merged. */
  | 'MERGED'
  /** A pull request that is still open. */
  | 'OPEN';

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

type ActorFields_Bot_Fragment = { login: string, avatarUrl: string, url: string };

type ActorFields_EnterpriseUserAccount_Fragment = { login: string, avatarUrl: string, url: string };

type ActorFields_Mannequin_Fragment = { login: string, avatarUrl: string, url: string };

type ActorFields_Organization_Fragment = { login: string, avatarUrl: string, url: string };

type ActorFields_User_Fragment = { login: string, avatarUrl: string, url: string };

export type ActorFieldsFragment =
  | ActorFields_Bot_Fragment
  | ActorFields_EnterpriseUserAccount_Fragment
  | ActorFields_Mannequin_Fragment
  | ActorFields_Organization_Fragment
  | ActorFields_User_Fragment
;

type RequestedReviewerFields_Bot_Fragment = { login: string };

type RequestedReviewerFields_Mannequin_Fragment = { login: string };

type RequestedReviewerFields_Team_Fragment = { name: string, combinedSlug: string };

type RequestedReviewerFields_User_Fragment = { login: string };

export type RequestedReviewerFieldsFragment =
  | RequestedReviewerFields_Bot_Fragment
  | RequestedReviewerFields_Mannequin_Fragment
  | RequestedReviewerFields_Team_Fragment
  | RequestedReviewerFields_User_Fragment
;

export type PullCommitFieldsFragment = { oid: string, abbreviatedOid: string, messageHeadline: string, committedDate: string, url: string, author: { name: string | null, avatarUrl: string, user: { login: string } | null } | null };

export type TimelinePageFragment = { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent', id: string, createdAt: string, previousRefName: string, currentRefName: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'ClosedEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, beforeCommit: { abbreviatedOid: string } | null, afterCommit: { abbreviatedOid: string } | null }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IssueComment', id: string, createdAt: string, url: string, bodyHTML: string, author:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'LabeledEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, label: { name: string, color: string } }
    | { __typename: 'LockedEvent' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergedEvent', id: string, createdAt: string, mergeRefName: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, mergeCommit: { abbreviatedOid: string } | null }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PullRequestCommit', id: string, commit: { oid: string, abbreviatedOid: string, messageHeadline: string, committedDate: string, url: string, author: { name: string | null, avatarUrl: string, user: { login: string } | null } | null } }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview', id: string, createdAt: string, submittedAt: string | null, url: string, state: PullRequestReviewState, bodyHTML: string, author:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'PullRequestReviewThread' }
    | { __typename: 'PullRequestRevisionMarker' }
    | { __typename: 'ReadyForReviewEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RenamedTitleEvent', id: string, createdAt: string, previousTitle: string, currentTitle: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'ReopenedEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null }
    | { __typename: 'ReviewDismissedEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, dismissedReview: { author:
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
         | null } | null }
    | { __typename: 'ReviewRequestRemovedEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, requestedReviewer:
        | { login: string }
        | { login: string }
        | { name: string, combinedSlug: string }
        | { login: string }
       | null }
    | { __typename: 'ReviewRequestedEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, requestedReviewer:
        | { login: string }
        | { login: string }
        | { name: string, combinedSlug: string }
        | { login: string }
       | null }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent', id: string, createdAt: string, actor:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, label: { name: string, color: string } }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'UserBlockedEvent' }
   | null> | null };

export type ReviewThreadDetailPageFragment = { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, isResolved: boolean, isOutdated: boolean, path: string, line: number | null, originalLine: number | null, startLine: number | null, originalStartLine: number | null, subjectType: PullRequestReviewThreadSubjectType, comments: { totalCount: number, nodes: Array<{ id: string, createdAt: string, url: string, bodyHTML: string, diffHunk: string, author:
          | { login: string, avatarUrl: string, url: string }
          | { login: string, avatarUrl: string, url: string }
          | { login: string, avatarUrl: string, url: string }
          | { login: string, avatarUrl: string, url: string }
          | { login: string, avatarUrl: string, url: string }
         | null, pullRequestReview: { id: string } | null } | null> | null } } | null> | null };

export type PullRequestDetailQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type PullRequestDetailQuery = { repository: { pullRequest: { id: string, number: number, title: string, url: string, state: PullRequestState, isDraft: boolean, createdAt: string, updatedAt: string, baseRefName: string, headRefName: string, isCrossRepository: boolean, body: string, bodyHTML: string, mergeable: MergeableState, changedFiles: number, author:
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
        | { login: string, avatarUrl: string, url: string }
       | null, headRepositoryOwner:
        | { login: string }
        | { login: string }
       | null, autoMergeRequest: { mergeMethod: PullRequestMergeMethod, enabledBy:
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
          | { login: string }
         | null } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null, commits: { totalCount: number }, reviews: { nodes: Array<{ id: string, databaseId: number | null, state: PullRequestReviewState, body: string, author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null } | null> | null } | null, reviewThreads: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, isResolved: boolean, isOutdated: boolean, path: string, line: number | null, originalLine: number | null, startLine: number | null, originalStartLine: number | null, subjectType: PullRequestReviewThreadSubjectType, comments: { totalCount: number, nodes: Array<{ id: string, createdAt: string, url: string, bodyHTML: string, diffHunk: string, author:
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
               | null, pullRequestReview: { id: string } | null } | null> | null } } | null> | null }, timelineItems: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
          | { __typename: 'AddedToMergeQueueEvent' }
          | { __typename: 'AddedToProjectEvent' }
          | { __typename: 'AssignedEvent' }
          | { __typename: 'AutoMergeDisabledEvent' }
          | { __typename: 'AutoMergeEnabledEvent' }
          | { __typename: 'AutoRebaseEnabledEvent' }
          | { __typename: 'AutoSquashEnabledEvent' }
          | { __typename: 'AutomaticBaseChangeFailedEvent' }
          | { __typename: 'AutomaticBaseChangeSucceededEvent' }
          | { __typename: 'BaseRefChangedEvent', id: string, createdAt: string, previousRefName: string, currentRefName: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'BaseRefDeletedEvent' }
          | { __typename: 'BaseRefForcePushedEvent' }
          | { __typename: 'ClosedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'CommentDeletedEvent' }
          | { __typename: 'ConnectedEvent' }
          | { __typename: 'ConvertToDraftEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ConvertedNoteToIssueEvent' }
          | { __typename: 'ConvertedToDiscussionEvent' }
          | { __typename: 'CrossReferencedEvent' }
          | { __typename: 'DemilestonedEvent' }
          | { __typename: 'DeployedEvent' }
          | { __typename: 'DeploymentEnvironmentChangedEvent' }
          | { __typename: 'DisconnectedEvent' }
          | { __typename: 'HeadRefDeletedEvent' }
          | { __typename: 'HeadRefForcePushedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, beforeCommit: { abbreviatedOid: string } | null, afterCommit: { abbreviatedOid: string } | null }
          | { __typename: 'HeadRefRestoredEvent' }
          | { __typename: 'IssueComment', id: string, createdAt: string, url: string, bodyHTML: string, author:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'LabeledEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, label: { name: string, color: string } }
          | { __typename: 'LockedEvent' }
          | { __typename: 'MarkedAsDuplicateEvent' }
          | { __typename: 'MentionedEvent' }
          | { __typename: 'MergedEvent', id: string, createdAt: string, mergeRefName: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, mergeCommit: { abbreviatedOid: string } | null }
          | { __typename: 'MilestonedEvent' }
          | { __typename: 'MovedColumnsInProjectEvent' }
          | { __typename: 'ParentIssueAddedEvent' }
          | { __typename: 'ParentIssueRemovedEvent' }
          | { __typename: 'PinnedEvent' }
          | { __typename: 'PullRequestCommit', id: string, commit: { oid: string, abbreviatedOid: string, messageHeadline: string, committedDate: string, url: string, author: { name: string | null, avatarUrl: string, user: { login: string } | null } | null } }
          | { __typename: 'PullRequestCommitCommentThread' }
          | { __typename: 'PullRequestReview', id: string, createdAt: string, submittedAt: string | null, url: string, state: PullRequestReviewState, bodyHTML: string, author:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'PullRequestReviewThread' }
          | { __typename: 'PullRequestRevisionMarker' }
          | { __typename: 'ReadyForReviewEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ReferencedEvent' }
          | { __typename: 'RemovedFromMergeQueueEvent' }
          | { __typename: 'RemovedFromProjectEvent' }
          | { __typename: 'RenamedTitleEvent', id: string, createdAt: string, previousTitle: string, currentTitle: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ReopenedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ReviewDismissedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, dismissedReview: { author:
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
               | null } | null }
          | { __typename: 'ReviewRequestRemovedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, requestedReviewer:
              | { login: string }
              | { login: string }
              | { name: string, combinedSlug: string }
              | { login: string }
             | null }
          | { __typename: 'ReviewRequestedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, requestedReviewer:
              | { login: string }
              | { login: string }
              | { name: string, combinedSlug: string }
              | { login: string }
             | null }
          | { __typename: 'SubIssueAddedEvent' }
          | { __typename: 'SubIssueRemovedEvent' }
          | { __typename: 'SubscribedEvent' }
          | { __typename: 'TransferredEvent' }
          | { __typename: 'UnassignedEvent' }
          | { __typename: 'UnlabeledEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, label: { name: string, color: string } }
          | { __typename: 'UnlockedEvent' }
          | { __typename: 'UnmarkedAsDuplicateEvent' }
          | { __typename: 'UnpinnedEvent' }
          | { __typename: 'UnsubscribedEvent' }
          | { __typename: 'UserBlockedEvent' }
         | null> | null } } | null } | null };

export type PullRequestTimelinePageQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  after?: string | null | undefined;
}>;


export type PullRequestTimelinePageQuery = { repository: { pullRequest: { timelineItems: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
          | { __typename: 'AddedToMergeQueueEvent' }
          | { __typename: 'AddedToProjectEvent' }
          | { __typename: 'AssignedEvent' }
          | { __typename: 'AutoMergeDisabledEvent' }
          | { __typename: 'AutoMergeEnabledEvent' }
          | { __typename: 'AutoRebaseEnabledEvent' }
          | { __typename: 'AutoSquashEnabledEvent' }
          | { __typename: 'AutomaticBaseChangeFailedEvent' }
          | { __typename: 'AutomaticBaseChangeSucceededEvent' }
          | { __typename: 'BaseRefChangedEvent', id: string, createdAt: string, previousRefName: string, currentRefName: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'BaseRefDeletedEvent' }
          | { __typename: 'BaseRefForcePushedEvent' }
          | { __typename: 'ClosedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'CommentDeletedEvent' }
          | { __typename: 'ConnectedEvent' }
          | { __typename: 'ConvertToDraftEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ConvertedNoteToIssueEvent' }
          | { __typename: 'ConvertedToDiscussionEvent' }
          | { __typename: 'CrossReferencedEvent' }
          | { __typename: 'DemilestonedEvent' }
          | { __typename: 'DeployedEvent' }
          | { __typename: 'DeploymentEnvironmentChangedEvent' }
          | { __typename: 'DisconnectedEvent' }
          | { __typename: 'HeadRefDeletedEvent' }
          | { __typename: 'HeadRefForcePushedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, beforeCommit: { abbreviatedOid: string } | null, afterCommit: { abbreviatedOid: string } | null }
          | { __typename: 'HeadRefRestoredEvent' }
          | { __typename: 'IssueComment', id: string, createdAt: string, url: string, bodyHTML: string, author:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'LabeledEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, label: { name: string, color: string } }
          | { __typename: 'LockedEvent' }
          | { __typename: 'MarkedAsDuplicateEvent' }
          | { __typename: 'MentionedEvent' }
          | { __typename: 'MergedEvent', id: string, createdAt: string, mergeRefName: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, mergeCommit: { abbreviatedOid: string } | null }
          | { __typename: 'MilestonedEvent' }
          | { __typename: 'MovedColumnsInProjectEvent' }
          | { __typename: 'ParentIssueAddedEvent' }
          | { __typename: 'ParentIssueRemovedEvent' }
          | { __typename: 'PinnedEvent' }
          | { __typename: 'PullRequestCommit', id: string, commit: { oid: string, abbreviatedOid: string, messageHeadline: string, committedDate: string, url: string, author: { name: string | null, avatarUrl: string, user: { login: string } | null } | null } }
          | { __typename: 'PullRequestCommitCommentThread' }
          | { __typename: 'PullRequestReview', id: string, createdAt: string, submittedAt: string | null, url: string, state: PullRequestReviewState, bodyHTML: string, author:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'PullRequestReviewThread' }
          | { __typename: 'PullRequestRevisionMarker' }
          | { __typename: 'ReadyForReviewEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ReferencedEvent' }
          | { __typename: 'RemovedFromMergeQueueEvent' }
          | { __typename: 'RemovedFromProjectEvent' }
          | { __typename: 'RenamedTitleEvent', id: string, createdAt: string, previousTitle: string, currentTitle: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ReopenedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null }
          | { __typename: 'ReviewDismissedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, dismissedReview: { author:
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
               | null } | null }
          | { __typename: 'ReviewRequestRemovedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, requestedReviewer:
              | { login: string }
              | { login: string }
              | { name: string, combinedSlug: string }
              | { login: string }
             | null }
          | { __typename: 'ReviewRequestedEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, requestedReviewer:
              | { login: string }
              | { login: string }
              | { name: string, combinedSlug: string }
              | { login: string }
             | null }
          | { __typename: 'SubIssueAddedEvent' }
          | { __typename: 'SubIssueRemovedEvent' }
          | { __typename: 'SubscribedEvent' }
          | { __typename: 'TransferredEvent' }
          | { __typename: 'UnassignedEvent' }
          | { __typename: 'UnlabeledEvent', id: string, createdAt: string, actor:
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
              | { login: string, avatarUrl: string, url: string }
             | null, label: { name: string, color: string } }
          | { __typename: 'UnlockedEvent' }
          | { __typename: 'UnmarkedAsDuplicateEvent' }
          | { __typename: 'UnpinnedEvent' }
          | { __typename: 'UnsubscribedEvent' }
          | { __typename: 'UserBlockedEvent' }
         | null> | null } } | null } | null };

export type ReviewThreadDetailPageQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  after?: string | null | undefined;
}>;


export type ReviewThreadDetailPageQuery = { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, isResolved: boolean, isOutdated: boolean, path: string, line: number | null, originalLine: number | null, startLine: number | null, originalStartLine: number | null, subjectType: PullRequestReviewThreadSubjectType, comments: { totalCount: number, nodes: Array<{ id: string, createdAt: string, url: string, bodyHTML: string, diffHunk: string, author:
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
                | { login: string, avatarUrl: string, url: string }
               | null, pullRequestReview: { id: string } | null } | null> | null } } | null> | null } } | null } | null };

export type PullRequestCommitsQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  after?: string | null | undefined;
}>;


export type PullRequestCommitsQuery = { repository: { pullRequest: { commits: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ commit: { oid: string, abbreviatedOid: string, messageHeadline: string, committedDate: string, url: string, author: { name: string | null, avatarUrl: string, user: { login: string } | null } | null } } | null> | null } } | null } | null };

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
export const ActorFieldsFragmentDoc = new TypedDocumentString(`
    fragment ActorFields on Actor {
  login
  avatarUrl(size: 40)
  url
}
    `, {"fragmentName":"ActorFields"}) as unknown as TypedDocumentString<ActorFieldsFragment, unknown>;
export const PullCommitFieldsFragmentDoc = new TypedDocumentString(`
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
    `, {"fragmentName":"PullCommitFields"}) as unknown as TypedDocumentString<PullCommitFieldsFragment, unknown>;
export const RequestedReviewerFieldsFragmentDoc = new TypedDocumentString(`
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
    `, {"fragmentName":"RequestedReviewerFields"}) as unknown as TypedDocumentString<RequestedReviewerFieldsFragment, unknown>;
export const TimelinePageFragmentDoc = new TypedDocumentString(`
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
    fragment ActorFields on Actor {
  login
  avatarUrl(size: 40)
  url
}
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
}`, {"fragmentName":"TimelinePage"}) as unknown as TypedDocumentString<TimelinePageFragment, unknown>;
export const ReviewThreadDetailPageFragmentDoc = new TypedDocumentString(`
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
    fragment ActorFields on Actor {
  login
  avatarUrl(size: 40)
  url
}`, {"fragmentName":"ReviewThreadDetailPage"}) as unknown as TypedDocumentString<ReviewThreadDetailPageFragment, unknown>;
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
export const PullRequestDetailDocument = new TypedDocumentString(`
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
      headRefName
      headRepositoryOwner {
        login
      }
      isCrossRepository
      body
      bodyHTML
      mergeable
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
      changedFiles
      commits {
        totalCount
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
    fragment ActorFields on Actor {
  login
  avatarUrl(size: 40)
  url
}
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
}`) as unknown as TypedDocumentString<PullRequestDetailQuery, PullRequestDetailQueryVariables>;
export const PullRequestTimelinePageDocument = new TypedDocumentString(`
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
    fragment ActorFields on Actor {
  login
  avatarUrl(size: 40)
  url
}
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
}`) as unknown as TypedDocumentString<PullRequestTimelinePageQuery, PullRequestTimelinePageQueryVariables>;
export const ReviewThreadDetailPageDocument = new TypedDocumentString(`
    query ReviewThreadDetailPage($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        ...ReviewThreadDetailPage
      }
    }
  }
}
    fragment ActorFields on Actor {
  login
  avatarUrl(size: 40)
  url
}
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
}`) as unknown as TypedDocumentString<ReviewThreadDetailPageQuery, ReviewThreadDetailPageQueryVariables>;
export const PullRequestCommitsDocument = new TypedDocumentString(`
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
}`) as unknown as TypedDocumentString<PullRequestCommitsQuery, PullRequestCommitsQueryVariables>;
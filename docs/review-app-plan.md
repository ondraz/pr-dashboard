# Plan: pr-dashboard as a full review app

## Problem

The dashboard is good at answering "which PRs need me", but every PR title opens GitHub, so all
real work (reading the diff, answering threads, approving, merging) happens in another tab. The
ChatGPT Code Review plugin (Codex) shows the shape we want: one inbox, and a PR detail view with
summary, changes, checks, stack and the agent chats behind the PR, with review actions posted
straight to GitHub. We want that, keeping our own list (per-repo and per-feature grouping, stack
chains, unresolved counts, the three tabs) and our link to the Claude session behind each PR.

Goal: once the dashboard is open, nothing in the normal PR workflow needs github.com.

## Concept

- **The list stays as it is.** Clicking a PR title opens it in the app. Cmd/Ctrl-click and a small
  "open on GitHub" icon still go to GitHub.
- **URLs mirror GitHub's.** `/owner/repo/pull/123`, `.../files`, `.../commits`,
  `.../commits/<sha>` and `.../checks` open the same PR in the app, so swapping `github.com` for
  `localhost:6789` in a link opens it here. Back, forward and reload work. Going back to the list
  keeps its scroll position, collapsed sections and tab.
- **PR detail** (full width, with a back button and `[` / `]` for previous and next PR in the
  current list order):
  - Header: title, state, base ← head, author, our badges (stack position, auto-merge, conflicts,
    unresolved, feature), Claude / VS Code session buttons.
  - Tabs: **Conversation**, **Commits**, **Checks**, **Files changed**.
  - Sidebar: reviewers and their states, assignees, labels, linked issues, milestone, a **Stack**
    panel (the chain, each member opening in place), and a **Sessions** panel (every Claude
    session that made or reviewed the PR — our version of Codex "Threads").
  - Merge box: mergeability, review decision, checks rollup, auto-merge or queue position, and
    the merge actions.
- **A React + TypeScript app built with Vite**, compiled to static files that `serve.py` serves
  on localhost. The browser talks to `api.github.com` directly. `serve.py` stays the only local
  server: it serves the build, answers `/sessions.json`, and runs sign-in.
- **Signing in through a GitHub App.** A private GitHub App owned by the Upheal org replaces the
  personal access token. Each user signs in once with the device flow. `serve.py` holds the
  refresh token and gives the page only an access token that expires after 8 hours.
- **Local only.** The app runs on each user's machine. Hosting it is not part of this plan, and
  nothing here blocks it: the same GitHub App could later sign in through GitHub's web flow from
  a small hosted endpoint, while local copies keep the device flow.

## Choices

| Concern | Choice | Why |
|---|---|---|
| UI | React 19, TypeScript (strict) | The detail view keeps a lot of state across live refreshes: drafts, expanded files, scroll, pending reviews. |
| Build and dev server | Vite | Static output that `serve.py` can serve; fast dev server whose proxy forwards `/sessions.json` and `/auth/*` to `serve.py`. |
| GitHub data | TanStack Query | Caching, polling, refetching after a write and optimistic updates, which today's refresh code does by hand. |
| Routing | TanStack Router | Typed route params, pairs with TanStack Query. |
| GitHub API | Octokit (`@octokit/core` with the REST and GraphQL plugins), GraphQL Code Generator against `@octokit/graphql-schema` | Typed queries and responses. |
| Diff | `@git-diff-view/react` | Unified and split views, highlighting, and widgets at a line for comment threads. |
| Rendered bodies | GitHub's `bodyHTML`, passed through DOMPurify | Renders exactly like GitHub, and is sanitised twice. |
| Lint and format | Biome | One dev dependency instead of ESLint + Prettier and their plugins. |
| Tests | Vitest, Testing Library, MSW for the GitHub API; `unittest` for `serve.py` | No test dependencies on the Python side. |
| Package manager | npm, with the lockfile committed and `npm ci` | Ships with Node; nothing extra to install. |
| Local server | `serve.py` stays Python, standard library only | It already reads the session files and works; a Node rewrite adds nothing for a local helper. |

## Rules this changes

1. **The dashboard writes to GitHub, and writing needs the GitHub App.** The README's "the
   dashboard never writes to GitHub - the token is read-only" goes.
   - The app declares the permissions once: *Pull requests* and *Contents* read and write (merging
     and committing suggestions need *Contents* write), and *Checks*, *Commit statuses* and
     *Actions* read.
   - The org approves the app once. Nobody has to build a token by hand, and admins can see,
     limit and revoke it.
   - Comments and reviews still show as the user, since the app acts on their behalf.
   - A read-only fine-grained token keeps working as a fallback with write actions hidden, for
     anyone without the app. A 403 on a write also hides the actions, with a note.
2. **No long-lived write token in the browser.**
   - The device flow needs no client secret, either for the first sign-in or for refreshing the
     token, so the app has no secret to share between users' machines.
   - GitHub's sign-in endpoints cannot be called from browser JavaScript, so `serve.py` runs the
     flow. It keeps the refresh token (6 months, renewed on every refresh) in a local file readable
     only by the user, and hands the page the 8-hour access token on the same loopback-only terms as
     `/sessions.json`. The page keeps it in memory only.
   - A leaked access token stops working within a working day. A PAT lasts up to a year.
3. **Only our own scripts run on the page.**
   - `serve.py` sends a strict Content Security Policy with the build: `script-src 'self'`,
     `connect-src` limited to `'self'` and `api.github.com`, and images from GitHub's hosts.
   - Every library is bundled at build time; nothing loads from a CDN.
   - Runtime dependencies stay few and each one is a deliberate choice, since they run next to a
     token that can write. Renovate updates them with a minimum release age.
4. **The app has a build step and needs Node.**
   - The "no build step, one `index.html`" rule goes. Building needs Node (current LTS, pinned in
     `.nvmrc` and `engines`).
   - `make serve` builds when the sources changed, then starts `serve.py`.
   - `make dev` runs Vite's dev server next to `serve.py` for hot reload.
   - Opening a file over `file://` no longer works.
5. **Nothing posts by accident.** Codex posts a comment typed in its summary or diff straight to
   GitHub. Here an inline comment goes into a pending review by default; posting at once is an
   explicit "Add single comment", as on GitHub. Unsent drafts are kept in `localStorage` per PR,
   file and line, so a live refresh or a reload never loses text.
6. **Changes are tested and checked in CI.** Pure logic (stack building, grouping, ticket
   parsing, the Copilot verdict, unresolved counts, diff line mapping) lives in modules without
   React and gets unit tests. Components get tests against a mocked GitHub API. A GitHub Actions
   workflow runs lint, type check, tests and build on every PR. `make test` runs the same locally.

## Stages

Each stage is one PR on top of the one below it, works on its own, and updates the README.

0. **Plan** - this document.
1. **Toolchain and shared logic, no visible change.**
   - Scaffold the app in `web/` (Vite, React, TypeScript, TanStack Query and Router, Biome,
     Vitest) with Makefile targets and the CI workflow.
   - Port the pure logic from `index.html` to TypeScript modules with unit tests that pin today's
     behaviour.
   - Add the GitHub API layer: Octokit, typed GraphQL, pagination, ETag conditional requests
     (which do not count against the rate limit), and rate-limit reporting.
   - The old `index.html` is still what `make serve` shows.
2. **The list in React, at parity.**
   - Rebuild today's list: the three tabs, by repo and by feature, stacks and their names,
     every badge, collapsing, filters, live refresh with the change check, the progress strip,
     session buttons, and the light and dark themes.
   - `serve.py` serves `web/dist` with the CSP, falls back to `index.html` for app routes, and
     gains its `unittest` suite.
   - The old `index.html` is deleted.
3. **Sign in with the GitHub App.**
   - Register the app in the Upheal org with the permissions above and the device flow enabled,
     and install it on the chosen repositories.
   - `serve.py` gains `/auth/start` (device code), `/auth/poll`, `/auth/token` (returns a fresh
     access token, refreshing when needed) and `/auth/sign-out`.
   - The page asks `/auth/token` at start and on a 401.
   - The fine-grained token stays as the read-only fallback.
   - The README documents both setups.
4. **Read-only PR detail.** Routing from the list; header, Conversation tab (description and the
   full timeline from one GraphQL query: comments, reviews with their threads, commits,
   force-pushes, review requests, label and title changes), Commits tab (list), sidebar, Stack and
   Sessions panels, read-only merge box. `/sessions.json` returns every session per PR, not only
   the newest. The live check also refreshes an open detail view.
5. **Diff viewer.** Files changed tab: file tree with filter and per-file collapse, unified and
   split views, syntax highlighting, renames, binary and large files, a fallback to the raw diff
   when the REST `patch` is truncated, expanding context from file contents at the base or head
   commit, existing threads shown at their lines and outdated ones listed apart. A single commit's
   diff, a range of commits, and "changes since my last review".
6. **Reviewing.** Pending review: inline comments on one line or a range, file-level comments,
   suggestion blocks from the selected lines; the Submit review dialog (Comment / Approve /
   Request changes, with a summary); reply to threads, resolve and unresolve, edit and delete your
   own comments, reactions; PR-level comments; mark files viewed (GitHub's own viewed state, so it
   syncs with github.com); re-request a review and dismiss one. Markdown editor with a preview
   from `POST /markdown`.
7. **Managing the PR.** Merge with the method and message; enable and disable auto-merge; add to
   and remove from the merge queue; update the branch; ready for review and back to draft; close
   and reopen; edit title and description; request and remove reviewers, assignees and labels;
   commit one or several suggestions (Git Data API).
8. **Checks and the agent loop.** Checks tab: check runs and statuses with annotations shown in
   the diff and links to the logs. **Fix with Claude**: build a prompt from failing checks and
   unresolved threads, copy it, and open the session that made the PR (or start a new one).
   **Review with Claude**: the same for a review session. Exactly how depends on open question 4.
9. **Polish.** Keyboard shortcuts (next file and thread, comment, mark viewed), an Unresolved
   filter in the conversation, hide whitespace (a client-side diff of the full files, since the API
   has no option), "new since you last opened" markers, lazy rendering for very large diffs, and a
   Playwright smoke test of the main flows.

## Open questions, with proposed answers

1. **Commit the built `web/dist`, so running the app needs no Node?** No. A build in git goes
   stale and doubles every diff; `make serve` builds it on first run.
2. **Who owns the GitHub App, and on which repositories is it installed?** A private app owned
   by the Upheal org, installed on the repositories we work in, registered by an org owner. A user
   token from an app only reaches repositories where the app is installed. PRs elsewhere (personal
   repos, open-source contributions) drop out of the list unless that user keeps the fine-grained
   token. The alternative of `serve.py` forwarding requests with `gh auth token` is rejected: it
   uses a broad classic token that never expires.
3. **Detail layout: full width or list beside it?** Full width, with previous and next PR. Diffs
   need the width. A collapsible list rail can come in stage 9 if it is missed.
4. **How does "Fix with Claude" reach a session?** First version: copy the prompt and open the
   session with its existing deep link. If the desktop app accepts a prompt in the link, or can
   start a new session from one, use that instead. Having `serve.py` run `claude` itself is
   possible, but means a local endpoint that starts agents, so it would need its own review.
5. **Linear in the detail view?** Not in this plan. It needs a second token in the browser. The
   ticket id the grouping already reads could become a plain link to the Linear issue at no cost.
6. **Merging from the dashboard** bypasses nothing: GitHub enforces branch protection and the
   merge queue as it does on github.com. Bypass-merge stays on github.com.

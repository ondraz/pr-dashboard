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
- **Routing in the URL hash:** `#/owner/repo/123`, `#/owner/repo/123/files`, `.../commits`,
  `.../checks`, `.../commits/<sha>`. Back and forward work, a PR link can be shared, and reloading
  keeps your place. An empty hash shows the list, with its scroll position, collapsed sections and
  tab kept.
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
- **Same constraints as today:** a static page, no build step, no backend beyond `serve.py`, and
  the browser talks to `api.github.com` directly.
- **Signing in through a GitHub App.** Writing to GitHub moves auth from a personal access token
  to a private GitHub App owned by the Upheal org. Each user signs in once with the device flow.
  `serve.py` holds the refresh token and gives the page only an access token that expires after 8
  hours.

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
     `/sessions.json`.
   - A leaked access token stops working within a working day. A PAT lasts up to a year.
3. **Only our own scripts run on the page.** The page gets a strict Content Security
   Policy (`script-src 'self'`, `connect-src` limited to `api.github.com` and the local server).
   This means no inline `onclick=` handlers (22 today) and no CDN scripts: third-party code is
   vendored, pinned, into `vendor/`. Comment and PR bodies are rendered from GitHub's own
   sanitised `bodyHTML` and passed through a vendored DOMPurify as well.
4. **The single file splits into native ES modules** (`index.html`, `css/`, `js/*.js`), still with
   no build step. Module scripts do not load over `file://`, so `make serve` becomes the only
   supported way to run it (the README already recommends it).
5. **Nothing posts by accident.** Codex posts a comment typed in its summary or diff straight to
   GitHub. Here an inline comment goes into a pending review by default; posting at once is an
   explicit "Add single comment", as on GitHub. Unsent drafts are kept in `localStorage` per PR,
   file and line, so a live refresh or a reload never loses text.
6. **Pure logic gets tests.** Diff parsing, line mapping, stack building and grouping move into
   modules without DOM access and get tests with Node's built-in test runner (`node --test`, no
   dependencies), run by `make test`.

## Stages

Each stage is one PR on top of the one below it, works on its own, and updates the README.

0. **Plan** - this document.
1. **Modules, router and CSP, no visible change.** Split `index.html` into modules; replace inline
   handlers with event delegation; add the CSP; add a shared API layer (`rest`, `graphql`,
   pagination, ETag conditional requests, which do not count against the rate limit, and
   rate-limit reporting); add the hash router with an empty detail route; add `make test` with
   tests for the existing stack and grouping logic. This touches every line, so it lands when no
   other PR against `index.html` is open.
2. **Read-only PR detail.** In-app routing from the list; header, Conversation tab (description
   and the full timeline from one GraphQL query: comments, reviews with their threads, commits,
   force-pushes, review requests, label and title changes), Commits tab (list), sidebar, Stack and
   Sessions panels, read-only merge box. `serve.py`'s `/sessions.json` returns every session per
   PR, not only the newest. The live check also refreshes an open detail view.
3. **Diff viewer.** Files changed tab: file tree with filter and per-file collapse, unified and
   split views, syntax highlighting (vendored highlight.js), renames, binary and large files, a
   fallback to the raw diff when the REST `patch` is truncated, expanding context from file
   contents at the base or head commit, existing threads shown at their lines and outdated ones
   listed apart. A single commit's diff, a range of commits, and "changes since my last review".
4. **Sign in with the GitHub App.**
   - Register the app in the Upheal org with the permissions above and the device flow enabled,
     and install it on the chosen repositories.
   - `serve.py` gains `/auth/start` (device code), `/auth/poll`, `/auth/token` (returns a fresh
     access token, refreshing when needed) and `/auth/sign-out`.
   - The page asks `/auth/token` before each refresh and on a 401, and keeps the access token in
     memory only.
   - The fine-grained token stays as the read-only fallback.
   - The README documents both setups.
5. **Reviewing (signed in with the app).** Pending review: inline comments on one line or a
   range, file-level comments, suggestion blocks from the selected lines; the Submit review dialog
   (Comment / Approve / Request changes, with a summary); reply to threads, resolve and unresolve,
   edit and delete your own comments, reactions; PR-level comments; mark files viewed (GitHub's
   own viewed state, so it syncs with github.com); re-request a review and dismiss one. Markdown
   editor with a preview from `POST /markdown`.
6. **Managing the PR.** Merge with the method and message; enable and disable auto-merge; add to
   and remove from the merge queue; update the branch; ready for review and back to draft; close
   and reopen; edit title and description; request and remove reviewers, assignees and labels;
   commit one or several suggestions (Git Data API).
7. **Checks and the agent loop.** Checks tab: check runs and statuses with annotations shown in
   the diff and links to the logs. **Fix with Claude**: build a prompt from failing checks and
   unresolved threads, copy it, and open the session that made the PR (or start a new one).
   **Review with Claude**: the same for a review session. Exactly how depends on open question 4.
8. **Polish.** Keyboard shortcuts (next file and thread, comment, mark viewed), an Unresolved
   filter in the conversation, hide whitespace (a client-side diff of the full files, since the API
   has no option), "new since you last opened" markers, and lazy rendering for very large diffs.

## Open questions, with proposed answers

1. **Drop `file://` support for ES modules?** Yes. The alternative is keeping one growing file of
   several thousand lines, which is hard to review and impossible to test.
2. **Who owns the GitHub App, and on which repositories is it installed?** A private app owned
   by the Upheal org, installed on the repositories we work in, registered by an org owner. A user
   token from an app only reaches repositories where the app is installed. PRs elsewhere (personal
   repos, open-source contributions) drop out of the list unless that user keeps the fine-grained
   token. The alternative of `serve.py` forwarding requests with `gh auth token` is rejected: it
   uses a broad classic token that never expires.
3. **Detail layout: full width or list beside it?** Full width, with previous and next PR. Diffs
   need the width. A collapsible list rail can come in stage 8 if it is missed.
4. **How does "Fix with Claude" reach a session?** First version: copy the prompt and open the
   session with its existing deep link. If the desktop app accepts a prompt in the link, or can
   start a new session from one, use that instead. Having `serve.py` run `claude` itself is
   possible, but means a local endpoint that starts agents, so it would need its own review.
5. **Linear in the detail view?** Not in this plan. It needs a second token in the browser. The
   ticket id the grouping already reads could become a plain link to the Linear issue at no cost.
6. **Merging from the dashboard** bypasses nothing: GitHub enforces branch protection and the
   merge queue as it does on github.com. Bypass-merge stays on github.com.

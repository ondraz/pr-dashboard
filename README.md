# pr-dashboard

Single-page dashboard listing all your open pull requests across every repository you
have access to, grouped by repository. Like [GitHub Pulls](https://github.com/pulls),
but grouped per repo, aware of stacked PRs, and able to show one change spread over
several repositories as a single set.

A React app that talks to the GitHub API straight from the browser, served by a small local Node
server that signs you in through the dashboard's GitHub App and tells the page which Claude session
made each PR. GitHub data never passes through the server.

## Features

- Your open PRs across all repositories, grouped by repository
- Stacked PRs render as a single connected chain with the base at the bottom, each one
  showing the PR it is based on, including a colleague's PR your stack sits on
- Named stacks: a `Stack: <name>` line on its own in any member's description names the
  stack in its header, so a collapsed stack still says what it is. The member nearest the
  base wins if several declare one; without any, the bottom PR's title stands in, greyed
- Cross-repo changes group into one block, so a feature implemented across several
  repositories reads as one unit (see [Cross-repo grouping](#cross-repo-grouping))
- Review status: approved, changes requested, or pending with the requested reviewers
- Unresolved review threads counted per PR, Copilot's standing verdict included, and
  totalled on every repository and feature header so a collapsed section still shows there
  is work left in it (see [Unresolved comments](#unresolved-comments))
- Auto-merge badge, naming the merge method, on any PR GitHub will land by itself once its
  checks and reviews pass; once the PR enters a merge queue it shows `Merge queue #N` instead
- Conflicts badge on any PR GitHub cannot merge until its conflicts with the base branch are
  resolved; GitHub works mergeability out in the background after a push, so a fresh conflict
  can take one more refresh to appear
- Tabs for your own PRs, PRs waiting for your review, and PRs you have reviewed that are
  not merged yet (grouped by where your review stands), each with a count that follows the
  current filters; the selected tab is remembered across reloads
- Draft state, with filters for all / ready / draft
- Age filter: recently updated (last two weeks) or all time
- Collapsible feature, repository and stack sections, remembered across reloads
- Live refresh (the default): a cheap check every 15 seconds, and a full refresh only when
  something changed; or a fixed auto-refresh of 1m, 5m, 30m, 1h, or on tab focus
- Every refresh, manual or automatic, shows a progress strip across the top of the window,
  a spinner in the Refresh button, and how far each phase has got
  (`Loading... repositories 3/8 · reviews 12/40 · comments 20/40`) where `Updated ... ago`
  sits; the previous list stays on screen, faded, until it lands
- A `Claude` button on any PR a Claude desktop session created or pushed, which opens that
  session in the desktop app (see [Claude sessions](#claude-sessions))
- Light and dark theme, following the system setting

## Cross-repo grouping

GitHub has no notion of a pull request that spans repositories: one change split over an
API, its consumer and its infrastructure is three unrelated PRs as far as it is concerned.
The dashboard reconstructs the set from signals the PRs already carry, so nothing has to
change about how they are opened.

A PR's group key is the first of these that matches:

1. **`Part-of:` in the body** - `Part-of: camelcase-refactor` on its own line. Free text,
   case-insensitive, and it always wins. This is the escape hatch for a set that shares
   neither a ticket nor a branch name.
2. **A ticket id** at the start of the title (`L-686: emit an ordered timeline`) or at the
   start of a branch segment (`l-686-timeline`, `ondra/ai-624-full-scale`).
3. **The branch name**, when it is identical in both repositories - the usual shape of a
   ticket-less change spread by hand.

Anchoring the ticket pattern keeps version numbers and library names in the middle of a
title from being read as ticket ids, and default branch names (`master`, `main`, ...) are
never used as a key, so two unrelated PRs opened from a fork's default branch stay apart.

A key only forms a group when **your own PRs carry it in two or more repositories** - a key
confined to one repo is just a branch. Once a group exists, a PR by someone else that one of
your PRs is stacked on joins it as muted context when it shares the key. Stacks keep working
inside a group: a chain in one repo renders as a chain.

**By repo** is the default view and is unchanged, except that a PR belonging to a
cross-repo set gets a badge naming the key and the number of repositories; clicking it
switches to **By feature** and jumps to the group. **By feature** puts the cross-repo sets
first, split by repository inside, and collects everything else under Single-repo work.

The grouping is display only and does not gate merges.

## Unresolved comments

A PR carries an `N unresolved` badge counting what it still owes, which is the one thing
that says which PR needs another round of fixes. The badge links to the diff, and the
tooltip breaks the number down. Two things go into it.

**Review threads nobody has resolved**, the same number GitHub shows as unresolved
conversations, whoever wrote them - Copilot's inline comments are threads like anyone
else's. The tooltip also gives how many comments sit inside those threads, so one thread
with a long back-and-forth does not read as five separate things to do.

**Copilot's standing verdict**, when it asks for changes. Copilot reviews every push and
names what it concluded in a heading - `Changes recommended`, `Needs a closer look`,
`Approval recommended` - and only the newest one describes the code as it is now. A verdict
that asked for changes but generated no inline comment leaves no thread to resolve and
would otherwise be invisible, so it counts as one item and the badge links to the review
itself. A verdict that did leave inline comments is left out: while they are open they
already count, and once they are all resolved the verdict has been answered and the badge
drops to zero. `Needs a closer look` asks a human to verify what Copilot could not, not for
a change, so it counts as nothing, like an approval. A review that read no files, or failed
outright, is not a verdict and counts as nothing.

Neither resolution state nor the verdict exists in the REST API, so this is the one part of
the dashboard that goes through GraphQL. The token needs nothing extra: the same
`Pull requests` read access covers it. If the query fails the badge is simply absent, the
rest of the dashboard is unaffected, and the reason is logged to the browser console.

## Setup

There are two ways to sign in. The GitHub App is the one to use; a fine-grained token is the
read-only fallback for anyone the app does not cover.

### Sign in with the GitHub App

Once the app is configured (below), **Sign in with GitHub** shows a code to enter at
[github.com/login/device](https://github.com/login/device). The local server runs GitHub's device
flow, keeps the refresh token in `~/.config/pr-dashboard/auth.json` (readable only by you;
`$XDG_CONFIG_HOME` or `PR_DASHBOARD_AUTH_FILE` move it), and hands the page only the access token,
which expires after 8 hours. The page holds it in memory, asks the server for it on every load,
and asks again shortly before it expires or when GitHub answers 401; the server refreshes it from
the refresh token, which lasts six months and is renewed by every refresh, so you sign in again
only after six months without using the dashboard. **Sign out** deletes the file. GitHub keeps the
authorization until you revoke it under
[Settings > Applications > Authorized GitHub Apps](https://github.com/settings/apps/authorizations).

The app only reaches repositories it is installed on. A PR anywhere else (a personal repository,
an open-source contribution) drops out of the list. A fine-grained token still reaches those, but
only while you are signed out of the app, since the app's token wins when both are there.

**Registering the app** is done once, by an owner of the organization:

1. Under the organization's **Settings > Developer settings > GitHub Apps**, click
   **New GitHub App**
2. Name it (e.g. `pr-dashboard`) and set **Homepage URL** to this repository. Leave **Callback
   URL** empty, keep **Expire user authorization tokens** on, and tick **Enable Device Flow**
3. Under **Webhook**, untick **Active**
4. Under **Repository permissions**, set **Pull requests** and **Contents** to **Read and
   write**, and **Checks**, **Commit statuses** and **Actions** to **Read-only**. The write
   permissions are for the review and merge actions the dashboard is gaining; nothing writes yet
5. Under **Where can this GitHub App be installed?**, pick **Only on this account**, then
   **Create GitHub App**
6. Under **Install App**, install it on the organization and choose the repositories to include
7. Share the **Client ID** from the app's **General** page. It is not a secret, and the app needs
   no client secret or private key: the device flow works without one

**Configuring it** on each machine: put the client id in `config.local.json` at the root of this
repository (gitignored), or in `PR_DASHBOARD_CLIENT_ID`, which wins, and restart the server.

```json
{ "githubAppClientId": "Iv23li..." }
```

Without a client id the page offers only the token below.

### Fine-grained token (read-only fallback)

1. Go to [GitHub fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. Set **Token name** (e.g. `pr-dashboard`) and **Expiration** (max 366 days)
3. Under **Resource owner**, select yourself or the organization whose PRs you want to see
4. Under **Repository access**, pick the repositories to include
5. Under **Permissions > Repository permissions**, set **Pull requests** to **Read-only**
6. Click **Generate token**. A token scoped to an organization has to be approved by an
   org owner before it works
7. Run `make serve` to open the dashboard, then paste the token

Tick **Remember across sessions** to keep the token in `localStorage`; otherwise it lives
in `sessionStorage` and is gone when the tab closes. **Clear token** removes it. The token
never leaves the browser except in requests to `api.github.com`. When you are signed in through
the app as well, the app's token is used.

## Running

Needs Node 24 or newer (the version is pinned in `.nvmrc`), which runs the server's TypeScript
directly. The first `make serve` installs the dependencies with `npm ci`, and every `make serve`
builds the app into `web/dist` first when its sources changed.

```bash
make serve          # serve on http://localhost:6789 and open a browser
make serve PORT=8080
make stop           # stop the server
make dev            # the same server in the foreground, with Vite for hot reload
```

The server binds to `127.0.0.1` and serves the built app, `/sessions.json` and the sign-in routes
under `/auth/`. A path without a
file name gets the app's page, so a link into the app survives a reload; any other path that is
not a file of the build is a 404. The page comes with a strict Content Security Policy: only the
bundle's own scripts and styles run, it connects only to the server and `api.github.com`, and it
shows images only from GitHub. Every library is bundled at build time; nothing loads from a CDN.
Under `make dev` Vite serves the page instead, without that policy, since its hot reload runs
inline scripts.

The app needs the server: opening the build over `file://` does not work.

## Claude sessions

`make serve` runs the server in [server/](server/), which serves the page and also answers
`/sessions.json`: each PR URL mapped to the most recently active Claude session that made it,
and to the one that reviewed it. It reads two places:

- The Claude desktop app records, per Code session, the PRs that session created or pushed, in
  `~/Library/Application Support/Claude/claude-code-sessions`. A PR the session only mentioned
  does not count. The **Claude** button links to `claude://claude.ai/epitaxy/<session>`, which
  the desktop app opens; an archived session shows faded.
- Claude Code in VS Code or the terminal writes a transcript per session under
  `~/.claude/projects`, with a `pr-link` line for each PR it notices. A PR counts as made when
  the tool call just before that line ran `git push` or `gh pr create`, and as reviewed when it
  posted a review or a comment. The **VS Code** button links to
  `vscode://anthropic.claude-code/open?session=<id>`. Each transcript is re-read only when it
  changes.

Your own PRs show the session that made them; the two review tabs show the session that
reviewed them.

The list is read on every refresh and only answered to a loopback Host (`localhost`,
`127.0.0.1` or `[::1]`), with no CORS header, so other sites cannot read it. Served any other
way (a plain static server) the request fails quietly and the button is simply absent.

## Collapsing

Every group header - a cross-repo feature, a repository, a repository inside a feature
group, and a stack - is a toggle: click it, or focus it and press Enter or Space. The
repository link in a header still opens GitHub rather than collapsing the section.

Collapsed sections are stored in `localStorage` and survive reloads and refreshes. Only the
collapsed ones are recorded, so anything new - a repository you just opened a PR in, a stack
that grew a member - starts expanded. A repository collapsed in **By repo** stays open
inside a feature group, since there it is one part of a wider change rather than the
heading.

## Notes

Each refresh costs a search call plus one details call and one review call per PR (yours and
the ones waiting for or reviewed by you), one
lookup per colleague PR a stack of yours sits on, and one GraphQL query per 10 PRs for the
unresolved counts. Only your own PRs are fetched, never a repository's whole open-PR list,
so a busy repository costs no more than a quiet one. Once the search returns, the REST calls
and the GraphQL queries run at once, each through its own small pool (12 and 3 requests in
flight). A stack is followed down through at most 5 colleague PRs. At most 500 review threads are counted
per PR, and Copilot's verdict is looked for in that PR's 20 most recent reviews. Cross-repo grouping adds no requests:
titles, branch names and bodies all come from responses already being fetched.

In live mode the change check is one GraphQL query (1 point of the 5,000-an-hour budget) every
15 seconds while the tab is visible, about 240 points an hour. It compares which PRs each tab
holds and each one's last update, head commit, mergeability, review decision, draft state and
merge-queue position; a new or closed PR can take a minute to show, since GitHub's search index
lags behind. A check run finishing does not count as a change, as the dashboard shows no CI.

## Development

```bash
make test           # codegen, lint, type check, tests and build, as CI runs them on every PR
make build          # build the React app into web/dist when its sources changed
make codegen        # regenerate the GraphQL types after changing a query
make format         # format and fix lint findings with Biome
```

`server/` holds the local server (Hono on `node:http`, run by Node without a build), and
`shared/` the types of the payloads it answers. Its sign-in routes (`/auth/token`, `/auth/start`,
`/auth/poll`, `/auth/sign-out`) are POST only, answer only a loopback `Host`, and refuse any
request whose `Origin` or `Sec-Fetch-Site` says it comes from another site, so no other page can
start a sign-in, sign you out or read the token; their tests run against a scripted stand-in for
GitHub's sign-in endpoints. Tests run with Vitest; the session parsing is
pinned against the fictional session files in `server/fixtures/`. Dependencies are pinned
exactly, and `.npmrc` keeps npm from installing any version less than two weeks old.

`web/` is the React app (Vite, TanStack Query and Router); see
[the plan](docs/review-app-plan.md) for where it is going. `web/src/list/` is the list page.
`web/src/logic/` holds the dashboard's rules - stack building, cross-repo grouping, ticket
parsing, the Copilot verdict, unresolved counts, review standing, filters and the list layout -
as plain TypeScript without React or I/O, each pinned by unit tests.

`web/src/github/` is the GitHub API layer the app loads through: Octokit with REST
pagination, typed GraphQL documents whose types GraphQL Code Generator writes into
`web/src/github/gql/` from GitHub's published schema (committed; CI fails when they are stale),
and the loaders for the three tabs. Every GET that returned an ETag is asked for again with
`If-None-Match`, so an unchanged resource comes back as a 304, which does not count against the
rate limit, and each response's rate-limit headers are collected per bucket for the page to
show. Its tests, and the list's component tests (Testing Library on jsdom), run against a GitHub API
mocked with MSW; nothing in them reaches GitHub.

## License

[MIT](LICENSE)

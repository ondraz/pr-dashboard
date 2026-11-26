# pr-dashboard

Single-page dashboard listing all your open pull requests across every repository you
have access to, grouped by repository. Like [GitHub Pulls](https://github.com/pulls),
but grouped per repo, aware of stacked PRs, and able to show one change spread over
several repositories as a single set.

No build step and no backend: one static `index.html` that talks to the GitHub REST API
straight from the browser with a token you provide.

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

The grouping is display only. It does not gate merges, and the dashboard never writes to
GitHub - the token is read-only.

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
never leaves the browser except in requests to `api.github.com`.

## Running

```bash
make serve          # serve on http://localhost:6789 and open a browser
make serve PORT=8080
make stop           # stop the server
```

Opening `index.html` directly over `file://` also works in Safari, which isolates
`localStorage` per file. Firefox and Chrome share `localStorage` across all local files,
so any other local page could read the token there - use the localhost server instead.

## Claude sessions

The Claude desktop app records, per Code session, the PRs that session created or pushed.
`make serve` runs [serve.py](serve.py), which serves the page and also answers
`/sessions.json`: each PR URL mapped to the most recently active session that made it, read
from `~/Library/Application Support/Claude/claude-code-sessions`. A PR the session only
mentioned does not count. The button links to `claude://claude.ai/epitaxy/<session>`, which
the desktop app opens; an archived session shows faded.

The list is read on every refresh and only answered to a `localhost` / `127.0.0.1` Host,
with no CORS header, so other sites cannot read it. Served any other way (`file://`, a plain
static server) the request fails quietly and the button is simply absent.

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

Each refresh costs a search call plus one details call and one review call per PR, one
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

## License

[MIT](LICENSE)

# pr-dashboard

Single-page dashboard listing all your open pull requests across every repository you
have access to, grouped by repository. Like [GitHub Pulls](https://github.com/pulls),
but grouped per repo, aware of stacked PRs, and able to show one change spread over
several repositories as a single set.

No build step and no backend: one static `index.html` that talks to the GitHub REST API
straight from the browser with a token you provide.

## Features

- Your open PRs across all repositories, grouped by repository
- Stacked PRs render as a single connected chain in merge order, each one showing the PR
  it is based on
- Cross-repo changes group into one block, so a feature implemented across several
  repositories reads as one unit (see [Cross-repo grouping](#cross-repo-grouping))
- Review status: approved, changes requested, or pending with the requested reviewers
- Draft state, with filters for all / ready / draft
- Age filter: recently updated (last two weeks) or all time
- Collapsible feature, repository and stack sections, remembered across reloads
- Configurable auto-refresh: 1m, 5m, 30m, 1h, or on tab focus
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
confined to one repo is just a branch. Once a group exists, open PRs by other people that
share the key join it as muted context, as long as they are in a repository you also have a
PR in. Stacks keep working inside a group: a chain in one repo renders as a chain.

**By repo** is the default view and is unchanged, except that a PR belonging to a
cross-repo set gets a badge naming the key and the number of repositories; clicking it
switches to **By feature** and jumps to the group. **By feature** puts the cross-repo sets
first, split by repository inside, and collects everything else under Single-repo work.

The grouping is display only. It does not gate merges, and the dashboard never writes to
GitHub - the token is read-only.

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

Each refresh costs a search call plus one open-PR listing per repository you have a PR in,
and one review call per PR. At most 500 open PRs per repository are scanned for stack
links, taking the most recently updated ones first. Cross-repo grouping adds no requests:
titles, branch names and bodies all come from responses already being fetched.

## License

[MIT](LICENSE)

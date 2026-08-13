# pr-dashboard

Single-page dashboard listing all your open pull requests across every repository you
have access to, grouped by repository. Like [GitHub Pulls](https://github.com/pulls),
but grouped per repo and aware of stacked PRs.

No build step and no backend: one static `index.html` that talks to the GitHub REST API
straight from the browser with a token you provide.

## Features

- Your open PRs across all repositories, grouped by repository
- Stacked PRs render as a single connected chain in merge order, each one showing the PR
  it is based on
- Review status: approved, changes requested, or pending with the requested reviewers
- Draft state, with filters for all / ready / draft
- Age filter: recently updated (last two weeks) or all time
- Configurable auto-refresh: 1m, 5m, 30m, 1h, or on tab focus
- Light and dark theme, following the system setting

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

## Notes

Each refresh costs a search call plus one open-PR listing per repository you have a PR in,
and one review call per PR. At most 500 open PRs per repository are scanned for stack
links, taking the most recently updated ones first.

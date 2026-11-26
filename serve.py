#!/usr/bin/env python3
"""Serve the dashboard on localhost, plus /sessions.json: which Claude session made or reviewed each PR.

The page cannot read the desktop app's session files itself, so this answers for it. Only
loopback Host headers are served, so a site that rebinds its own name to 127.0.0.1 cannot
read the session list, and no CORS header is sent, so no other origin can either.
"""

import argparse
import functools
import json
import re
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SESSIONS_DIR = Path.home() / "Library/Application Support/Claude/claude-code-sessions"
PROJECTS_DIR = Path.home() / ".claude/projects"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def pr_sessions(sessions_dir: Path, projects_dir: Path) -> dict[str, dict[str, dict]]:
    """Map PR URLs to the most recently active session that made them, and that reviewed them.

    `made` counts a PR the session created or pushed; the desktop app marks a PR it only saw
    `onlySeen`, and that does not count. `reviewed` counts a PR the session posted a review or
    comment on, which only the CLI transcripts record.
    """
    made: dict[str, dict] = {}
    desktop_by_cli: dict[str, dict] = {}
    for path in sessions_dir.glob("*/*/local_*.json"):
        try:
            session = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        entry = {
            "id": session.get("sessionId"),
            "title": session.get("title") or "",
            "archived": bool(session.get("isArchived")),
            "lastActivityAt": session.get("lastActivityAt") or 0,
        }
        if not entry["id"]:
            continue
        if session.get("cliSessionId"):
            desktop_by_cli[session["cliSessionId"]] = entry
        for pr in session.get("prs") or []:
            url = pr.get("url")
            if url and not pr.get("onlySeen"):
                _keep_newest(made, url, entry)
    cli_made, reviewed = cli_pr_sessions(projects_dir, desktop_by_cli)
    for url, entry in cli_made.items():
        _keep_newest(made, url, entry)
    return {"made": made, "reviewed": reviewed}


def _keep_newest(best: dict[str, dict], url: str, entry: dict) -> None:
    if url not in best or entry["lastActivityAt"] > best[url]["lastActivityAt"]:
        best[url] = entry


# Commands and tools that publish a review or a comment on a PR.
REVIEW_ACTION = re.compile(
    r"gh pr (review|comment)\b"
    r"|gh api\b[^|;&]*/(pulls/\d+/(reviews|comments)|issues/\d+/comments)"
    r"|^mcp__github__\S*(review|comment)"
    r"|^Skill code-review\b.*--comment"
)

_transcript_cache: dict[Path, tuple[float, dict]] = {}


def _scan_transcript(path: Path) -> dict:
    """Read one CLI/VS Code transcript: its title, and the PRs it made and reviewed.

    The CLI writes a `pr-link` line for any PR it notices, including ones it only viewed, so a
    link counts by the tool call just before it: `git push` or `gh pr create` made the PR, a
    review or comment posted on it reviewed it.
    """
    title, made, reviewed, last_action = "", set(), set(), ""
    with path.open(errors="ignore") as f:
        for line in f:
            if '"tool_use"' in line:
                try:
                    message = json.loads(line).get("message") or {}
                except ValueError:
                    continue
                for block in message.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_input = block.get("input") or {}
                        last_action = tool_input.get("command") or " ".join(
                            str(part) for part in (block.get("name"), tool_input.get("skill"), tool_input.get("args")) if part
                        )
            elif '"pr-link"' in line or '"ai-title"' in line:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if record.get("type") == "ai-title":
                    title = record.get("aiTitle") or title
                elif record.get("type") == "pr-link" and record.get("prUrl"):
                    if "git push" in last_action or "gh pr create" in last_action:
                        made.add(record["prUrl"])
                    elif REVIEW_ACTION.search(last_action):
                        reviewed.add(record["prUrl"])
    return {"title": title, "made": made, "reviewed": reviewed}


def cli_pr_sessions(projects_dir: Path, desktop_by_cli: dict[str, dict]) -> tuple[dict, dict]:
    """The `made` and `reviewed` maps from CLI and VS Code transcripts.

    A transcript behind a desktop session links to that session; its PRs made are already in
    the desktop record, so only its reviews are taken. Each file is re-read only when its mtime
    changes.
    """
    made: dict[str, dict] = {}
    reviewed: dict[str, dict] = {}
    for path in projects_dir.glob("*/*.jsonl"):
        try:
            mtime = path.stat().st_mtime
            cached = _transcript_cache.get(path)
            if not cached or cached[0] != mtime:
                cached = (mtime, _scan_transcript(path))
                _transcript_cache[path] = cached
        except OSError:
            continue
        scan = cached[1]
        desktop = desktop_by_cli.get(path.stem)
        entry = desktop or {
            "id": path.stem,
            "kind": "cli",
            "title": scan["title"],
            "archived": False,
            "lastActivityAt": int(mtime * 1000),
        }
        if not desktop:
            for url in scan["made"]:
                _keep_newest(made, url, entry)
        for url in scan["reviewed"]:
            _keep_newest(reviewed, url, entry)
    return made, reviewed


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if host not in LOOPBACK_HOSTS:
            self.send_error(HTTPStatus.FORBIDDEN, "Only served to localhost")
            return
        if self.path.split("?", 1)[0] == "/sessions.json":
            body = json.dumps(pr_sessions(SESSIONS_DIR, PROJECTS_DIR)).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, format, *args):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("port", type=int, nargs="?", default=6789)
    args = parser.parse_args()
    handler = functools.partial(Handler, directory=str(Path(__file__).resolve().parent))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == "__main__":
    main()

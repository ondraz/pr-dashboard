#!/usr/bin/env python3
"""Serve the dashboard on localhost, plus /sessions.json: which Claude desktop session made each PR.

The page cannot read the desktop app's session files itself, so this answers for it. Only
loopback Host headers are served, so a site that rebinds its own name to 127.0.0.1 cannot
read the session list, and no CORS header is sent, so no other origin can either.
"""

import argparse
import functools
import json
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SESSIONS_DIR = Path.home() / "Library/Application Support/Claude/claude-code-sessions"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def pr_sessions(sessions_dir: Path) -> dict[str, dict]:
    """Map each PR URL to the most recently active session that created or pushed it.

    A PR the app marks `onlySeen` was merely mentioned in the session, so it does not count.
    """
    best: dict[str, dict] = {}
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
        for pr in session.get("prs") or []:
            url = pr.get("url")
            if not url or pr.get("onlySeen"):
                continue
            if url not in best or entry["lastActivityAt"] > best[url]["lastActivityAt"]:
                best[url] = entry
    return best


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if host not in LOOPBACK_HOSTS:
            self.send_error(HTTPStatus.FORBIDDEN, "Only served to localhost")
            return
        if self.path.split("?", 1)[0] == "/sessions.json":
            body = json.dumps(pr_sessions(SESSIONS_DIR)).encode()
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

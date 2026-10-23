"""Thin client for the piano-steps HTTP API (docs/api-for-agents.md). Standard library only.

This module is the transcriber's ONLY connection to the app: no DB access, no imports from the
TypeScript packages — so the transcriber can move to its own service unchanged.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_BASE = "http://127.0.0.1:9300"


class ApiError(RuntimeError):
    def __init__(self, status: int, body: Any, url: str):
        self.status = status
        self.body = body
        details = ""
        if isinstance(body, dict):
            details = body.get("error", "") + "".join(f"\n  {d}" for d in body.get("details", []) or [])
        super().__init__(f"{status} from {url}: {details or body}")


class Api:
    def __init__(self, base: str | None = None, token: str | None = None, timeout: float = 60):
        self.base = (base or os.environ.get("PIANO_STEPS_URL") or DEFAULT_BASE).rstrip("/")
        self.token = token if token is not None else os.environ.get("PIANO_STEPS_API_TOKEN") or None
        self.timeout = timeout

    # ── plumbing ──────────────────────────────────────────────────────────
    def _request(self, method: str, path: str, body: Any = None, query: dict | None = None) -> Any:
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        data = None
        headers = {"accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        if self.token and method != "GET":
            headers["authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = raw.decode(errors="replace")
            raise ApiError(e.code, parsed, url) from None
        except urllib.error.URLError as e:
            raise ApiError(0, f"cannot reach the app ({e.reason}); is it running? base={self.base}", url) from None

    # ── endpoints ─────────────────────────────────────────────────────────
    def health(self) -> dict:
        return self._request("GET", "/api/health")

    def create_lesson(self, lesson: dict, upsert: bool = True) -> dict:
        return self._request("POST", "/api/lessons", lesson, {"upsert": "true" if upsert else None})

    def get_lesson(self, ref: str) -> dict:
        return self._request("GET", f"/api/lessons/{urllib.parse.quote(ref)}")

    def replace_fragment_notes(self, ref: str, position: int, notes: list[dict]) -> dict:
        return self._request(
            "PUT", f"/api/lessons/{urllib.parse.quote(ref)}/fragments/{position}/notes", {"notes": notes}
        )

    def list_feedback(self, status: str | None = "open", lesson: str | None = None) -> list[dict]:
        return self._request("GET", "/api/feedback", query={"status": status, "lesson": lesson})["feedback"]

    def update_feedback(self, fid: str, status: str | None = None, resolution: str | None = None) -> dict:
        body = {k: v for k, v in {"status": status, "resolution": resolution}.items() if v is not None}
        return self._request("PATCH", f"/api/feedback/{urllib.parse.quote(fid)}", body)

    def web_url(self, slug: str) -> str:
        """Where the user opens the lesson. The web app and the API share an origin in Docker and
        behind Vite's proxy; override with PIANO_STEPS_WEB_URL when they differ."""
        web = (os.environ.get("PIANO_STEPS_WEB_URL") or self.base).rstrip("/")
        return f"{web}/?lesson={urllib.parse.quote(slug)}"

"""Tests for the transcript segment-count cost guard.

The cap is enforced at the Pydantic model layer (max_length=1000 on
``AppendTranscriptRequest.segments``), so over-limit requests get a 422
Unprocessable Entity before any route handler runs.  Tests run with
``DEV_AUTH_BYPASS=1`` so auth doesn't interfere.
"""

from __future__ import annotations

import importlib
import sys

import pytest
from fastapi.testclient import TestClient


def _make_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("DEV_AUTH_BYPASS", "1")
    monkeypatch.setenv("DEV_FAKE_TOKEN", "1")
    monkeypatch.setenv("ALLOWED_EMAILS", "")
    monkeypatch.setenv("GCP_PROJECT", "test-project")

    for mod in ("config", "auth", "main"):
        if mod in sys.modules:
            importlib.reload(sys.modules[mod])

    from main import app  # noqa: PLC0415

    return TestClient(app, raise_server_exceptions=False)


def _segment(i: int) -> dict:
    return {"text": f"segment {i}", "ts": 1_000_000 + i}


def _make_session(client: TestClient) -> str:
    resp = client.post("/api/sessions", json={"title": "Limit test"})
    assert resp.status_code == 200
    return resp.json()["id"]


class TestSegmentCountLimit:
    def test_zero_segments_accepted(self, monkeypatch):
        client = _make_client(monkeypatch)
        sid = _make_session(client)
        resp = client.post(
            f"/api/sessions/{sid}/transcript", json={"segments": []}
        )
        # Empty list is valid (no segments to write).
        assert resp.status_code == 200

    def test_one_segment_accepted(self, monkeypatch):
        client = _make_client(monkeypatch)
        sid = _make_session(client)
        resp = client.post(
            f"/api/sessions/{sid}/transcript",
            json={"segments": [_segment(1)]},
        )
        assert resp.status_code == 200

    def test_exactly_1000_segments_accepted(self, monkeypatch):
        client = _make_client(monkeypatch)
        sid = _make_session(client)
        resp = client.post(
            f"/api/sessions/{sid}/transcript",
            json={"segments": [_segment(i) for i in range(1000)]},
        )
        assert resp.status_code == 200

    def test_1001_segments_rejected(self, monkeypatch):
        """One segment over the limit must return 422 (Pydantic validation error)."""
        client = _make_client(monkeypatch)
        sid = _make_session(client)
        resp = client.post(
            f"/api/sessions/{sid}/transcript",
            json={"segments": [_segment(i) for i in range(1001)]},
        )
        assert resp.status_code == 422

    def test_large_batch_rejected(self, monkeypatch):
        """A grossly oversized batch (e.g. 5000) must also be rejected."""
        client = _make_client(monkeypatch)
        sid = _make_session(client)
        resp = client.post(
            f"/api/sessions/{sid}/transcript",
            json={"segments": [_segment(i) for i in range(5000)]},
        )
        assert resp.status_code == 422

"""Tests for session and transcript storage.

Covers LocalStorage directly and the init_storage() fallback behaviour when
Firestore is unconfigured.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from models import CreateSessionRequest, Segment


# ---------------------------------------------------------------------------
# Session creation
# ---------------------------------------------------------------------------

class TestSessionCreate:
    def test_returns_non_empty_string_id(self, client) -> None:
        resp = client.post("/api/sessions", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert isinstance(data["id"], str)
        assert len(data["id"]) > 0

    def test_different_sessions_have_unique_ids(self, client) -> None:
        id1 = client.post("/api/sessions", json={}).json()["id"]
        id2 = client.post("/api/sessions", json={}).json()["id"]
        assert id1 != id2

    def test_session_with_title(self, client) -> None:
        resp = client.post("/api/sessions", json={"title": "Campaign night 1"})
        assert resp.status_code == 200
        assert "id" in resp.json()


# ---------------------------------------------------------------------------
# Transcript append + retrieval (LocalStorage)
# ---------------------------------------------------------------------------

class TestTranscriptAppend:
    def test_append_segments_returns_count(self, client) -> None:
        session_id = client.post("/api/sessions", json={}).json()["id"]
        segments = [
            {"text": "Hello world", "ts": 1000, "startTime": 0.0},
            {"text": "Second segment", "ts": 2000, "startTime": 1.0},
        ]
        resp = client.post(
            f"/api/sessions/{session_id}/transcript", json={"segments": segments}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["count"] == 2

    def test_segments_stored_on_disk(self, client, tmp_storage: Path) -> None:
        session_id = client.post("/api/sessions", json={}).json()["id"]
        client.post(
            f"/api/sessions/{session_id}/transcript",
            json={"segments": [{"text": "stored text", "ts": 1234}]},
        )
        transcript_path = tmp_storage / session_id / "transcript.jsonl"
        assert transcript_path.exists()
        lines = transcript_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        stored = json.loads(lines[0])
        assert stored["text"] == "stored text"

    def test_append_accumulates_across_calls(self, client, tmp_storage: Path) -> None:
        session_id = client.post("/api/sessions", json={}).json()["id"]
        client.post(
            f"/api/sessions/{session_id}/transcript",
            json={"segments": [{"text": "first", "ts": 1}]},
        )
        client.post(
            f"/api/sessions/{session_id}/transcript",
            json={"segments": [{"text": "second", "ts": 2}, {"text": "third", "ts": 3}]},
        )
        lines = (tmp_storage / session_id / "transcript.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 3


# ---------------------------------------------------------------------------
# Hebrew UTF-8 round-trip
# ---------------------------------------------------------------------------

class TestHebrewUtf8:
    def test_hebrew_text_roundtrips_without_mojibake(self, client, tmp_storage: Path) -> None:
        # Ensure Hebrew text is written with ensure_ascii=False and reads back correctly.
        hebrew = "שלום עולם"  # "שלום עולם"
        session_id = client.post("/api/sessions", json={"title": hebrew}).json()["id"]

        # Write Hebrew into transcript as well.
        client.post(
            f"/api/sessions/{session_id}/transcript",
            json={"segments": [{"text": hebrew, "ts": 100}]},
        )

        # Read back raw bytes and verify no Unicode escape sequences were written.
        raw_bytes = (tmp_storage / session_id / "transcript.jsonl").read_bytes()
        # The actual Hebrew characters should appear as UTF-8 bytes, not as \uXXXX escapes.
        assert "שלום".encode("utf-8") in raw_bytes

        # Parse and confirm the string round-trips.
        line = (tmp_storage / session_id / "transcript.jsonl").read_text(encoding="utf-8").strip()
        parsed = json.loads(line)
        assert parsed["text"] == hebrew

    def test_hebrew_in_session_meta_roundtrips(self, tmp_storage: Path) -> None:
        # Test the session.json file directly via LocalStorage.
        import storage as storage_mod

        local = storage_mod.LocalStorage(str(tmp_storage))

        import asyncio

        hebrew_title = "דרקון הערפל"  # "דרקון הערפל"

        async def _run():
            req = CreateSessionRequest(title=hebrew_title)
            session_id = await local.create_session(req)
            return session_id

        session_id = asyncio.run(_run())
        meta_raw = (tmp_storage / session_id / "session.json").read_bytes()
        assert hebrew_title.encode("utf-8") in meta_raw


# ---------------------------------------------------------------------------
# Firestore fallback
# ---------------------------------------------------------------------------

class TestFirestoreFallback:
    def test_no_credentials_falls_back_to_local(
        self, tmp_storage: Path, no_firestore_env: None, caplog
    ) -> None:
        # When no Firestore env vars are set, init_storage() should return
        # LocalStorage and emit a warning rather than crashing.
        import storage as storage_mod
        try:
            importlib.reload(storage_mod)

            # Drop the logger= filter so caplog captures records even if the logger
            # name ever changes (storage.py uses "dnd.storage" explicitly).
            with caplog.at_level(logging.WARNING):
                store = storage_mod.init_storage()

            assert isinstance(store, storage_mod.LocalStorage)
            # A warning must have been logged so ops know they are not in Firestore mode.
            assert any("local" in r.message.lower() or "jsonl" in r.message.lower()
                       for r in caplog.records)
        finally:
            # Remove the reloaded module so subsequent tests get a fresh import
            # under their own environment rather than our stripped one.
            sys.modules.pop("storage", None)

    def test_bad_firestore_creds_falls_back_to_local(
        self, tmp_storage: Path, caplog, monkeypatch
    ) -> None:
        # If Firestore is "configured" but instantiation fails (bad/absent credentials
        # in CI), init_storage() must fall back to LocalStorage with a warning.
        monkeypatch.setenv("GCP_PROJECT", "nonexistent-project-for-test")
        import storage as storage_mod
        try:
            importlib.reload(storage_mod)

            with caplog.at_level(logging.WARNING):
                store = storage_mod.init_storage()

            # In CI there are no GCP credentials, so firestore.Client() raises and we
            # always land here.  Assert the specific fallback type so the test is meaningful.
            assert isinstance(store, storage_mod.LocalStorage)
        finally:
            # Remove the reloaded module so subsequent tests get a fresh import
            # under their own environment rather than this test's GCP_PROJECT env.
            sys.modules.pop("storage", None)

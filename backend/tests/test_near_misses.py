"""Tests for the near-miss data collection endpoint and LocalStorage backend.

Privacy note: near-miss tokens contain fragments of real table-audio transcript.
Collection is opt-in via ENABLE_DATA_COLLECTION=true.  These tests verify:
  1. The endpoint returns 403 when data collection is disabled (the default).
  2. Near-misses are persisted correctly when data collection is enabled.
  3. The LocalStorage backend writes near_misses.jsonl in the session directory.

See docs/DESIGN.md §Privacy for the full policy on data collection.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_session(client) -> str:
    return client.post("/api/sessions", json={}).json()["id"]


# ---------------------------------------------------------------------------
# Endpoint gating: 403 when ENABLE_DATA_COLLECTION is off
# ---------------------------------------------------------------------------

class TestNearMissGating:
    def test_returns_403_when_data_collection_disabled(self, client) -> None:
        # The `client` fixture never sets ENABLE_DATA_COLLECTION, so it defaults
        # to false and the endpoint must refuse the request.
        session_id = _post_session(client)
        resp = client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": [{"token": "firebolt", "context": "i cast firebolt", "ts": 1000}]},
        )
        assert resp.status_code == 403
        assert "disabled" in resp.json()["detail"].lower()

    def test_empty_near_misses_still_gated(self, client) -> None:
        session_id = _post_session(client)
        resp = client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": []},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Endpoint with data collection enabled
# ---------------------------------------------------------------------------

@pytest.fixture()
def data_collection_client(tmp_storage: Path, no_firestore_env: None):
    """TestClient with ENABLE_DATA_COLLECTION=true."""
    old = os.environ.get("ENABLE_DATA_COLLECTION")
    os.environ["ENABLE_DATA_COLLECTION"] = "true"
    try:
        for _mod in ("main", "storage", "stt_tokens", "config"):
            sys.modules.pop(_mod, None)
        main_mod = importlib.import_module("main")
        from fastapi.testclient import TestClient
        yield TestClient(main_mod.app)
    finally:
        sys.modules.pop("main", None)
        if old is None:
            os.environ.pop("ENABLE_DATA_COLLECTION", None)
        else:
            os.environ["ENABLE_DATA_COLLECTION"] = old


class TestNearMissEndpoint:
    def test_returns_200_with_count(self, data_collection_client) -> None:
        session_id = _post_session(data_collection_client)
        near_misses = [
            {"token": "firebolt", "context": "i cast firebolt", "ts": 1000},
            {"token": "goblet", "context": "he drank from a goblet", "ts": 2000},
        ]
        resp = data_collection_client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": near_misses},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["count"] == 2

    def test_near_misses_stored_on_disk(self, data_collection_client, tmp_storage: Path) -> None:
        session_id = _post_session(data_collection_client)
        data_collection_client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": [{"token": "firebolt", "context": "i cast firebolt", "ts": 1000}]},
        )
        nm_path = tmp_storage / session_id / "near_misses.jsonl"
        assert nm_path.exists(), "near_misses.jsonl should be created in the session directory"
        lines = nm_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        stored = json.loads(lines[0])
        assert stored["token"] == "firebolt"
        assert stored["context"] == "i cast firebolt"
        assert stored["ts"] == 1000

    def test_near_misses_accumulate_across_calls(self, data_collection_client, tmp_storage: Path) -> None:
        session_id = _post_session(data_collection_client)
        data_collection_client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": [{"token": "goblet", "context": "goblet on the table", "ts": 1}]},
        )
        data_collection_client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": [{"token": "eldrytch", "context": "eldrytch blast", "ts": 2}]},
        )
        lines = (tmp_storage / session_id / "near_misses.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 2

    def test_empty_near_misses_returns_zero_count(self, data_collection_client) -> None:
        session_id = _post_session(data_collection_client)
        resp = data_collection_client.post(
            f"/api/sessions/{session_id}/near-misses",
            json={"near_misses": []},
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 0

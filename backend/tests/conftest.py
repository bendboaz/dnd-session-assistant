"""Shared pytest fixtures for the backend test suite.

All fixtures that mutate environment variables restore them after the test so
tests remain independent regardless of execution order.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient

# Make backend/ importable when pytest is invoked from backend/ (matches CI setup).
_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


@pytest.fixture()
def tmp_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point LOCAL_STORAGE_DIR at a fresh temp directory for each test."""
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture()
def no_firestore_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure Firestore env vars are absent so init_storage() picks LocalStorage."""
    for key in ("GOOGLE_APPLICATION_CREDENTIALS", "GCP_PROJECT", "GOOGLE_CLOUD_PROJECT"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture()
def client(tmp_storage: Path, no_firestore_env: None) -> Generator[TestClient, None, None]:
    """FastAPI TestClient backed by local JSONL storage (no Firestore, no real keys).

    Auth is bypassed (DEV_AUTH_BYPASS=1) so tests that aren't exercising the auth
    gate don't need to mint/mock Firebase tokens. The auth gate itself is covered
    by test_auth.py, which builds its own client with the bypass off.
    """
    import importlib

    old_bypass = os.environ.get("DEV_AUTH_BYPASS")
    os.environ["DEV_AUTH_BYPASS"] = "1"

    # Pop main and its local dependencies from the module cache so re-import
    # re-runs init_storage() with the patched env, giving each test a fresh
    # storage instance.  Popping dependents avoids stale cached state when the
    # module graph grows.
    for _mod in ("main", "storage", "stt_tokens"):
        sys.modules.pop(_mod, None)
    main_mod = importlib.import_module("main")
    try:
        yield TestClient(main_mod.app)
    finally:
        if old_bypass is None:
            os.environ.pop("DEV_AUTH_BYPASS", None)
        else:
            os.environ["DEV_AUTH_BYPASS"] = old_bypass


@pytest.fixture()
def fake_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Enable the DEV_FAKE_TOKEN shortcut; restore afterwards."""
    monkeypatch.setenv("DEV_FAKE_TOKEN", "1")

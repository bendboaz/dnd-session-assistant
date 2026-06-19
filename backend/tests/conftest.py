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
def tmp_storage(tmp_path: Path) -> Generator[Path, None, None]:
    """Point LOCAL_STORAGE_DIR at a fresh temp directory for each test."""
    old = os.environ.get("LOCAL_STORAGE_DIR")
    os.environ["LOCAL_STORAGE_DIR"] = str(tmp_path)
    yield tmp_path
    if old is None:
        os.environ.pop("LOCAL_STORAGE_DIR", None)
    else:
        os.environ["LOCAL_STORAGE_DIR"] = old


@pytest.fixture()
def no_firestore_env() -> Generator[None, None, None]:
    """Ensure Firestore env vars are absent so init_storage() picks LocalStorage."""
    keys = ("GOOGLE_APPLICATION_CREDENTIALS", "GCP_PROJECT", "GOOGLE_CLOUD_PROJECT")
    saved = {k: os.environ.pop(k, None) for k in keys}
    yield
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v


@pytest.fixture()
def client(tmp_storage: Path, no_firestore_env: None) -> TestClient:
    """FastAPI TestClient backed by local JSONL storage (no Firestore, no real keys)."""
    # Pop main and its local dependencies from the module cache so re-import
    # re-runs init_storage() with the patched env, giving each test a fresh
    # storage instance.  Popping dependents avoids stale cached state when the
    # module graph grows.
    import importlib

    for _mod in ("main", "storage", "stt_tokens"):
        sys.modules.pop(_mod, None)
    main_mod = importlib.import_module("main")
    return TestClient(main_mod.app)


@pytest.fixture()
def fake_token_env() -> Generator[None, None, None]:
    """Enable the DEV_FAKE_TOKEN shortcut; restore afterwards."""
    old = os.environ.get("DEV_FAKE_TOKEN")
    os.environ["DEV_FAKE_TOKEN"] = "1"
    yield
    if old is None:
        os.environ.pop("DEV_FAKE_TOKEN", None)
    else:
        os.environ["DEV_FAKE_TOKEN"] = old

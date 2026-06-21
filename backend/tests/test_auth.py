"""Tests for the Firebase Auth gate (auth.py) wired into main.py.

All tests mock ``firebase_admin.auth.verify_id_token`` and
``firebase_admin.initialize_app`` so no network calls are made.  Environment
variables are patched via monkeypatch so each test starts from a clean state.
"""

from __future__ import annotations

import importlib
import sys
from unittest.mock import MagicMock, patch

import firebase_admin
import firebase_admin.auth
import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_firebase():
    """Delete all registered Firebase apps so initialize_app() can be called fresh."""
    # firebase_admin._apps is a dict mapping app name -> App instance.
    apps = list(firebase_admin._apps.keys())
    for name in apps:
        try:
            firebase_admin.delete_app(firebase_admin.get_app(name))
        except Exception:  # noqa: BLE001
            pass


def _reload_modules():
    """Reload backend modules in dependency order so env changes take effect."""
    for mod in ("config", "auth", "main"):
        if mod in sys.modules:
            importlib.reload(sys.modules[mod])


def _make_client(monkeypatch, *, allowed_emails: str = "", dev_bypass: str = "0") -> TestClient:
    """Return a fresh TestClient with the given env vars."""
    monkeypatch.setenv("ALLOWED_EMAILS", allowed_emails)
    monkeypatch.setenv("DEV_AUTH_BYPASS", dev_bypass)
    monkeypatch.setenv("DEV_FAKE_TOKEN", "1")  # avoid real STT calls
    monkeypatch.setenv("GCP_PROJECT", "test-project")

    _reload_modules()

    # Reset the auth singleton so _get_firebase_app() will call initialize_app()
    # again on the next request (inside whichever patch context is active).
    import auth as auth_mod  # noqa: PLC0415
    auth_mod._firebase_app = None

    # Also clear firebase_admin's own app registry to avoid "already exists" errors.
    _reset_firebase()

    from main import app  # noqa: PLC0415
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# /api/health — always open, no auth required
# ---------------------------------------------------------------------------

class TestHealthOpen:
    def test_health_no_auth(self, monkeypatch):
        client = _make_client(monkeypatch, dev_bypass="0", allowed_emails="")
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# DEV_AUTH_BYPASS=1 — all protected routes work with no token
# ---------------------------------------------------------------------------

class TestDevBypass:
    def test_stt_token_no_header(self, monkeypatch):
        client = _make_client(monkeypatch, dev_bypass="1")
        resp = client.get("/api/stt-token?provider=soniox")
        # With DEV_FAKE_TOKEN=1 and DEV_AUTH_BYPASS=1 this must succeed.
        assert resp.status_code == 200

    def test_create_session_no_header(self, monkeypatch):
        client = _make_client(monkeypatch, dev_bypass="1")
        resp = client.post("/api/sessions", json={"title": "Test"})
        assert resp.status_code == 200

    def test_append_transcript_no_header(self, monkeypatch):
        client = _make_client(monkeypatch, dev_bypass="1")
        s = client.post("/api/sessions", json={"title": "Test"})
        sid = s.json()["id"]
        resp = client.post(
            f"/api/sessions/{sid}/transcript",
            json={"segments": [{"text": "hello", "ts": 1000}]},
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Missing / invalid / expired token → 401
# ---------------------------------------------------------------------------

class TestTokenErrors:
    def test_missing_token_returns_401(self, monkeypatch):
        client = _make_client(monkeypatch, dev_bypass="0", allowed_emails="a@b.com")
        resp = client.get("/api/stt-token?provider=soniox")
        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, monkeypatch):
        with patch.object(
            firebase_admin.auth,
            "verify_id_token",
            side_effect=firebase_admin.auth.InvalidIdTokenError("bad token"),
        ):
            with patch.object(firebase_admin, "initialize_app", return_value=MagicMock()):
                client = _make_client(
                    monkeypatch, dev_bypass="0", allowed_emails="a@b.com"
                )
                resp = client.get(
                    "/api/stt-token?provider=soniox",
                    headers={"Authorization": "Bearer bad-token"},
                )
        assert resp.status_code == 401

    def test_expired_token_returns_401(self, monkeypatch):
        with patch.object(
            firebase_admin.auth,
            "verify_id_token",
            side_effect=firebase_admin.auth.ExpiredIdTokenError("expired", None),
        ):
            with patch.object(firebase_admin, "initialize_app", return_value=MagicMock()):
                client = _make_client(
                    monkeypatch, dev_bypass="0", allowed_emails="a@b.com"
                )
                resp = client.get(
                    "/api/stt-token?provider=soniox",
                    headers={"Authorization": "Bearer expired-token"},
                )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Valid token but email not in allowlist → 403
# ---------------------------------------------------------------------------

class TestEmailAllowlist:
    def _decoded_token(self, email: str) -> dict:
        return {"uid": "uid-123", "email": email}

    def test_email_not_in_allowlist_returns_403(self, monkeypatch):
        with patch.object(
            firebase_admin.auth,
            "verify_id_token",
            return_value=self._decoded_token("stranger@example.com"),
        ):
            with patch.object(firebase_admin, "initialize_app", return_value=MagicMock()):
                client = _make_client(
                    monkeypatch, dev_bypass="0", allowed_emails="allowed@example.com"
                )
                resp = client.get(
                    "/api/stt-token?provider=soniox",
                    headers={"Authorization": "Bearer valid-token"},
                )
        assert resp.status_code == 403

    def test_empty_allowlist_returns_403(self, monkeypatch):
        """Empty allowlist with no bypass must fail-closed."""
        with patch.object(
            firebase_admin.auth,
            "verify_id_token",
            return_value=self._decoded_token("anyone@example.com"),
        ):
            with patch.object(firebase_admin, "initialize_app", return_value=MagicMock()):
                client = _make_client(monkeypatch, dev_bypass="0", allowed_emails="")
                resp = client.get(
                    "/api/stt-token?provider=soniox",
                    headers={"Authorization": "Bearer valid-token"},
                )
        assert resp.status_code == 403

    def test_valid_token_allowed_email_returns_200(self, monkeypatch):
        with patch.object(
            firebase_admin.auth,
            "verify_id_token",
            return_value=self._decoded_token("dm@example.com"),
        ):
            with patch.object(firebase_admin, "initialize_app", return_value=MagicMock()):
                client = _make_client(
                    monkeypatch,
                    dev_bypass="0",
                    allowed_emails="dm@example.com,player@example.com",
                )
                resp = client.get(
                    "/api/stt-token?provider=soniox",
                    headers={"Authorization": "Bearer valid-token"},
                )
        assert resp.status_code == 200

    def test_email_case_insensitive(self, monkeypatch):
        """Allowlist comparison must be case-insensitive."""
        # Firebase token returns mixed-case email; allowlist is lowercase.
        with patch.object(
            firebase_admin.auth,
            "verify_id_token",
            return_value=self._decoded_token("DM@Example.COM"),
        ):
            with patch.object(firebase_admin, "initialize_app", return_value=MagicMock()):
                client = _make_client(
                    monkeypatch, dev_bypass="0", allowed_emails="dm@example.com"
                )
                resp = client.get(
                    "/api/stt-token?provider=soniox",
                    headers={"Authorization": "Bearer valid-token"},
                )
        assert resp.status_code == 200

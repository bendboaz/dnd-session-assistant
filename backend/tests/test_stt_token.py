"""Tests for /api/stt-token endpoint.

All real HTTP calls to Soniox/Deepgram are replaced with unittest.mock so no
live credentials are needed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_httpx_response(status_code: int, json_body: dict) -> MagicMock:
    """Return a mock that looks like an httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body
    return resp


def _make_async_client_ctx(response: MagicMock) -> MagicMock:
    """Wrap a mock response in an async context manager that mimics httpx.AsyncClient."""
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _make_async_client_ctx_raising(exc: Exception) -> MagicMock:
    """Wrap a transport exception in an async context manager."""
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=exc)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


# ---------------------------------------------------------------------------
# Validation / routing
# ---------------------------------------------------------------------------

class TestSttTokenValidation:
    def test_bogus_provider_returns_422(self, client) -> None:
        # FastAPI's Query pattern="^(soniox|deepgram)$" rejects unknown providers.
        resp = client.get("/api/stt-token?provider=bogus")
        assert resp.status_code == 422

    def test_missing_provider_param_returns_422(self, client) -> None:
        resp = client.get("/api/stt-token")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# DEV_FAKE_TOKEN shortcut
# ---------------------------------------------------------------------------

class TestDevFakeToken:
    def test_fake_token_set_returns_dummy(self, client, fake_token_env) -> None:
        # With DEV_FAKE_TOKEN=1 no HTTP call should be made and we get a dummy token.
        resp = client.get("/api/stt-token?provider=soniox")
        assert resp.status_code == 200
        data = resp.json()
        assert data["token"].startswith("dev-fake-")
        assert data["provider"] == "soniox"
        assert "expiresIn" in data

    def test_fake_token_deepgram(self, client, fake_token_env) -> None:
        resp = client.get("/api/stt-token?provider=deepgram")
        assert resp.status_code == 200
        assert resp.json()["provider"] == "deepgram"

    def test_no_fake_token_without_key_returns_503(self, client, monkeypatch) -> None:
        # DEV_FAKE_TOKEN not set + no real key -> 503.
        monkeypatch.delenv("SONIOX_API_KEY", raising=False)
        monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        resp = client.get("/api/stt-token?provider=soniox")
        assert resp.status_code == 503

        resp = client.get("/api/stt-token?provider=deepgram")
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------

class TestResponseShape:
    def test_exact_fields_no_extras(self, client, fake_token_env) -> None:
        # Response must be exactly {provider, token, expiresIn} — no extra fields.
        resp = client.get("/api/stt-token?provider=soniox")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"provider", "token", "expiresIn"}

    def test_api_key_never_in_response_soniox(self, client, monkeypatch) -> None:
        # Even when a real key is set, it must NOT appear in the response body.
        monkeypatch.setenv("SONIOX_API_KEY", "sk-secret-soniox-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        mock_resp = _mock_httpx_response(
            200, {"api_key": "short-lived-soniox-token", "expires_at": None}
        )
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx(mock_resp)):
            resp = client.get("/api/stt-token?provider=soniox")

        assert resp.status_code == 200
        body_text = resp.text
        assert "sk-secret-soniox-key" not in body_text

    def test_api_key_never_in_response_deepgram(self, client, monkeypatch) -> None:
        monkeypatch.setenv("DEEPGRAM_API_KEY", "sk-secret-deepgram-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        mock_resp = _mock_httpx_response(
            200, {"access_token": "short-lived-deepgram-token", "expires_in": 300}
        )
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx(mock_resp)):
            resp = client.get("/api/stt-token?provider=deepgram")

        assert resp.status_code == 200
        assert "sk-secret-deepgram-key" not in resp.text


# ---------------------------------------------------------------------------
# Provider HTTP errors
# ---------------------------------------------------------------------------

class TestProviderErrors:
    def test_soniox_503_on_missing_key(self, client, monkeypatch) -> None:
        monkeypatch.delenv("SONIOX_API_KEY", raising=False)
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)
        resp = client.get("/api/stt-token?provider=soniox")
        assert resp.status_code == 503
        # Detail should be human-readable.
        assert "SONIOX_API_KEY" in resp.json()["detail"]

    def test_deepgram_503_on_missing_key(self, client, monkeypatch) -> None:
        monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)
        resp = client.get("/api/stt-token?provider=deepgram")
        assert resp.status_code == 503
        assert "DEEPGRAM_API_KEY" in resp.json()["detail"]

    def test_deepgram_403_grant_scope_error_returns_502(self, client, monkeypatch) -> None:
        # Deepgram returns 403 when the key lacks grant scope.
        monkeypatch.setenv("DEEPGRAM_API_KEY", "valid-but-no-scope-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        mock_resp = _mock_httpx_response(403, {"error": "Forbidden"})
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx(mock_resp)):
            resp = client.get("/api/stt-token?provider=deepgram")

        assert resp.status_code == 502
        detail = resp.json()["detail"]
        # Must be a human-readable message, not a raw status code dump.
        assert isinstance(detail, str) and len(detail) > 10

    def test_soniox_upstream_error_returns_502(self, client, monkeypatch) -> None:
        monkeypatch.setenv("SONIOX_API_KEY", "real-soniox-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        mock_resp = _mock_httpx_response(500, {})
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx(mock_resp)):
            resp = client.get("/api/stt-token?provider=soniox")

        assert resp.status_code == 502

    def test_valid_soniox_response_shape(self, client, monkeypatch) -> None:
        monkeypatch.setenv("SONIOX_API_KEY", "real-soniox-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        mock_resp = _mock_httpx_response(
            200, {"api_key": "temp-soniox-123", "expires_at": "2099-01-01T00:00:00Z"}
        )
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx(mock_resp)):
            resp = client.get("/api/stt-token?provider=soniox")

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "soniox"
        assert data["token"] == "temp-soniox-123"
        assert isinstance(data["expiresIn"], int)
        assert set(data.keys()) == {"provider", "token", "expiresIn"}

    def test_valid_deepgram_response_shape(self, client, monkeypatch) -> None:
        monkeypatch.setenv("DEEPGRAM_API_KEY", "real-deepgram-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        mock_resp = _mock_httpx_response(
            200, {"access_token": "temp-deepgram-456", "expires_in": 300}
        )
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx(mock_resp)):
            resp = client.get("/api/stt-token?provider=deepgram")

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "deepgram"
        assert data["token"] == "temp-deepgram-456"
        assert data["expiresIn"] == 300
        assert set(data.keys()) == {"provider", "token", "expiresIn"}

    def test_soniox_network_error_returns_502(self, client, monkeypatch) -> None:
        # A transport-level exception (e.g. ConnectError) must yield 502, not 500.
        monkeypatch.setenv("SONIOX_API_KEY", "real-soniox-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        network_exc = httpx.ConnectError("connection refused")
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx_raising(network_exc)):
            resp = client.get("/api/stt-token?provider=soniox")

        assert resp.status_code == 502

    def test_deepgram_network_error_returns_502(self, client, monkeypatch) -> None:
        monkeypatch.setenv("DEEPGRAM_API_KEY", "real-deepgram-key")
        monkeypatch.delenv("DEV_FAKE_TOKEN", raising=False)

        network_exc = httpx.ConnectError("connection refused")
        with patch("httpx.AsyncClient", return_value=_make_async_client_ctx_raising(network_exc)):
            resp = client.get("/api/stt-token?provider=deepgram")

        assert resp.status_code == 502

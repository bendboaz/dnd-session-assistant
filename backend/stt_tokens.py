"""Mint short-lived STT tokens so the long-lived provider key never reaches the
browser.

Each provider has a different "give me a temporary credential" endpoint:

  * Soniox   -> POST https://api.soniox.com/v1/auth/temporary-api-key
               Authorization: Bearer <SONIOX_API_KEY>
               body: {"usage_type": "transcribe_websocket", "expires_in_seconds": N}
               returns: {"api_key": "...", "expires_at": "<iso8601>"}
  * Deepgram -> POST https://api.deepgram.com/v1/auth/grant
               Authorization: Token <DEEPGRAM_API_KEY>
               body: {"ttl_seconds": N}
               returns: {"access_token": "...", "expires_in": <seconds>}

In both cases we return only the short-lived credential to the client, shaped as
`SttTokenResponse { provider, token, expiresIn }`.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from config import (
    deepgram_api_key,
    dev_fake_token,
    soniox_api_key,
    token_ttl_seconds,
)
from models import SttTokenResponse

SONIOX_TEMP_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key"
DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant"

_HTTP_TIMEOUT = httpx.Timeout(10.0)


class TokenError(Exception):
    """Raised when a token cannot be minted (missing key or provider failure)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def mint_token(provider: str) -> SttTokenResponse:
    if provider not in ("soniox", "deepgram"):
        raise TokenError(400, f"Unknown provider '{provider}'. Use soniox or deepgram.")

    ttl = token_ttl_seconds()

    if dev_fake_token():
        return SttTokenResponse(
            provider=provider,  # type: ignore[arg-type]
            token=f"dev-fake-{provider}-token",
            expiresIn=ttl,
        )

    if provider == "soniox":
        return await _mint_soniox(ttl)
    return await _mint_deepgram(ttl)


async def _mint_soniox(ttl: int) -> SttTokenResponse:
    key = soniox_api_key()
    if not key:
        raise TokenError(
            503, "SONIOX_API_KEY is not configured (set it or use DEV_FAKE_TOKEN=1)."
        )

    payload = {"usage_type": "transcribe_websocket", "expires_in_seconds": ttl}
    headers = {"Authorization": f"Bearer {key}"}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(SONIOX_TEMP_KEY_URL, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise TokenError(502, f"Soniox request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise TokenError(502, f"Soniox token request failed ({resp.status_code}).")

    data = resp.json()
    token = data.get("api_key")
    if not token:
        raise TokenError(502, "Soniox response did not include an api_key.")

    expires_in = _seconds_until(data.get("expires_at")) or ttl
    return SttTokenResponse(provider="soniox", token=token, expiresIn=expires_in)


async def _mint_deepgram(ttl: int) -> SttTokenResponse:
    key = deepgram_api_key()
    if not key:
        raise TokenError(
            503, "DEEPGRAM_API_KEY is not configured (set it or use DEV_FAKE_TOKEN=1)."
        )

    payload = {"ttl_seconds": ttl}
    headers = {"Authorization": f"Token {key}"}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(DEEPGRAM_GRANT_URL, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise TokenError(502, f"Deepgram request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise TokenError(502, f"Deepgram grant request failed ({resp.status_code}).")

    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise TokenError(502, "Deepgram response did not include an access_token.")

    expires_in = int(data.get("expires_in") or ttl)
    return SttTokenResponse(provider="deepgram", token=token, expiresIn=expires_in)


def _seconds_until(iso_ts: str | None) -> int | None:
    """Best-effort conversion of an ISO-8601 expiry timestamp to seconds-from-now."""
    if not iso_ts:
        return None
    try:
        # Handle a trailing 'Z' which fromisoformat doesn't accept on older runtimes.
        normalized = iso_ts.replace("Z", "+00:00")
        expires_at = datetime.fromisoformat(normalized)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        delta = (expires_at - datetime.now(timezone.utc)).total_seconds()
        return max(0, int(delta))
    except (ValueError, TypeError):
        return None

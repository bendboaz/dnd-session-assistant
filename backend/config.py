"""Environment-backed configuration.

All secrets live in env (backend `.env` locally, GCP Secret Manager in prod) and
never reach the client. See `.env.example` for the full list.
"""

from __future__ import annotations

import os


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def allowed_origins() -> list[str]:
    return [
        o.strip()
        for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]


# --- STT provider keys (long-lived; server-side only, never returned) ---
def soniox_api_key() -> str | None:
    return os.getenv("SONIOX_API_KEY")


def deepgram_api_key() -> str | None:
    return os.getenv("DEEPGRAM_API_KEY")


# --- Token behaviour ---
def dev_fake_token() -> bool:
    """When set, /api/stt-token returns a dummy token (no real key required)."""
    return _bool("DEV_FAKE_TOKEN", default=False)


def token_ttl_seconds() -> int:
    """Requested lifetime for minted short-lived tokens."""
    try:
        return int(os.getenv("STT_TOKEN_TTL_SECONDS", "300"))
    except ValueError:
        return 300


# --- Storage ---
def gcp_project() -> str | None:
    # google-cloud-firestore also reads GOOGLE_CLOUD_PROJECT itself.
    return os.getenv("GCP_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")


def local_storage_dir() -> str:
    return os.getenv("LOCAL_STORAGE_DIR", "./data")


# --- Auth (Firebase) ---
def allowed_emails() -> list[str]:
    """Comma-separated allowlist of Google account emails permitted to sign in.

    Entries are stripped, lowercased, and empty strings dropped — same pattern as
    `allowed_origins()`.  An empty list means *nobody* is allowed (fail-closed).
    """
    return [
        e.strip().lower()
        for e in os.getenv("ALLOWED_EMAILS", "").split(",")
        if e.strip()
    ]


def dev_auth_bypass() -> bool:
    """When set, Firebase auth verification is skipped entirely (LOCAL DEV only).

    Hard-disabled on Cloud Run: the platform always sets ``K_SERVICE``, so even if
    ``DEV_AUTH_BYPASS`` leaks into a production env var it can never open the gate.
    """
    if os.getenv("K_SERVICE"):
        return False
    return _bool("DEV_AUTH_BYPASS", default=False)


# --- Cost guard ---
def max_transcript_segments() -> int:
    """Maximum number of segments accepted in a single transcript append request."""
    try:
        return int(os.getenv("MAX_TRANSCRIPT_SEGMENTS", "1000"))
    except ValueError:
        return 1000

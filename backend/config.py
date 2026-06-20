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


def data_collection_enabled() -> bool:
    """Whether to persist near-miss tokens alongside session transcripts.

    Off by default because near-miss data contains real table-audio transcript
    fragments (personal/creative content).  Set ENABLE_DATA_COLLECTION=true in
    the backend .env to opt in.  See docs/DESIGN.md §Privacy for the full policy.
    """
    return _bool("ENABLE_DATA_COLLECTION", default=False)

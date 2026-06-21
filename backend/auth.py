"""Firebase Auth gate for the D&D Session Assistant backend.

Provides a FastAPI dependency (`require_user`) that verifies a Firebase ID token
supplied as `Authorization: Bearer <token>` and checks the caller's email against
the `ALLOWED_EMAILS` allowlist.

Dev bypass
----------
Set `DEV_AUTH_BYPASS=1` (never in prod) to skip verification entirely and return a
fake dev user.  This lets local development work without a real Firebase project or a
signed-in account.

Cloud Run / production
-----------------------
The Firebase Admin SDK is initialised lazily on first use via application-default
credentials — on Cloud Run the runtime service account provides them automatically.
The GCP project is read from `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` (already set by
Cloud Run, or configurable locally via `.env`).
"""

from __future__ import annotations

import logging
import threading
from typing import Any

import firebase_admin
import firebase_admin.auth
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import allowed_emails, dev_auth_bypass, gcp_project

logger = logging.getLogger("dnd.auth")

# ---------------------------------------------------------------------------
# Firebase Admin initialisation (lazy, thread-safe, once per process)
# ---------------------------------------------------------------------------

_firebase_lock = threading.Lock()
_firebase_app: firebase_admin.App | None = None


def _get_firebase_app() -> firebase_admin.App:
    """Return the singleton Firebase Admin app, initialising it if necessary."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    with _firebase_lock:
        if _firebase_app is not None:  # double-checked locking
            return _firebase_app
        project = gcp_project()
        options = {"projectId": project} if project else {}
        logger.info("Initialising Firebase Admin (project=%s)", project or "<from ADC>")
        _firebase_app = firebase_admin.initialize_app(options=options)
    return _firebase_app


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

# HTTPBearer auto-rejects requests that don't supply an Authorization header
# when auto_error=True (the default).  We set auto_error=False so we can
# return a friendlier 401 ourselves and still support DEV_AUTH_BYPASS (which
# needs no header at all).
_bearer_scheme = HTTPBearer(auto_error=False)

# Type alias for the decoded Firebase token (a plain dict).
FirebaseUser = dict[str, Any]

_DEV_USER: FirebaseUser = {"email": "dev@local", "uid": "dev"}


async def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> FirebaseUser:
    """FastAPI dependency: authenticate + authorise the caller.

    Returns the decoded Firebase token dict (contains ``uid``, ``email``, etc.)
    on success.  Raises ``HTTPException(401)`` for missing / invalid tokens and
    ``HTTPException(403)`` for emails not on the allowlist.
    """
    # ------------------------------------------------------------------
    # 1. Dev bypass — skip all verification in local dev mode.
    # ------------------------------------------------------------------
    if dev_auth_bypass():
        logger.debug("DEV_AUTH_BYPASS active — returning fake dev user")
        return _DEV_USER

    # ------------------------------------------------------------------
    # 2. Require a Bearer token.
    # ------------------------------------------------------------------
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header (expected: Bearer <firebase-id-token>).",
        )

    token = credentials.credentials

    # ------------------------------------------------------------------
    # 3. Verify the Firebase ID token.
    # ------------------------------------------------------------------
    try:
        app = _get_firebase_app()
        decoded = firebase_admin.auth.verify_id_token(token, app=app)
    except firebase_admin.auth.InvalidIdTokenError as exc:
        logger.warning("Invalid Firebase ID token: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid or expired ID token.") from exc
    except firebase_admin.auth.ExpiredIdTokenError as exc:
        logger.warning("Expired Firebase ID token: %s", exc)
        raise HTTPException(status_code=401, detail="ID token has expired.") from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("Firebase token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Token verification failed.") from exc

    # ------------------------------------------------------------------
    # 4. Check the email allowlist.  Fail-closed: if the list is empty
    #    (and not in dev-bypass) nobody gets through.
    # ------------------------------------------------------------------
    email: str = (decoded.get("email") or "").lower()
    allowlist = allowed_emails()

    if not allowlist:
        logger.warning(
            "ALLOWED_EMAILS is empty and DEV_AUTH_BYPASS is off — denying uid=%s",
            decoded.get("uid"),
        )
        raise HTTPException(
            status_code=403,
            detail="Access denied: no email allowlist is configured.",
        )

    if email not in allowlist:
        logger.warning(
            "Email not in allowlist: %s (uid=%s)", email, decoded.get("uid")
        )
        raise HTTPException(
            status_code=403,
            detail="Access denied: your account is not on the allowlist.",
        )

    return decoded

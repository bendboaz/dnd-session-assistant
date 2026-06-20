"""Session + transcript storage.

Primary backend is Firestore (`sessions/{id}` docs + a `transcript` subcollection
of timestamped segments). When Firestore credentials are absent — the common case
for local dev — we degrade gracefully to a local JSONL store under
`LOCAL_STORAGE_DIR` so the frontend keeps working. The active backend is decided
once at startup and logged.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import gcp_project, local_storage_dir
from models import CreateSessionRequest, NearMiss, Segment

logger = logging.getLogger("dnd.storage")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    """Storage interface. Implementations: FirestoreStorage, LocalStorage."""

    backend: str = "none"

    async def create_session(self, req: CreateSessionRequest) -> str:  # pragma: no cover
        raise NotImplementedError

    async def append_segments(
        self, session_id: str, segments: list[Segment]
    ) -> int:  # pragma: no cover
        raise NotImplementedError

    async def append_near_misses(
        self, session_id: str, near_misses: list[NearMiss]
    ) -> int:  # pragma: no cover
        raise NotImplementedError


class FirestoreStorage(Storage):
    backend = "firestore"

    def __init__(self, client: Any) -> None:
        self._db = client

    async def create_session(self, req: CreateSessionRequest) -> str:
        session_id = _new_id()
        doc: dict[str, Any] = {
            "title": req.title,
            "startedAt": req.startedAt,
            "createdAt": _now_iso(),
            "segmentCount": 0,
        }
        # The Firestore client is synchronous; the calls are fast network ops and
        # the route handlers are async, so we accept the brief inline block here.
        self._db.collection("sessions").document(session_id).set(doc)
        return session_id

    async def append_segments(self, session_id: str, segments: list[Segment]) -> int:
        from google.cloud import firestore  # local import; only needed here

        session_ref = self._db.collection("sessions").document(session_id)
        transcript = session_ref.collection("transcript")
        batch = self._db.batch()
        for seg in segments:
            seg_ref = transcript.document()
            batch.set(seg_ref, seg.model_dump())
        batch.commit()
        session_ref.update({"segmentCount": firestore.Increment(len(segments))})
        return len(segments)

    async def append_near_misses(self, session_id: str, near_misses: list[NearMiss]) -> int:
        from google.cloud import firestore  # local import; only needed here

        # The Firestore client is synchronous; no await needed (same pattern as
        # append_segments / create_session above).
        session_ref = self._db.collection("sessions").document(session_id)
        near_miss_col = session_ref.collection("near_misses")
        batch = self._db.batch()
        for nm in near_misses:
            nm_ref = near_miss_col.document()
            batch.set(nm_ref, nm.model_dump())
        batch.commit()
        session_ref.update({"nearMissCount": firestore.Increment(len(near_misses))})
        return len(near_misses)


class LocalStorage(Storage):
    backend = "local-jsonl"

    def __init__(self, root: str) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _session_dir(self, session_id: str) -> Path:
        return self._root / session_id

    async def create_session(self, req: CreateSessionRequest) -> str:
        session_id = _new_id()
        sdir = self._session_dir(session_id)
        sdir.mkdir(parents=True, exist_ok=True)
        meta = {
            "id": session_id,
            "title": req.title,
            "startedAt": req.startedAt,
            "createdAt": _now_iso(),
        }
        (sdir / "session.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return session_id

    async def append_segments(self, session_id: str, segments: list[Segment]) -> int:
        sdir = self._session_dir(session_id)
        # Tolerate appends to sessions created before this process started.
        sdir.mkdir(parents=True, exist_ok=True)
        path = sdir / "transcript.jsonl"
        with path.open("a", encoding="utf-8") as fh:
            for seg in segments:
                fh.write(json.dumps(seg.model_dump(), ensure_ascii=False) + "\n")
        return len(segments)

    async def append_near_misses(self, session_id: str, near_misses: list[NearMiss]) -> int:
        sdir = self._session_dir(session_id)
        sdir.mkdir(parents=True, exist_ok=True)
        path = sdir / "near_misses.jsonl"
        with path.open("a", encoding="utf-8") as fh:
            for nm in near_misses:
                fh.write(json.dumps(nm.model_dump(), ensure_ascii=False) + "\n")
        return len(near_misses)


def init_storage() -> Storage:
    """Pick Firestore if credentials/project are available, else local JSONL.

    We treat the presence of a GCP project AND importable credentials as the
    signal for Firestore. Any failure here falls back to local storage with a
    warning rather than crashing the app.
    """
    project = gcp_project()
    has_creds = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS")) or bool(project)

    if has_creds:
        try:
            from google.cloud import firestore

            client = firestore.Client(project=project) if project else firestore.Client()
            logger.info("Storage backend: Firestore (project=%s)", project or "default")
            return FirestoreStorage(client)
        except Exception as exc:  # noqa: BLE001 - fall back on any init failure
            logger.warning(
                "Firestore unavailable (%s); falling back to local JSONL storage.", exc
            )

    root = local_storage_dir()
    logger.warning(
        "No Firestore credentials configured; using local JSONL storage at %s. "
        "Transcripts will NOT persist to the cloud.",
        root,
    )
    return LocalStorage(root)

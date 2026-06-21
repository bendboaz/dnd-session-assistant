"""D&D Session Assistant backend.

Responsibilities:
  * Mint short-lived STT tokens so the real provider API keys never reach the
    browser (see `stt_tokens.py`).
  * Ingest and store session transcripts for later summarization — Firestore when
    configured, local JSONL fallback otherwise (see `storage.py`).

See `docs/DESIGN.md` -> "Backend API contract" for the route table.
"""

from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

# Configure logging before importing modules that grab loggers.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dnd.api")

from config import allowed_origins  # noqa: E402
from models import (  # noqa: E402
    AppendTranscriptRequest,
    AppendTranscriptResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    HealthResponse,
    SttTokenResponse,
)
from auth import FirebaseUser, require_user  # noqa: E402
from storage import Storage, init_storage  # noqa: E402
from stt_tokens import TokenError, mint_token  # noqa: E402

ALLOWED_ORIGINS = allowed_origins()

app = FastAPI(title="D&D Session Assistant API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Decided once at startup; logged inside init_storage().
storage: Storage = init_storage()


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/api/stt-token", response_model=SttTokenResponse)
async def stt_token(
    provider: str = Query(..., pattern="^(soniox|deepgram)$"),
    _user: FirebaseUser = Depends(require_user),
) -> SttTokenResponse:
    try:
        return await mint_token(provider)
    except TokenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@app.post("/api/sessions", response_model=CreateSessionResponse)
async def create_session(
    req: CreateSessionRequest,
    _user: FirebaseUser = Depends(require_user),
) -> CreateSessionResponse:
    session_id = await storage.create_session(req)
    return CreateSessionResponse(id=session_id)


@app.post(
    "/api/sessions/{session_id}/transcript", response_model=AppendTranscriptResponse
)
async def append_transcript(
    session_id: str,
    req: AppendTranscriptRequest,
    _user: FirebaseUser = Depends(require_user),
) -> AppendTranscriptResponse:
    count = await storage.append_segments(session_id, req.segments)
    return AppendTranscriptResponse(ok=True, count=count)


@app.post("/api/sessions/{session_id}/summarize", status_code=501)
async def summarize(
    session_id: str,
    _user: FirebaseUser = Depends(require_user),
) -> None:
    # Stub for later Ollama / Claude summarization work.
    raise HTTPException(
        status_code=501, detail="Summarization is not implemented yet."
    )

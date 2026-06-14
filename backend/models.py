"""Pydantic request/response models for the backend API.

These mirror the contract in `docs/DESIGN.md` ("Backend API contract") and the
frontend's `src/stt/types.ts` (`SttTokenResponse`). The token response shape in
particular is load-bearing: `{ provider, token, expiresIn }`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SttProviderName = Literal["soniox", "deepgram"]


class HealthResponse(BaseModel):
    status: str = "ok"


class SttTokenResponse(BaseModel):
    """Matches `SttTokenResponse` in `src/stt/types.ts`.

    `expiresIn` is camelCase to match the frontend contract exactly.
    """

    provider: SttProviderName
    token: str
    expiresIn: int = Field(..., description="Seconds until the token expires.")


class CreateSessionRequest(BaseModel):
    title: str | None = None
    startedAt: str | None = Field(
        default=None,
        description="ISO-8601 timestamp when the session started (client-supplied).",
    )


class CreateSessionResponse(BaseModel):
    id: str


class Segment(BaseModel):
    text: str
    startTime: float | None = Field(
        default=None, description="Seconds from stream start, if available."
    )
    ts: int = Field(..., description="Epoch milliseconds when the segment was received.")


class AppendTranscriptRequest(BaseModel):
    segments: list[Segment]


class AppendTranscriptResponse(BaseModel):
    ok: bool = True
    count: int

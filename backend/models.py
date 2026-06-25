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
    # Hard cap at 1000 segments per request — protects against runaway Firestore
    # writes.  The frontend chunks backfill into ≤100-segment batches, so 1000
    # is a comfortable ceiling that never rejects legitimate traffic.  Requests
    # that exceed this limit get a 422 Unprocessable Entity automatically from
    # Pydantic before any route handler runs.
    segments: list[Segment] = Field(..., max_length=1000)


class AppendTranscriptResponse(BaseModel):
    ok: bool = True
    count: int


class NearMiss(BaseModel):
    """A Latin token that was examined by the matching engine but produced no detection.

    Near-misses indicate potentially unrecognised aliases or STT mangling that could
    be addressed by adding aliases to the compendium.  Collecting them is opt-in
    (requires ENABLE_DATA_COLLECTION=true in the backend env) because the underlying
    transcript text is real table audio and may contain personal information.
    """

    token: str = Field(..., description="Normalized Latin token that matched nothing.")
    context: str = Field(
        ...,
        description="Short surrounding transcript excerpt for human review.",
    )
    ts: int = Field(..., description="Epoch milliseconds when the segment was scanned.")


class AppendNearMissesRequest(BaseModel):
    near_misses: list[NearMiss]


class AppendNearMissesResponse(BaseModel):
    ok: bool = True
    count: int

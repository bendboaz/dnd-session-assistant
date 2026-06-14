"""D&D Session Assistant backend.

Responsibilities:
  * Mint short-lived STT tokens so the real provider API keys never reach the browser.
  * Ingest and store session transcripts (Firestore) for later summarization.

Full route implementations land in the "Build FastAPI backend" task; this is the
runnable skeleton with health check and CORS wired up.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

app = FastAPI(title="D&D Session Assistant API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

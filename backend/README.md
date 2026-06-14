# D&D Session Assistant — Backend (FastAPI)

Mints short-lived STT tokens (so provider keys never reach the browser) and stores
session transcripts. Part of WP-D; see `docs/DESIGN.md` for the full design.

## Run locally (Windows / PowerShell)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Copy env and edit as needed (DEV_FAKE_TOKEN=1 works with no real keys).
Copy-Item .env.example .env

.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Health check: <http://localhost:8000/api/health> -> `{"status":"ok"}`.

## Endpoints (`/api`)

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/api/health` | — | `{ status: "ok" }` |
| GET | `/api/stt-token` | `?provider=soniox\|deepgram` | `{ provider, token, expiresIn }` |
| POST | `/api/sessions` | `{ title?, startedAt? }` | `{ id }` |
| POST | `/api/sessions/{id}/transcript` | `{ segments: [{ text, startTime?, ts }] }` | `{ ok, count }` |
| POST | `/api/sessions/{id}/summarize` | — | `501 Not Implemented` |

## Token minting

`/api/stt-token` reads the long-lived provider key from env and exchanges it for a
short-lived credential via the provider's token API; only the short-lived token is
returned (`SttTokenResponse`).

- **Soniox** — `POST /v1/auth/temporary-api-key` (`Authorization: Bearer <key>`) →
  returns `api_key` + `expires_at`.
- **Deepgram** — `POST /v1/auth/grant` (`Authorization: Token <key>`) → returns
  `access_token` + `expires_in`.

Set `DEV_FAKE_TOKEN=1` to return a dummy token without real keys (unblocks frontend
integration). If a real key is missing and `DEV_FAKE_TOKEN` is off, the endpoint
returns `503`.

## Storage

Sessions + transcripts go to **Firestore** (`sessions/{id}` doc + `transcript`
subcollection) when a GCP project / credentials are configured. With no
credentials (typical local dev) the app logs a warning and falls back to **local
JSONL** under `LOCAL_STORAGE_DIR` (default `./data/<session-id>/transcript.jsonl`),
so the frontend keeps working. The active backend is logged once at startup.

## Docker / Cloud Run

```powershell
docker build -t dnd-backend ./backend
docker run -p 8080:8080 -e DEV_FAKE_TOKEN=1 dnd-backend
```

The container honors `$PORT` (Cloud Run sets it; defaults to 8080). Provide keys via
env / Secret Manager in production — never bake them into the image.

## Quick verification (PowerShell)

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod "http://localhost:8000/api/stt-token?provider=soniox"
$s = Invoke-RestMethod -Method Post http://localhost:8000/api/sessions `
  -ContentType application/json -Body '{"title":"Test","startedAt":"2026-06-14T18:00:00Z"}'
Invoke-RestMethod -Method Post "http://localhost:8000/api/sessions/$($s.id)/transcript" `
  -ContentType application/json `
  -Body '{"segments":[{"text":"אני מטיל fireball","ts":1718385600000}]}'
```

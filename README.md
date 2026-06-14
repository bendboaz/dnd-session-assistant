# D&D Session Assistant

A mobile-first PWA that **listens to your D&D table** (sessions in Hebrew, game terms in
English) and automatically surfaces the stat block for any spell, monster, item, or
condition the moment it's mentioned — with a manual search box for misses.

## How it works

```
Phone/laptop browser (PWA)
  mic → pluggable STT (Soniox | Deepgram) → transcript
      → local matching engine (English SRD names, fuzzy + phonetic)
      → detection feed → tap → stat block
FastAPI backend (GCP Cloud Run)
  → mints short-lived STT tokens (keys stay server-side)
  → stores session transcripts in Firestore (for later summarization)
```

- **Speech-to-text** is provider-agnostic so Soniox and Deepgram's Hebrew model can be
  A/B tested on a real clip; the winner handles code-switched English game terms best.
- **Lookups** use the SRD dataset bundled locally (offline, instant). The data layer is
  generic over a `source` field, so owned (non-SRD) books can be added later.

## Project layout

| Path | What |
|------|------|
| `src/compendium/` | SRD data loading + normalized index (extensibility seam) |
| `src/matching/`   | Transcript → entity detection (n-gram + fuzzy + phonetic) |
| `src/stt/`        | Pluggable STT providers + mic capture + reconnect |
| `src/ui/`         | Detection feed, stat-block renderer, manual search |
| `public/data/srd/`| Vendored 5e SRD JSON (`5e-bits/5e-database`, OGL), fetched at runtime |
| `backend/`        | FastAPI: token minting + transcript storage |

## Local development

```powershell
# Frontend (Vite dev server, exposed on LAN for phone testing)
npm install
npm run dev

# Backend (separate terminal)
cd backend
python -m venv .venv; .venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\.env.example .env   # fill in SONIOX_API_KEY / DEEPGRAM_API_KEY
uvicorn main:app --reload --port 8000
```

The Vite dev server proxies `/api/*` to `http://localhost:8000`.

## Secrets

Never commit real keys. Copy `.env.example` → `backend/.env` and fill it in locally;
in production the keys live in GCP Secret Manager.

## Content license

SRD content is used under the Open Gaming License / Creative Commons (per the SRD).
Non-SRD official book content is **not** included and must be supplied by the user.

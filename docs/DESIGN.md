# D&D Session Assistant — Design

## Context & goal

During D&D sessions, stopping to look up a spell, monster, item, or condition the moment it's
mentioned breaks the flow. This app **passively listens to the table** (sessions in Hebrew, game
terms spoken in English), detects when a D&D entity is named, and **automatically surfaces its stat
block** — with a manual search box as a fallback for misses.

Greenfield project at `D:\Users\Boaz\CodeProjects\dnd-session-assistant`.

## Decisions (locked in)

| Area | Decision |
|------|----------|
| Sessions | Spoken in **Hebrew**; spell/monster names dropped in as **English** ("fireball", "beholder"). Match against the **English SRD** — no Hebrew translation table. |
| STT | **Pluggable**; A/B test **Soniox** (native Hebrew↔English code-switch) vs **Deepgram Nova-3 Hebrew** (keyterm prompting). Pick after a real-clip test. |
| Devices | Android phone + laptop → **mobile-first PWA**. |
| Content | **SRD only** now; data layer generic over `source` so owned books drop in later. |
| Mode | **Auto-detection + manual search fallback** (occasional manual "search fireball" is acceptable). |
| Transcripts | **Persisted** (timestamped) for later summarization. |
| Backend | **Python / FastAPI**, deployed to **GCP Cloud Run**; transcripts in **Firestore**. |

### Why
- English game terms ⇒ match the existing English SRD names; no large hand-built Hebrew alias map.
- A Hebrew-only STT transliterates "fireball" into garbled Hebrew letters; a code-switch-capable model
  (Soniox) keeps it as English text → matches directly. The pluggable layer lets us verify empirically.
- Cloud Run gives the backend a **public HTTPS URL** reachable from the phone anywhere (no PC/tunnel),
  and co-locates transcript storage + future LLM summarization.

## Architecture

```
 Android phone / laptop browser  (PWA, mobile-first)
 ┌──────────────────────────────────────────────────────┐
 │ Mic capture (getUserMedia)                             │
 │   → STT provider (pluggable: Soniox | Deepgram) ──┐    │
 │   ← Hebrew transcript w/ English terms            │    │
 │ Matching engine (local, targets ENGLISH names):   │    │
 │   • exact name index   • Fuse.js fuzzy            │    │
 │   • double-metaphone phonetic fallback            │    │
 │   • greedy longest n-gram scan + cooldown         │    │
 │ UI: detection feed · stat-block view · search box │    │
 │ Compendium: vendored SRD JSON (fetched at load)   │    │
 └───────────────────────────────────────────────────┼───┘
              │ GET /api/stt-token        │ POST /api/sessions/{id}/transcript
              ▼                           ▼
        ┌─────────────────────────────────────────────┐
        │ FastAPI backend (Docker → GCP Cloud Run)     │
        │  • /api/stt-token  → short-lived STT token   │  keys in Secret Manager
        │  • transcript ingest + session storage       │  → Firestore
        │  • (later) /api/sessions/{id}/summarize      │  → Ollama / Claude
        └─────────────────────────────────────────────┘
```

## Tech stack

- **Frontend:** Vite + React + TypeScript + Tailwind v4 (`@tailwindcss/vite`), PWA via
  `vite-plugin-pwa`. Theme via CSS variables (see `src/index.css`).
- **Matching:** `fuse.js` (fuzzy), `double-metaphone` (phonetic).
- **Backend:** FastAPI + uvicorn, `httpx` (token minting), `google-cloud-firestore`.
- **Deploy:** Cloud Run (backend container) + Firebase Hosting / GCS (static PWA).

## Module map & contracts

The seams between work packages are explicit TypeScript contracts. **Contract files are read-only**
for feature work; changes go through this design doc + the orchestrator.

| Module | Files | Status |
|--------|-------|--------|
| Shared text utils | `src/lib/text.ts` (`normalize`, `latinTokens`, `phoneticKey`) | ✅ done |
| Compendium types | `src/compendium/types.ts` (`CompendiumEntry`, per-kind payloads) | ✅ done |
| Compendium loader | `src/compendium/loader.ts` (`loadCompendium()` → `Compendium`) | ✅ done |
| Matching contract | `src/matching/types.ts` (`Detection`, `Scanner`, `ScannerOptions`) | ✅ contract |
| STT contract | `src/stt/types.ts` (`SttProvider`, `TranscriptSegment`, `SttTokenResponse`) | ✅ contract |
| Matching engine | `src/matching/scanner.ts` | ⬜ WP-A |
| STT layer | `src/stt/*Provider.ts`, mic capture, `createProvider`, fake provider | ⬜ WP-B |
| UI | `src/App.tsx`, `src/ui/*`, app state wiring | ⬜ WP-C |
| Backend | `backend/*` | ⬜ WP-D |

> **Contract scope for the compendium loader:** the frozen contract is the **public `Compendium`
> interface signature** (`loadCompendium()` return type, `exact`/`phonetic`/`search` method
> signatures) and the `CompendiumEntry` + payload shapes in `src/compendium/types.ts`. The loader's
> **internal implementation** — alias generation, index building, normalization helpers — may evolve
> freely as long as those public types and signatures are unchanged. Adding new aliases (e.g. no-space
> variants like "firebolt" alongside "fire bolt") is an internal detail that changes neither
> `CompendiumEntry` nor the `Compendium` interface, and is therefore not a contract break. The other
> contract files (`src/lib/text.ts`, `src/compendium/types.ts`, `src/matching/types.ts`,
> `src/stt/types.ts`) remain fully read-only — any change to their exported types or signatures goes
> through the orchestrator first.

### Compendium (done — the shared data foundation)

`loadCompendium(): Promise<Compendium>` fetches the SRD JSON, normalizes it, and exposes:
- `entries: CompendiumEntry[]`, `names: string[]`, `maxAliasWords: number`
- `exact(phrase)` — normalized name/alias → entries (fast auto-detect path)
- `phonetic(phrase)` — double-metaphone key → entries (homophone fallback)
- `search(query, limit?)` — Fuse fuzzy search, best-first

`CompendiumEntry = { id, name, aliases[], kind: 'spell'|'monster'|'item'|'condition', source, data }`.
`data` is one of `SpellData | MonsterData | ItemData | ConditionData` (see `types.ts`). All SRD field
flattening (armor class, speed, challenge rating fractions, etc.) is already done in the loader.

### Detection contract (`src/matching/types.ts`)

`Scanner.scan(text, now?) → Detection[]`. `Detection = { entry, matchedText, method, confidence, ts }`.
The scanner is constructed with a `Compendium` + `ScannerOptions` (cooldown, min confidence).

### STT contract (`src/stt/types.ts`)

`SttProvider { name, start(callbacks), stop(), setKeyterms(terms), getState() }`, emitting
`TranscriptSegment { text, isFinal, startTime?, ts }`.

## Backend API contract

Base path `/api`. CORS locked to `ALLOWED_ORIGINS`.

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/api/health` | — | `{ status: "ok" }` |
| GET | `/api/stt-token` | `?provider=soniox\|deepgram` | `SttTokenResponse { provider, token, expiresIn }` |
| POST | `/api/sessions` | `{ title?, startedAt }` | `{ id }` |
| POST | `/api/sessions/{id}/transcript` | `{ segments: [{ text, startTime?, ts }] }` | `{ ok: true, count }` |
| POST | `/api/sessions/{id}/summarize` | — | `501 Not Implemented` (stub) |

- **Token minting:** real provider API key from env / Secret Manager → request a short-lived token
  from the provider's token API; never expose the long-lived key to the client.
  - Soniox: temporary API key endpoint.
  - Deepgram: scoped/temporary key via the keys grant API.
- **Storage:** Firestore `sessions/{id}` doc + `transcript` subcollection of timestamped segments.
  Locally, storage may be a no-op or file-based if Firestore creds are absent (log a warning).

## STT specifics (Hebrew + code-switching)

- Use the provider's **Hebrew** model. Soniox auto-detects mid-sentence English; Deepgram uses the
  monolingual Hebrew model (`language=he`) which **does** support keyterm prompting.
- **Keyterm prompting** boosts recognition of named terms but is **capped (~100 words / 500 tokens on
  Deepgram)** — so it is a *targeted booster* (pinned + expected entries), NOT full coverage. Full
  coverage is the local matching engine.
- The transcript will be mostly Hebrew with Latin-script English terms; matching only looks at the
  Latin runs (`latinTokens`).

## SRD data notes (already vendored)

Files in `public/data/srd/` from `5e-bits/5e-database` `src/2014/en/` (OGL-licensed):

| File | Count | Key fields |
|------|-------|-----------|
| `5e-SRD-Spells.json` | 319 | `level` (0=cantrip), `school.name`, `casting_time`, `range`, `components[]`, `material`, `duration`, `concentration`, `ritual`, `classes[].name`, `desc[]`, `higher_level[]` |
| `5e-SRD-Monsters.json` | 334 | `armor_class[]` (array! `{value, armor[].name}`), `hit_points`, `hit_dice`, `speed{}`, ability scores, `challenge_rating` (number → fraction), `xp`, `special_abilities[]`, `actions[]`, `legendary_actions[]` |
| `5e-SRD-Magic-Items.json` | 362 | `equipment_category.name`, `rarity.name`, `desc[]` |
| `5e-SRD-Equipment.json` | 237 | `equipment_category.name`, `desc?` |
| `5e-SRD-Conditions.json` | 15 | `desc[]` |

(Already normalized by the loader — agents render `CompendiumEntry.data`, not raw JSON.)

## Deploy (GCP)

- Backend: `backend/Dockerfile` → Cloud Run (public HTTPS, scales to zero); keys in Secret Manager.
- Frontend: `npm run build` → Firebase Hosting (or GCS+CDN); point at the Cloud Run URL via
  `VITE_API_BASE`.
- Phone installs the PWA ("Add to Home Screen"), reaches Cloud Run directly.
- **Note:** `gcloud` CLI is not yet installed on the dev machine; install before the deploy step.

## End-to-end verification

1. **Matching (unit):** exact ("fireball"), possessive ("tasha's hideous laughter"), mangled/homophone
   ("fire ball", "bee holder" → beholder), English-in-Hebrew ("...אז אני מטיל fireball...") resolve;
   cooldown suppresses repeats.
2. **Backend:** `/api/stt-token` returns a token; real key never in the client bundle; transcript POST
   persists.
3. **STT A/B:** run a short real Hebrew clip with English names through both providers; compare.
4. **Live (laptop):** speak names → stat blocks appear in ~1–2s; manual search resolves misses;
   transcript saved.
5. **Phone:** install PWA, ~10-min mock session → detection, reconnect resilience, mic toggle, readable
   layout, transcript saved.
6. **Extensibility:** a stub non-SRD `source` flows through index, search, and stat block unchanged.

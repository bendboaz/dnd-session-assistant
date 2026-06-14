# Parallel work packages

Read `CLAUDE.md` (working agreement) and `docs/DESIGN.md` (full design) first.

The **shared foundation is already built and typechecks clean**: scaffold (Vite + React + TS +
Tailwind v4 + PWA), the SRD data in `public/data/srd/`, `src/lib/text.ts`, `src/compendium/*`, and the
two contract files `src/matching/types.ts` + `src/stt/types.ts`. Treat all of those as **read-only**.

Four packages (A–D) can proceed **in parallel** against the contracts. Each works on its own branch /
worktree and only touches its **owned files**. Integration is a small final step (WP-C wires the real
implementations into `App.tsx`, swapping out the fakes).

### Dependency / parallelism map

```
 WP-A Matching ──┐  (independent; pure logic over Compendium)
 WP-D Backend  ──┤  (independent; defines token + transcript endpoints)
 WP-B STT ───────┤  (needs WP-D's /api/stt-token contract — mock it; ships a FakeSttProvider)
 WP-C UI ────────┘  (needs A's Detection, B's SttProvider, Compendium — uses fakes until A/B land)
```

All four can start immediately. A and D have zero cross-package deps. B and C develop against fakes.

---

## WP-A — Matching engine

**Branch:** `feat/matching`
**Owned files:** `src/matching/scanner.ts`, `src/matching/scanner.test.ts`,
`src/matching/index.ts` (re-export). May add `vitest` + `npm test` script if not present.

**Goal:** Implement the `Scanner` contract (`src/matching/types.ts`): turn finalized transcript text
into `Detection[]`, matching English SRD names inside mostly-Hebrew text.

**Implementation notes:**
- Factory `createScanner(compendium: Compendium, opts?: ScannerOptions): Scanner`.
- Use `latinTokens(text)` from `src/lib/text.ts` to get the English word run; ignore Hebrew.
- **Greedy longest n-gram first:** slide windows from `compendium.maxAliasWords` down to 1; for each
  window join with spaces and try `compendium.exact(phrase)` first (confidence ≈ 1.0, method
  `exact`). On miss, try `compendium.phonetic(phrase)` (method `phonetic`, lower confidence). As a
  last resort use `compendium.search(phrase)` and accept only if above `minConfidence` (method
  `fuzzy`). Once a window matches, advance past the consumed tokens so "fire ball" isn't also matched
  as "ball".
- **Cooldown:** keep `Map<entryId, lastTs>`; suppress an entry re-emitted within `cooldownMs`
  (default 60_000). `now` is a param for deterministic tests.
- Single-word common English words will cause false positives (e.g. "shield", "club", "light",
  "fly", "fire" are SRD names). Add a small **stop-list guard**: require single-token fuzzy/phonetic
  matches to be exact, and consider an internal denylist of ultra-common words for *auto* emission
  (still findable via manual search in WP-C). Document the chosen heuristic in code comments.

**Develop in isolation:** import the real `loadCompendium()` (it just fetches local JSON — works under
vitest with a fetch polyfill, or stub `fetch` to read the files via `node:fs`). A tiny hand-built
`Compendium` fake is fine for unit tests.

**Acceptance criteria:**
- `scan("I cast fireball")` → one `monster`/`spell` Detection for Fireball, `method: 'exact'`.
- `scan("tasha's hideous laughter")` resolves the spell (possessive handled).
- `scan("a bee holder appears")` resolves Beholder via phonetic/fuzzy.
- Hebrew with embedded English: `scan("אז אני מטיל fireball על הגובלין")` → Fireball.
- Repeats within cooldown are suppressed; after `cooldownMs` they re-emit.
- No auto-detection spam from ultra-common words (documented heuristic).
- `npm test`, `npx tsc --noEmit`, `npm run build` all pass.

---

## WP-B — STT layer (pluggable)

**Branch:** `feat/stt`
**Owned files:** `src/stt/SonioxProvider.ts`, `src/stt/DeepgramProvider.ts`,
`src/stt/FakeSttProvider.ts`, `src/stt/createProvider.ts`, `src/stt/mic.ts` (capture helper),
`src/stt/index.ts`. (Do **not** edit `src/stt/types.ts`.)

**Goal:** Implement `SttProvider` for Soniox and Deepgram (Hebrew model), plus a `FakeSttProvider`
that replays scripted segments for offline UI/dev work, and a `createProvider(name)` factory.

**Implementation notes:**
- Mic capture via `getUserMedia({ audio: true })`. Stream to the provider over WebSocket. Prefer each
  provider's official browser SDK if it cleanly supports token auth; otherwise a raw `WebSocket`.
- **Auth:** `GET ${VITE_API_BASE}/api/stt-token?provider=<name>` → `SttTokenResponse`; use the
  short-lived `token` to open the stream. Never embed a long-lived key. Refresh the token if a long
  session approaches `expiresIn`.
- **Hebrew config:** request Hebrew (`language=he` / Soniox Hebrew). Map `setKeyterms` to the
  provider's keyterm/keyword feature, truncating to the provider's cap (~100 words for Deepgram).
- Emit `TranscriptSegment` for both interim and final results (`isFinal` set correctly); WP-C/A only
  act on finals.
- **Resilience for hours-long sessions:** auto-reconnect with backoff, keepalive, and accurate
  `SttState` transitions via `onStateChange`. Handle mic permission denial → `onError` + `error`
  state.
- `FakeSttProvider`: takes a script of `{ text, delayMs, isFinal }` and emits them on a timer so the
  UI and matching can be exercised with no network/mic. Include a sample Hebrew+English script.

**Develop in isolation:** WP-D's backend may not exist yet — point `VITE_API_BASE` at a local stub or
hard-code a dev token via an env var, and gate real-provider code behind that. The `FakeSttProvider`
needs neither backend nor mic.

**Acceptance criteria:**
- `createProvider('soniox' | 'deepgram' | 'fake')` returns a working `SttProvider`.
- Fake provider drives a visible transcript with no network.
- Real providers: with a valid token, speaking into the mic produces final segments; reconnect after a
  forced WS drop; mic-denied surfaces an error state.
- `setKeyterms` respects provider caps.
- `npx tsc --noEmit` + `npm run build` pass.

---

## WP-C — UI (mobile-first)

**Branch:** `feat/ui`
**Owned files:** `src/App.tsx`, everything under `src/ui/`, and app-state wiring under `src/state/`
(create as needed). This package owns the integration seam in `App.tsx`.

**Goal:** Build the mobile-first interface and wire the pieces together.

**Components / behavior:**
- **Top bar:** session/listening status + mic toggle (start/stop STT); a prominent **manual search
  box** using `compendium.search(query)`.
- **Detection feed:** newest-first cards (name, kind badge w/ per-kind color from theme vars,
  confidence). Tap a card → open the stat block. A feed (not a screen-hijacking modal) keeps false
  positives non-disruptive. De-dupe consecutive duplicates visually.
- **Stat-block view** (`src/ui/StatBlock.tsx`): a per-kind renderer over `CompendiumEntry.data` —
  `SpellData`, `MonsterData`, `ItemData`, `ConditionData`. Make monster blocks scannable (AC/HP/speed/
  ability row/actions). Large text, scrollable, good contrast.
- **Pinning:** pin entries to a quick-access list; pinned names feed `SttProvider.setKeyterms`.
- **Loading state** while `loadCompendium()` resolves.

**Wiring:**
- On load: `loadCompendium()` → build `createScanner(compendium)` (WP-A) and `createProvider(...)`
  (WP-B). Pipe STT final segments → `scanner.scan()` → push detections to the feed → POST segments to
  `/api/sessions/{id}/transcript` (WP-D).
- Provider selectable via a dev toggle (for the Soniox-vs-Deepgram A/B). Default from
  `VITE_STT_PROVIDER`.

**Develop in isolation:** use `FakeSttProvider` (WP-B) and a trivial fake `Scanner` (return a canned
Detection) until A/B land; the contracts are stable so the swap is mechanical. The real `Compendium`
already works (local fetch).

**Acceptance criteria:**
- Loads the compendium, renders a usable mobile layout (verify in the Launch preview / responsive ~390px).
- Manual search returns and renders stat blocks for spell/monster/item/condition.
- Fed (fake) detections appear in the feed and open correct stat blocks.
- Mic toggle drives STT state; pinned items reach `setKeyterms`.
- `npx tsc --noEmit` + `npm run build` pass.

---

## WP-D — Backend (FastAPI)

**Branch:** `feat/backend`
**Owned files:** everything under `backend/` (`main.py` and new modules, `requirements.txt`,
`Dockerfile` already scaffolded). Owns the API contract in `docs/DESIGN.md` (update it if endpoints
evolve).

**Goal:** Implement the API in `docs/DESIGN.md` → "Backend API contract".

**Implementation notes:**
- `GET /api/stt-token?provider=`: read the provider key from env (`SONIOX_API_KEY` /
  `DEEPGRAM_API_KEY`), call that provider's **temporary/short-lived token** API via `httpx`, return
  `SttTokenResponse { provider, token, expiresIn }`. Never return the long-lived key. Validate the
  `provider` param.
- Sessions + transcripts → **Firestore** (`google-cloud-firestore`): `POST /api/sessions` creates
  `sessions/{id}`; `POST /api/sessions/{id}/transcript` appends timestamped segments to a
  `transcript` subcollection. If Firestore credentials are absent (local dev), degrade gracefully —
  log a warning and accept/no-op, or write to a local JSONL file — so the frontend still works.
- `POST /api/sessions/{id}/summarize`: return `501` for now (route stub for later Ollama/Claude work).
- Keep CORS locked to `ALLOWED_ORIGINS` (already wired in `main.py`).
- Provide a `backend/.env.example` (provider keys, `ALLOWED_ORIGINS`, GCP project) and a short
  `backend/README.md` for running locally.

**Develop in isolation:** fully standalone. Test endpoints with `curl`/HTTP client. Provider token
APIs need real keys — if unavailable, implement the call but allow a `DEV_FAKE_TOKEN=1` env to return a
dummy token so WP-B/C integration isn't blocked.

**Acceptance criteria:**
- `uvicorn main:app --reload` serves; `/api/health` → ok.
- `/api/stt-token?provider=soniox` and `=deepgram` return a token shape (real key, or dummy under
  `DEV_FAKE_TOKEN`); long-lived key never in the response.
- Session create + transcript append work (Firestore when configured, graceful local fallback
  otherwise).
- Dockerfile builds; container honors `$PORT` (Cloud Run).

---

## Integration & deploy (orchestrator / final session)

After A–D merge to `main`:
1. WP-C swaps fakes for real `createScanner` + `createProvider`; end-to-end run on laptop.
2. STT A/B: real Hebrew clip with English names through both providers; pick the default.
3. Generate PWA icons (`public/icon-192.png`, `public/icon-512.png`) referenced by the manifest.
4. Deploy: install `gcloud`; backend → Cloud Run (keys in Secret Manager); frontend → Firebase
   Hosting with `VITE_API_BASE` set to the Cloud Run URL.
5. Phone install + ~10-min mock-session shakedown (see `docs/DESIGN.md` verification).

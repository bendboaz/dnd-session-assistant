# Future features / backlog

Tracked work not yet implemented. Newest/most-wanted near the top.

## Requested

- **Persist pinned entries across refresh.** A page reload currently clears pins.
  Store pinned entry ids in `localStorage` and rehydrate on load in
  `src/state/useAppStore.ts` (pins also seed STT keyterms, so this improves
  detection continuity too).

## Detection quality (the STT code-switch problem)

Context: sessions are Hebrew with English game terms. Findings from live + batch A/B:
- **Soniox + context-term seeding** returns English terms in *exact* Latin during
  streaming → matches the SRD directly. **This is the chosen provider/mechanism.**
- **Deepgram** keeps Latin in *batch* but **Hebraizes in streaming even with keyterms**
  → not used.
- Without seeding, both providers Hebraize dropped-in English terms (e.g. `פיירבול`
  for "fireball"), which the Latin-only matcher can't catch.

Backlog:
- **Default keyterm seeding.** Ship a curated list (~80–100) of common spells/monsters
  seeded into Soniox `context.terms` by default (today only *pinned* names are sent),
  so passive detection works without manual pinning. Respect the ~100-term cap; pinned
  terms take priority. This is the main step to make auto-detection useful out of the box.
- **Cross-script (Hebrew→entity) matching** for the long tail beyond the keyterm cap:
  romanize/transliterate Hebrew tokens and phonetic-match against the SRD, so even
  un-seeded Hebraized terms resolve. Provider-independent, full coverage; harder because
  Hebrew script is ambiguous (no vowels, p/f, b/v) so romanization needs care.
- **Strip Soniox endpoint markers.** `enable_endpoint_detection` leaks a literal `<end>`
  token into transcript text (`src/stt/SonioxProvider.ts`); filter control markers.

## Ship / ops

- **PWA icons.** `public/icon-192.png` / `icon-512.png` are referenced by the manifest
  (`vite.config.ts`) but not generated yet.
- **GCP deploy.** Backend → Cloud Run, frontend → Firebase Hosting (see `infra/`,
  `docs/DESIGN.md`). `gcloud` CLI not yet installed.
- **Activate CI.** Push to a GitHub remote and add Actions secrets (`ANTHROPIC_API_KEY`,
  `GCP_SA_KEY`); workflows already exist in `.github/workflows/`.
- **Phone mic over HTTPS.** `getUserMedia` only works on localhost or HTTPS, so live mic
  on a phone over LAN needs TLS (handled once deployed).

## Sessions, transcripts & sharing

- **Transcript browsing.** View the full running transcript of a session in-app
  (beyond the current latest-line status), with scrollback.
- **Session management.** A session should be a first-class thing that spans more than a
  single mic toggle:
  - Explicit **start/end session** (persisting across pauses, reconnects, mic on/off).
  - **Browse previous sessions** and read their stored transcripts.
  - **Shared sessions:** multiple devices view the same live entry/detection feed, while
    only **one** device captures audio (one recorder, many viewers).

## Logging & data collection

- **Debug mode:** verbose logging of the whole pipeline — raw STT segments (interim +
  final), the keyterms actually sent to the provider, and matcher inputs/outputs
  (candidate windows, chosen detection, method, confidence, and *misses*). Toggle via
  an env/flag; off in production.
- **Production data collection:** persist transcripts + detections **and near-misses**
  (Latin tokens that looked like entity mentions but matched nothing — e.g. `firebolt`)
  so the extraction/matching can be analyzed and improved later. Store alongside session
  transcripts (Firestore / local JSONL). Note privacy: this is real table-audio content.

## Summarization (already stubbed)

- `POST /api/sessions/{id}/summarize` returns 501. Wire it to Ollama (local) or the
  Claude API to summarize stored session transcripts.

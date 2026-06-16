# Regression checklist — symptoms seen, tests to add

Bugs/symptoms hit during the first build session. Each should get an automated test so
we don't reintroduce it. Grouped by layer; `✅` = already has a regression test, `⬜` = to add.

## Matching engine (`src/matching`, `src/compendium`)

- ✅ **Run-together multi-word names.** STT emits `firebolt` / `magicmissile` (no space)
  for "Fire Bolt" / "Magic Missile". Must resolve to the multi-word SRD entry. (Fixed via
  no-space alias in `loader.makeAliases`; add a test asserting `scan("firebolt")` →
  Fire Bolt and `scan("magicmissile")` → Magic Missile.)
- ✅ **Split single-word names.** Spoken "fire ball" → Fireball, "bee holder" → (a
  multi-word entry) via phonetic concatenation. Assert these resolve.
- ✅ **Possessive prefix.** "tasha's hideous laughter" → Hideous Laughter.
- ✅ **English term embedded in Hebrew.** `scan("אז אני מטיל fireball על הgoblin")` →
  Fireball + Goblin (Hebrew ignored, Latin tokens matched).
- ✅ **Hebrew-script terms are NOT matched.** `scan("מטיל פיירבול")` → no detection
  (documents the current limitation until cross-script matching lands).
- ✅ **Phonetic typo tolerance.** Deepgram-style misspellings ("magic missael",
  "magic missal") → Magic Missile.
- ✅ **Single common-word stop-list.** Bare "shield"/"fire"/"light"/"fly" do NOT
  auto-emit, but ARE still findable via `compendium.search`.
- ✅ **Cooldown.** Repeated mentions within the window are suppressed; re-emit after.
- ✅ **Greedy longest-match.** "fire ball" matched as Fireball is not also emitted as
  "ball"; consumed tokens are skipped.
- ✅ **Non-SRD names absent.** Beholder / Mind Flayer / Hex / Vampire are not in the SRD
  data — assert `compendium.exact` returns empty (so seed-list validation drops them).

## STT providers (`src/stt`)

- ⬜ **Deepgram WS auth subprotocol.** Must be `['bearer', token]` (grant JWT), NOT
  `['token', token]` (that's for raw API keys) — the latter caused the
  connect→reconnect→error loop. Unit-test the `socketProtocols` builder.
- ⬜ **Keyterm cap + dedup.** `clampKeyterms` caps to ~100 and de-dupes case-insensitively.
- ✅ **Default keyterm seeding.** Candidates validated against the compendium (non-SRD
  dropped); pinned names take priority and the merged list respects the cap.
- ⬜ **Soniox `<end>` marker leak.** `enable_endpoint_detection` leaks a literal `<end>`
  token into transcript text — strip control markers (then assert they're absent).
- ⬜ **Fake provider** drives interim→final segments and full state transitions with no
  network/mic.
- ⬜ **Reconnect/backoff + token refresh** state-machine transitions (idle→connecting→
  listening→reconnecting→…); harder, but at least cover the happy path + one drop.

## Config / networking

- ⬜ **`localhost` vs `127.0.0.1`.** Vite dev proxy must target `127.0.0.1` (uvicorn binds
  IPv4; `localhost` can resolve to IPv6 `::1` and fail). Guard in a config test/lint.
- ⬜ **`DEV_FAKE_TOKEN`.** When set/truthy → dummy token; unset → real provider call.
  (Leftover `=1` once silently returned a dummy token.)

## Backend (`backend`)

- ⬜ **`/api/stt-token` provider validation.** `?provider=bogus` → 422; valid providers →
  token shape `{provider, token, expiresIn}`; missing key → 503; long-lived key NEVER in
  the response.
- ⬜ **Deepgram grant scope.** A Default-scoped key 403s on `/v1/auth/grant`; needs Member.
  (Can't unit-test the live API, but document + assert error mapping → 502 with detail.)
- ⬜ **Transcript storage.** Session create + segment append; Hebrew stored as UTF-8
  (`ensure_ascii=False`); graceful local-JSONL fallback when Firestore unconfigured.

## Build / tooling (mostly process, not unit tests)

- Note: `npm create vite@latest` v9 scaffolded a vanilla (non-React) template — verify the
  toolchain after scaffolding.
- Note: PWA icons `public/icon-192.png` / `icon-512.png` referenced by the manifest but
  missing — add them (and a build check would catch dangling manifest refs).
- Note: dev server wedged repeatedly on Windows under tooling — prefer a real terminal.

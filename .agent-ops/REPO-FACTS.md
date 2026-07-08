# REPO-FACTS — bendboaz/dnd-session-assistant

Repo-specific facts the agent-ops playbooks defer to (see kit's OPERATIONS.md §7 template). Keep this
current when repo requirements change; this is the D&D-specific companion to the kit's generic playbooks.

## Repository & branch protection

- **Repo:** `bendboaz/dnd-session-assistant` — public. `main` branch protection: PR + 1 approval
  (no self-approve), required checks must pass, dismiss-stale, `enforce_admins=false` (admin human
  can merge; the App physically cannot).

## Required CI checks

From `.github/workflows/ci.yml`:
- **`frontend`**: `npm ci` → `npx tsc --noEmit` → `npm run build` → `npm test`
- **`backend`**: `pip install -r requirements.txt pytest` → `pytest` (cwd: `backend/`)

A PR is mergeable only when both pass. The `agent-tools` / `agent-tools-ps` jobs run but are **not**
required checks.

## Local verification (a builder must pass before opening a PR)

```powershell
npx tsc --noEmit
npm run build
npm test
```

For backend changes, from `backend/`: `pip install -r requirements.txt pytest; pytest`

## Conventions (enforced by review)

- **Tailwind v4 theme CSS variables** (`var(--color-...)` from `src/index.css`) — never hard-coded hex.
- **No `any` to silence TypeScript** — strict mode is on; avoid `any`.
- **Relative imports within `src/`**. SRD data is fetched at runtime from `public/data/srd/`, not imported.
- **Mobile-first** — large tap targets, readable at arm's length on a phone.

See the repo `CLAUDE.md` Conventions section and `docs/DESIGN.md`.

## Contract files (API seams — changeable, but call it out)

These are no longer frozen. Agents may change them, but any change to an exported type/signature
is an **API change**: call it out explicitly in the PR description, update every dependent in the
same PR, and keep `.agent-ops/REPO-FACTS.md` and `docs/DESIGN.md` consistent with the change.

- `src/lib/text.ts`
- `src/compendium/types.ts`
- `src/matching/types.ts`
- `src/stt/types.ts`

### Partial seam

**`src/compendium/loader.ts`** — only the **public `Compendium` interface signature**
(`loadCompendium()` return type; `exact`/`phonetic`/`search` signatures) and `CompendiumEntry` +
payload shapes are the API seam (same call-out rule applies to changes there). The loader's internal
implementation (alias generation, index building, normalization helpers) may evolve freely with no
callout needed.

### Carve-out

Test files (`*.test.ts` and test-only helpers) are not seam-restricted and may be added or edited
freely.

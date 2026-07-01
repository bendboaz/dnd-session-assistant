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

## Contract files (frozen — escalate before touching)

### Fully frozen (no edits to exported types/signatures)

- `src/lib/text.ts`
- `src/compendium/types.ts`
- `src/matching/types.ts`
- `src/stt/types.ts`

### Partially frozen

**`src/compendium/loader.ts`** — only the **public `Compendium` interface signature**
(`loadCompendium()` return type; `exact`/`phonetic`/`search` signatures) and `CompendiumEntry` +
payload shapes are frozen. The loader's internal implementation (alias generation, index building,
normalization helpers) may evolve freely.

### Carve-out

Test files (`*.test.ts` and test-only helpers) are **not** contract-frozen and may be added or edited
freely by any work package.

Any change to a frozen type/signature goes through `docs/DESIGN.md` + the human first — escalate.

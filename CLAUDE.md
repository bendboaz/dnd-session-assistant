# CLAUDE.md — D&D Session Assistant

A mobile-first PWA that listens to a D&D table (Hebrew speech, English game terms), auto-detects
spells/monsters/items/conditions, and shows their stat blocks. See **`docs/DESIGN.md`** for the full
design and **`docs/TASKS.md`** for the parallel work breakdown.

## Platform (Windows)

This machine runs **Windows 10**. Use the **PowerShell tool** for shell commands (not Bash, unless
running a `.sh`). Key equivalents: `Get-ChildItem` not `ls`/`find`; `Select-String` not `grep`;
`Get-Content` not `cat`; `Select-Object -First N` not `head`; `New-Item -ItemType Directory -Force`
not `mkdir -p`. No `&&` chaining — use `;` or `if ($?) { ... }`. No `2>/dev/null` — use `2>$null`.
Use Windows paths (`D:\Users\Boaz\CodeProjects\...`), never POSIX (`/mnt/d/...`).

## Working agreement for parallel sessions

This repo is built by **multiple sessions in parallel**, one per work package (WP-A … WP-D in
`docs/TASKS.md`). To avoid collisions:

1. **Claim exactly one work package.** Work only inside that package's **owned files** (listed in the
   task brief). Do not edit another package's files.
2. **Contract files are READ-ONLY.** These define the seams between packages:
   `src/lib/text.ts`, `src/compendium/types.ts`, `src/compendium/loader.ts`,
   `src/matching/types.ts`, `src/stt/types.ts`. If a contract needs to change, stop and raise it with
   the orchestrator / update `docs/DESIGN.md` first — don't fork it in a feature branch.
3. **Work on your assigned git branch / worktree** (see the task brief). Don't commit to `main`.
4. **Develop against contracts, not other packages.** If you need another package that isn't built
   yet, use a local fake/stub that satisfies its contract (e.g. a `FakeSttProvider`, a fake `Scanner`).
5. **Before declaring done:** `npx tsc --noEmit` and `npm run build` must pass, plus your package's
   tests. Don't introduce `any` to silence the compiler.

## Conventions

- **TypeScript:** strict mode is on (see `tsconfig.json`). Prefer explicit types at module
  boundaries. Avoid `any`.
- **React:** function components + hooks. Keep components small; colocate component-local state.
- **Styling:** Tailwind v4 utility classes; use the theme CSS variables from `src/index.css`
  (`var(--color-...)`), don't hard-code hex. Mobile-first; large tap targets and readable text for
  use at arm's length on a phone at the table.
- **Imports:** relative within `src/`. SRD data is fetched at runtime from `public/data/srd/`, not
  imported.
- **Comments:** explain *why*, not *what*; match the density of the surrounding foundation files.

## Commands

```powershell
npm run dev      # Vite dev server (exposed on LAN for phone testing; proxies /api → :8000)
npm run build    # tsc + vite build (+ PWA service worker)
npx tsc --noEmit # typecheck only
npm test         # vitest (test runner; WP-A sets it up if not yet present)
```

Backend (in `backend/`): create a venv, `pip install -r requirements.txt`,
`uvicorn main:app --reload --port 8000`.

## Secrets — hard rules

- **Never read or write real `.env` files or any keys/certs.** A global hook blocks this.
- Use the **`.env.example`** pattern. Provider API keys (`SONIOX_API_KEY`, `DEEPGRAM_API_KEY`) live
  **server-side only** (backend `.env` locally; GCP Secret Manager in prod) and must never reach the
  client bundle. The browser only ever holds short-lived tokens from `/api/stt-token`.

## Autonomy

- Free to do: read files, search, run read-only git/docker/pip-info commands, typecheck/build/test.
- Confirm first: `git commit`/`git push` (propose the message), `pip install`/`npm install` (new
  deps), `docker compose up/down`, any deletion. (Within an approved task, the listed installs are
  pre-authorized.)

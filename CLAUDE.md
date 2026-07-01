# CLAUDE.md — D&D Session Assistant

A mobile-first PWA that listens to a D&D table (Hebrew speech, English game terms), auto-detects
spells/monsters/items/conditions, and shows their stat blocks. See **`docs/DESIGN.md`** for the full
design. The actionable backlog lives in **GitHub Issues**.

## Role identification — read this first

Before taking any action, determine which role this session is playing. The repo runs three
autonomous loops plus an interactive orchestrator; each has a different scope and restrictions.

| Signal | Role | First thing to read |
|---|---|---|
| `$env:AGENT_LOOP -eq '1'`, invoked by `run-dispatch.ps1` | **Dispatcher agent** | Agent-ops plugin: dispatch skill → `playbooks/DISPATCH.md`; repo facts → `.agent-ops/REPO-FACTS.md` |
| `$env:AGENT_LOOP -eq '1'`, invoked by `run-babysit.ps1` | **Babysitter agent** | Agent-ops plugin: babysit skill → `playbooks/BABYSIT.md`; repo facts → `.agent-ops/REPO-FACTS.md` |
| `$env:AGENT_LOOP -eq '1'`, invoked by `run-triage.ps1` | **Triage agent** | Agent-ops plugin: triage skill → `playbooks/TRIAGE.md`; repo facts → `.agent-ops/REPO-FACTS.md` |
| Interactive session, task brief says "orchestrator" or "healthcheck" | **Orchestrator** | Agent-ops plugin: `playbooks/ORCHESTRATOR.md`; repo facts → `.agent-ops/REPO-FACTS.md` |
| None of the above | **Ad-hoc interactive** | This file only |

**If your role isn't clear from the task brief or environment, ask before doing anything.** An
unspecified interactive session is not automatically the orchestrator. Do not touch
`.agent-ops/**` or `.github/workflows/**` unless you are confirmed as the orchestrator or the
human has explicitly directed the edit in this session.

## Platform (Windows)

This machine runs **Windows 10**. Use the **PowerShell tool** for shell commands (not Bash, unless
running a `.sh`). Key equivalents: `Get-ChildItem` not `ls`/`find`; `Select-String` not `grep`;
`Get-Content` not `cat`; `Select-Object -First N` not `head`; `New-Item -ItemType Directory -Force`
not `mkdir -p`. No `&&` chaining — use `;` or `if ($?) { ... }`. No `2>/dev/null` — use `2>$null`.
Use Windows paths (`D:\Users\Boaz\CodeProjects\...`), never POSIX (`/mnt/d/...`).

## Working agreement for parallel sessions

This repo can be built by **multiple agents/sessions in parallel**, one per work package / task.
To avoid collisions:

1. **Claim exactly one work package.** Work only inside that package's **owned files** (listed in the
   task brief). Do not edit another package's files.
2. **Contract files are READ-ONLY.** These define the seams between packages — keep them frozen:
   `src/lib/text.ts`, `src/compendium/types.ts`, `src/matching/types.ts`, `src/stt/types.ts`.
   For `src/compendium/loader.ts` specifically: the frozen contract is the **public `Compendium`
   interface signature** (`loadCompendium()` return type, `exact`/`phonetic`/`search` method
   signatures) and the `CompendiumEntry` + payload shapes in `types.ts`. The loader's **internal
   implementation** — alias generation, index building, normalization helpers — may evolve freely as
   long as those public types and signatures are unchanged. Changes to the public interface or to any
   of the other contract files above must go through the orchestrator / `docs/DESIGN.md` first —
   don't fork them in a feature branch.

   **Carve-out — test files are NOT contract-frozen.** The contract covers only the listed source
   files above plus the public `Compendium` interface signature. New test files (`*.test.ts`) and
   other test-only helpers may be added under any directory — including `src/compendium/`,
   `src/matching/`, `src/stt/`, or a shared `src/test/` — without going through the orchestrator.
   Test files are owned by whichever work package writes them and may be edited freely.
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
npm test         # vitest (test runner)
```

Backend (in `backend/`): create a venv, `pip install -r requirements.txt`,
`uvicorn main:app --reload --port 8000`.

## Secrets — hard rules

- **Never read or write real `.env` files or any keys/certs.** A global hook blocks this.
- Use the **`.env.example`** pattern. Provider API keys (`SONIOX_API_KEY`, `DEEPGRAM_API_KEY`) live
  **server-side only** (backend `.env` locally; GCP Secret Manager in prod) and must never reach the
  client bundle. The browser only ever holds short-lived tokens from `/api/stt-token`.

## PR comment authorship

All automated comments post from the same GitHub account as the human, so every agent **must**
prefix its PR comments with a role header so the AI review (and human readers) can tell them apart:

| Role | Header prefix |
|---|---|
| Reviewing agent (CI AI review) | `🔎 **[Reviewing Agent]**` |
| Implementing agent (Claude subagent posting via `gh`) | `🛠️ **[Implementing Agent]**` |
| Human | no header required (an unprefixed comment is assumed to be human); optional `👤 **[Human]**` |

**Rules for dispatched agents:**

- Every PR comment posted programmatically (e.g. via `gh pr comment`) **must** start with the
  agent's role header on the first line, followed by a blank line, then the body.
- The AI review script reads these headers to distinguish reviewer remarks, implementer replies,
  and human feedback. It will not re-raise a point if the thread shows an `[Implementing Agent]`
  or `[Human]` reply that addresses it.

## Autonomy

- Free to do: read files, search, run read-only git/docker/pip-info commands, typecheck/build/test.
- Confirm first: `git commit`/`git push` (propose the message), `pip install`/`npm install` (new
  deps), `docker compose up/down`, any deletion. (Within an approved task, the listed installs are
  pre-authorized.)
- **PR reviewer:** always assign the repo owner as reviewer when opening a PR. Resolve the owner
  with `gh repo view --json owner --jq .owner.login` and pass it as `--reviewer <owner>` to
  `gh pr create`. Do not open a PR without assigning this reviewer.

## Agent-ops plugin

The autonomous loops run via the `agent-ops` plugin from `agent-autonomy-kit`. Per-repo config
lives in `.agent-ops/`:

- `.agent-ops/config.json` — committed identity, labels, verify commands
- `.agent-ops/config.local.json` — **gitignored** machine paths (`worktreeBase`, `venvScripts`)
- `.agent-ops/REPO-FACTS.md` — contract files, required checks, conventions
- `.agent-ops/REVIEW-CHECKLIST.md` — D&D-specific AI-review checklist

See `docs/ONBOARDING.md` in `agent-autonomy-kit` for the full setup guide. Loop procedures
are the plugin's generic playbooks; repo-specific facts the playbooks defer to are in
`.agent-ops/REPO-FACTS.md`.

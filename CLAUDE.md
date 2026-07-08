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

## Development phase & working agreement

The greenfield parallel build (work packages, contract-frozen seams, one agent per package) is
**complete** — the app is built and deployed (GCP, auto-deploy on push to `main`). The repo is now
in **feature-addition and maintenance** mode:

1. **Work is issue-driven.** The backlog lives in GitHub Issues. The autonomous loops
   (dispatch/babysit/triage, via the `agent-ops` plugin — see below) work `ready`-labeled issues on
   `claude/agent/issue-N` branches. Interactive sessions take one issue/change per branch, named
   `claude/<type>/<short-slug>`, and go through a PR — never commit to `main`.
2. **The old contract files are now API seams, not frozen.** `src/lib/text.ts`,
   `src/compendium/types.ts`, `src/matching/types.ts`, `src/stt/types.ts`, and the public
   `Compendium` interface (`loadCompendium()` return type; `exact`/`phonetic`/`search` signatures)
   may change — but treat any change to them as an **API change**: call it out explicitly in the
   PR description, update all dependents in the same PR, and keep `.agent-ops/REPO-FACTS.md` and
   `docs/DESIGN.md` consistent with the change. Test files were never frozen and still aren't.
3. **Parallel work still isolates in worktrees** (`git worktree add <path> -b <branch> origin/main`;
   worktree base dir comes from `.agent-ops/config.local.json`). One session per worktree; frontend
   worktrees need their own `npm install`.
4. **Before declaring done:** `npx tsc --noEmit`, `npm run build`, and `npm test` must pass.
   Don't introduce `any` to silence the compiler.

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

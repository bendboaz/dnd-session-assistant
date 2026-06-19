# Agent Operations — shared contract

This is the **single source of truth** for how autonomous agents operate on this repo. The three
procedures — [`DISPATCH.md`](DISPATCH.md) (issues → PRs), [`BABYSIT.md`](BABYSIT.md) (keep PRs green),
[`TRIAGE.md`](TRIAGE.md) (groom the backlog) — all depend on the rules below. **Treat this file as
frozen**: a procedure may not redefine identity, labels, branch naming, comment headers, or escalation
on its own. Changes go through this file first.

Goal: agents continuously turn `ready` issues into PRs, keep those PRs green, and propose backlog
grooming — while **the human stays the only one who applies `ready` and the only one who merges**.

---

## 1. Identity & token

Agents act under a **non-admin GitHub App** (`dnd-agent`), never as the human. Because the App is not
an admin and `main` is branch-protected, **the App physically cannot merge** — that is the core
guarantee, enforced by GitHub, not by agent good behavior.

- **App ID:** `4070567`  **Installation ID:** `140736715`
- **Private key:** a `.pem` kept **OUTSIDE the repo** at the path in `GH_APP_PRIVATE_KEY_PATH`. Never
  read, print, log, or commit it. (A global hook blocks reading it; keep it that way.)
- **Minter:** [`agent_token.py`](agent_token.py) reads `GH_APP_ID` / `GH_APP_INSTALLATION_ID` /
  `GH_APP_PRIVATE_KEY_PATH` and prints a short-lived `ghs_` installation token. Deps:
  `infra/agent-ops/requirements.txt` (`pyjwt[crypto]` + `requests`; also present in the backend venv).

### Getting `GH_TOKEN`
- **Local (PowerShell):**
  ```powershell
  $env:GH_APP_ID = "4070567"
  $env:GH_APP_INSTALLATION_ID = "140736715"
  $env:GH_APP_PRIVATE_KEY_PATH = "<path to the .pem, outside the repo>"
  $env:GH_TOKEN = (python infra/agent-ops/agent_token.py)   # gh + git now act as the App
  & "C:\Program Files\GitHub CLI\gh.exe" auth status         # verify: shows the App, not the human
  ```
- **CI (GitHub Actions):** do **not** ship the key. Use
  [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) with the App
  ID + private key stored as repo secrets, and pass its output token as `GH_TOKEN`.

### KEY-ENV CONSTRAINT (read this)
An agent acts as the App **only if `GH_APP_PRIVATE_KEY_PATH` is in its own environment.** The
orchestrator session does not hold the key. Therefore every loop here runs as **either**:
- **(local)** a Claude session the user launches with the key env set — the env propagates to spawned
  subagent builders; **or**
- **(cloud)** a routine with the key as a secret (CI uses `create-github-app-token`) — **deferred for
  now; see §6** (cloud routines bill as API usage).

The token is short-lived (~10 min). Long operations should re-mint rather than cache.

---

## 2. Label taxonomy & ownership

The labels already exist in the repo. **Ownership = who is allowed to set/clear each.** Respect this
strictly — it is the primary mechanism that keeps the three loops from fighting over shared state.

| Label | Meaning | **Who sets / clears** |
|---|---|---|
| `ready` | Human has blessed this issue for autonomous work | **Human only.** Triage may *propose* candidates; it never applies this. |
| `priority: high` / `medium` / `low` | Dispatch ordering | **Human** (typically acting on a triage proposal). |
| `blocked` | Has an unmet dependency; not dispatchable | **Human.** |
| `in-progress` | A dispatcher run has claimed it and is building | **Dispatcher only.** Set on claim, clear when the PR opens (or on abort). No other loop touches it. |
| `needs-attention` | A loop hit something it won't auto-handle; human action required | **Any loop**, on escalation. Cleared by the human. |

- **"in-review" is not a label** — it is *inferred* from an open PR that links the issue
  (`Closes #N`). Do not invent a label for it.
- An issue is **dispatchable** iff: `ready` AND not `blocked` AND not `in-progress` AND has no open
  linked PR.

---

## 3. Coordination protocol (race avoidance)

Three loops touch the same issues, labels, and PR branches. The rules that keep them from colliding:

1. **Branch naming:** one branch per issue, **`claude/agent/issue-N`**. The `claude/` prefix matches
   the desktop default (one namespace for all Claude branches); the `agent/` segment marks *autonomous*
   work, so the babysitter can safely scope to `claude/agent/issue-*` and never disturb a branch from
   an interactive `claude/...` session.
2. **Single-writer labels:** only the **dispatcher** writes `in-progress`; only the **human** writes
   `ready` / `priority:*` / `blocked`. Triage and babysitter never write these.
3. **Lane separation:**
   - **Dispatcher** acts on **issues** (claims them) and opens PRs. Never modifies an existing PR's code.
   - **Babysitter** acts on **PRs only** (`claude/agent/issue-*`). Never edits issues or their labels
     (except adding `needs-attention` on escalation, per §5).
   - **Triage** only **proposes** — it writes nothing but its own report issue (§ TRIAGE.md). Never
     applies labels, never opens code PRs.
4. **Concurrency gate:** the dispatcher caps the number of open `claude/agent/issue-*` PRs
   (default **3**). It will not claim a new issue past the cap. This bounds both cost and collisions.
5. **Claim before work:** the dispatcher sets `in-progress` *before* creating the branch, and only
   claims issues that are dispatchable (§2). This is the lock; honor it.
6. **The playbook is orchestrator-only.** `infra/agent-ops/**` (these procedures, the minter,
   `cleanup.ps1`, the wrappers, `ORCHESTRATOR.md`) may be edited **only by the orchestrator** (the
   human's interactive session) — never by a dispatched loop or its builder subagents. Enforcement: the
   wrappers export `AGENT_LOOP=1`, and the deny-hook blocks Edit/Write under `infra/agent-ops/**` when
   that is set. **If a `ready` issue's fix would change the playbook, ESCALATE it** (§5) — do not let the
   loop rewrite its own rules. (This prevents the loop's edits from colliding with orchestration edits.)

---

## 4. PR comment authorship (role headers)

All automated comments post from the **same GitHub account/App**, so every programmatic comment **must**
begin with a role header on its first line (then a blank line, then the body). This is how the
conversation-aware AI review (`.github/scripts/ai_review.py`) and human readers tell voices apart and
avoid re-raising resolved points.

| Role | Header (first line) |
|---|---|
| Reviewing agent (CI AI review) | `🔎 **[Reviewing Agent]**` |
| Implementing agent (dispatcher / babysitter posting via `gh`) | `🛠️ **[Implementing Agent]**` |
| Human | no header required (unprefixed = human); optional `👤 **[Human]**` |

Dispatcher and babysitter post as `🛠️ [Implementing Agent]`. The AI review will not re-raise a point
that an `[Implementing Agent]` or `[Human]` reply has already addressed.

---

## 5. Escalation & notification policy

Default to **autonomy within bounds; escalate at the boundary.** "Escalate" means: add
`needs-attention`, post a `🛠️ [Implementing Agent]` comment stating exactly what is blocked and why,
and send a `PushNotification` with a one-line summary + link. Then **stop** on that item and move on.

Escalate (don't guess) when:
- The issue/PR is ambiguous, under-specified, or needs a product decision.
- A change touches a **contract file** (see §7 — *Contract files (frozen)* — for the exact definition).
- Verification fails in a way that needs real logic (not a mechanical fix).
- A rebase has non-trivial conflicts.
- A per-run safety cap is hit (e.g. babysitter commit-cap).

Proceed without notifying for routine success (opened a PR, pushed a mechanical fix, refreshed a report).
**Never** merge, never approve, never force-past a failing required check, never disable branch
protection, never edit `.github/workflows/*` or secrets to work around a failure.

---

## 6. Run model (local for now)

All loops currently run **locally on this machine via the Claude Code app**, so they bill as Claude
Code (subscription) usage — not API usage.

- **On-demand local burst:** the user launches a key-env'd local session (see §1); the dispatcher can
  run N issues in parallel (subagent builders in git worktrees). Good for clearing a groomed queue fast.
- **Recurring locally:** for periodic dispatch/triage, use a local scheduled run that opens a Claude
  Code session on this machine (e.g. the `schedule` skill / a Windows scheduled task) — **not** a
  cloud routine.

**Cloud routines are deferred.** A scheduled *cloud* routine is billed as **API usage**, not
chat/subscription usage, so we are not using one for now. (CI workflows like `ai-review` still run in
the cloud on the API key — that is separate and unaffected.) If we revisit cloud later, cloud runs
would mint the token via `actions/create-github-app-token` and follow these same procedures unchanged.

---

## 7. Repo facts the procedures rely on

- **Repo:** `bendboaz/dnd-session-assistant` (public). `main` branch protection: PR + 1 approval
  (no self-approve), required checks **`frontend`** + **`backend`** (strict/up-to-date), dismiss-stale,
  `enforce_admins=false` (admin human can merge; the App cannot).
- **Required checks** come from `.github/workflows/ci.yml`: `frontend` (`npm ci` → `npx tsc --noEmit`
  → `npm run build` → `npm test`) and `backend` (`pip install -r requirements.txt pytest` → `pytest`
  if tests present). A PR is mergeable only when both pass. A third job `agent-tools` runs
  `pytest` over `infra/agent-ops/` (covers `agent_token.py`) — it runs but is not a required check.
- **AI review** (`.github/workflows/ai-review.yml` + `.github/scripts/ai_review.py`) runs on every PR
  sync, is conversation-aware, and posts as `🔎 [Reviewing Agent]`.
- **Local verification a builder must pass before opening a PR:** `npx tsc --noEmit`, `npm run build`,
  `npm test`; for backend changes, `pytest` from `backend/`.
- **Conventions** (enforced by review): Tailwind theme CSS vars not hard-coded hex; no `any` to silence
  the compiler; relative imports within `src/`; mobile-first. See repo `CLAUDE.md`.
- **Contract files (frozen)** — the canonical definition (mirrors repo `CLAUDE.md` / `docs/DESIGN.md`;
  this is the single source of truth for the procedures, which must not restate a looser or narrower
  version):
  - **Fully frozen** (no edits to exported types/signatures): `src/lib/text.ts`,
    `src/compendium/types.ts`, `src/matching/types.ts`, `src/stt/types.ts`.
  - **`src/compendium/loader.ts`** — only the **public `Compendium` interface signature**
    (`loadCompendium()` return type; `exact`/`phonetic`/`search` signatures) and the `CompendiumEntry`
    + payload shapes are frozen. The loader's **internal implementation** (alias generation, index
    building, normalization helpers) may evolve freely.
  - **Carve-out:** test files (`*.test.ts` and test-only helpers) are **not** contract-frozen and may
    be added/edited anywhere.
  - Any change to a frozen type/signature goes through `docs/DESIGN.md` + the human first — escalate.

---

## 8. Windows / PowerShell gotchas (all loops run on Windows)

- Use the **PowerShell tool** and Windows paths. `gh` lives at `C:\Program Files\GitHub CLI\gh.exe`
  (not always on `PATH`).
- **Don't** redirect native `git`/`gh` stderr with `2>&1` — PowerShell wraps it as a NativeCommandError
  and falsely fails `$?`.
- **Avoid** `gh --jq` with `\(...)` interpolation and here-strings — they mangle. Prefer
  `gh ... --json ... | ConvertFrom-Json`, and post bodies via `--body-file` or repeated `-m`.
- No `&&` chaining — use `;` or `if ($?) { ... }`.

---

## 9. Cleanup — finished branches & worktrees

Agent runs create one worktree + branch per issue (`claude/agent/issue-N`). These must be reaped or
they pile up. The mechanism: **[`cleanup.ps1`](cleanup.ps1)** — idempotent, safe, and keys off **PR
state** (not git ancestry, so squash-merges are handled). It removes only branches/worktrees whose PR
is **MERGED or CLOSED with no open PR**; it never touches `main`, the current branch, mid-flight work
(open PR), or a branch that has no PR yet.

- **Self-healing:** the **dispatcher runs `cleanup.ps1` at the start of every run** (so stale state is
  reaped before new work); the **babysitter removes its worktree when done** with a PR.
- **Standalone / on demand:** `pwsh infra/agent-ops/cleanup.ps1 -DryRun` to preview, then without
  `-DryRun` to prune. Safe to run anytime.
- **Remote branches:** `cleanup.ps1` prunes local worktrees + branches and stale remote-tracking refs
  (`fetch --prune`). Deleting the actual *remote* head branch on merge is handled by the repo setting
  **Settings → General → "Automatically delete head branches"** — keep that enabled so merged agent
  branches disappear server-side automatically.

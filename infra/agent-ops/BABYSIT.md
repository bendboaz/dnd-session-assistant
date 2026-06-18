# PR Babysitter — review-response loop

Drives each open `claude/agent/issue-*` PR to a **clean, mergeable review** — **including substantive
code changes/additions**, not just mechanical nits — using a **bounded, one-iteration-per-run loop**.
Escalates only when genuinely blocked (contract-file change, product decision, iteration cap, or going
in circles).

Shared contract (identity, labels, role headers, escalation, Windows gotchas, contract-file
definition): [`OPERATIONS.md`](OPERATIONS.md). This doc is the step-by-step procedure on top of it.

## Run model — one iteration per run

Each scheduled run performs **at most one round** of fixes per PR: read the current state → make the
needed changes → verify → **one push** → reply. That push triggers a fresh CI + AI-review; the **next**
scheduled run sees the new review round and continues. Convergence is therefore spread across runs, and
the **iteration cap counts rounds across runs** (§4), not pushes within a run. This keeps each run short
and crash-safe (no long-held session polling CI).

---

## 1. Preconditions

```powershell
$env:GH_APP_ID              = "4070567"
$env:GH_APP_INSTALLATION_ID = "140736715"
$env:GH_APP_PRIVATE_KEY_PATH = "<absolute path to the .pem, outside the repo>"
$env:GH_TOKEN = (python infra/agent-ops/agent_token.py)
& "C:\Program Files\GitHub CLI\gh.exe" auth status   # must show the App, not the human
```
Token is short-lived (~10 min); re-mint if a run runs long. (When launched by `run-babysit.ps1`, the
token is already minted and `GH_TOKEN` is set.)

---

## 2. Select PRs

List open PRs whose head branch matches `claude/agent/issue-*` (the autonomous lane — never touch
interactive `claude/...` branches), with CI, review, and mergeability state.

```powershell
$gh   = "C:\Program Files\GitHub CLI\gh.exe"
$slug = "bendboaz/dnd-session-assistant"
$prs  = & $gh pr list --repo $slug --state open `
  --json number,headRefName,mergeStateStatus,reviewDecision,statusCheckRollup,labels | ConvertFrom-Json
$agentPRs = $prs | Where-Object { $_.headRefName -match '^claude/agent/issue-' -and ($_.labels.name -notcontains 'needs-attention') }
```
Skip PRs already labelled `needs-attention` (a human owns them until they clear it). A PR **needs a
round** this run if any of: `mergeStateStatus` in `BEHIND/DIRTY/UNSTABLE`; a required check
(`frontend`/`backend`) concluded failure; `reviewDecision = CHANGES_REQUESTED`; **or** there is a
`🔎 [Reviewing Agent]` comment with no newer `🛠️ [Implementing Agent]` / `👤 [Human]` reply (an
unaddressed review round). The wrapper's deterministic gate (`run-babysit.ps1`) checks this before
launching, so if you are running you have work to do.

---

## 3. One iteration: rebase → fix CI → address review

Do all work for a PR in a **dedicated worktree** so the main checkout is never disturbed:

```powershell
$n = <issue number>; $branch = "claude/agent/issue-$n"
$repoRoot = "D:\Users\Boaz\CodeProjects\dnd-session-assistant"
$wt       = "D:\Users\Boaz\CodeProjects\dnd-wt\issue-$n"   # matches the allowlist + --add-dir grant
git -C $repoRoot fetch origin main
if (-not (Test-Path $wt)) { git -C $repoRoot worktree add $wt $branch }
Set-Location $wt
```

### 3a. Rebase if behind
```powershell
git rebase origin/main
```
Resolve **trivial** conflicts (lockfiles → regenerate; import-order/whitespace; generated CSS → rebuild).
A conflict involving **real overlapping logic** → escalate (§6), `git rebase --abort`.

### 3b. Fix failing CI
Read the failing job (`gh run view <id> --log-failed`). **Fix the actual cause** — lint/format/type
errors, *and* genuine logic/test failures within the linked issue's scope. Re-run only for clearly
transient/flaky failures. Escalate (§6) only if the fix needs a contract-file change or a product
decision.

### 3c. Address the AI review (the core)
Fetch the thread; for every `🔎 [Reviewing Agent]` finding **not yet addressed** by a newer
`🛠️`/`👤` reply, **make the change it asks for** — mechanical *or* substantive (real code, new tests).
Prefer staying **within the linked issue's scope**; you MAY change code **outside** that scope **only
when it is directly required to resolve a review finding** (e.g. fix production code so a flagged gap
becomes testable) — keep such changes **minimal and consistent with existing patterns**, never broad
refactors. Always obey the **contract-file rules** (OPERATIONS.md §7). This is the key difference from a
mechanical-only babysitter: you resolve the review, you don't punt it.

```powershell
$thread = (& $gh pr view $n --repo $slug --json comments | ConvertFrom-Json).comments
$thread | ForEach-Object { "--- $($_.author.login) $($_.createdAt) ---`n$($_.body)`n" }
```

- For a finding you **can** resolve in-scope: implement it, keeping changes minimal and matching repo
  conventions (`CLAUDE.md`: no `any` to silence the compiler, theme CSS vars, etc.). If a finding is
  large/independent, prefer a focused, correct change over a sprawling one.
- For a finding you **should not** act on (needs a genuine product/design decision, is pre-existing /
  flagged not-introduced-here, or would need broad out-of-scope changes beyond a minimal required fix):
  don't force it — note it in the reply
  and, if it blocks merge, escalate (§6). A reviewer "looks good / no blocking issues" needs no code
  change — just acknowledge it (which advances the thread so the gate won't re-fire).

### 3d. Verify, then ONE push
Before pushing, all required checks must pass locally:
```powershell
npm ci; npx tsc --noEmit; npm run build; npm test     # + pytest in backend/ for backend changes
```
Then commit and push **once** (this run's single round):
```powershell
git push --force-with-lease origin $branch    # (plain push if no rebase happened)
```

### 3e. Reply with a role-headed summary
Post one `🛠️ [Implementing Agent]` comment (via `--body-file`) listing, per review finding: what you
changed (file/why) or — for anything you intentionally left — the reason. This both records progress
and lets the conversation-aware reviewer skip resolved points next round.

---

## 4. Iteration cap + circular / no-progress guard

The loop is **bounded by rounds across runs**, not pushes within a run.

- **Round count** = number of `🛠️ [Implementing Agent]` reply comments already on the PR. **Cap = 4.**
- If rounds **≥ cap** and the PR is still not clean → **escalate** (§6): "addressed N rounds; not
  converged." Stop.
- **Circular / no-progress:** if the newest review **re-raises a finding a prior `🛠️` reply claimed to
  resolve**, or successive rounds keep surfacing new issues with no net reduction → you are likely going
  in circles → **escalate**. Do **not** re-apply a fix the thread shows was already made (see §5).

This is the "solve it / hit the cap / detect circling" bound: the babysitter keeps iterating across
runs until the review is clean, but never indefinitely.

---

## 5. AI-review timing race (issue #13)

`ai-review.yml` snapshots the thread at job start, so a reply posted right before a new push may be
missed and a point re-raised. After pushing + replying, either rely on the next-sync conversation-aware
pass (it reads `🛠️`/`👤` replies and skips resolved points), or re-trigger:
```powershell
& $gh workflow run ai-review.yml --repo $slug --ref $branch
```
If a run re-raises an already-resolved point, **confirm the reply/fix is in the thread and do not
re-fix it** — distinguish this (a stale-snapshot artifact) from genuine circling (§4) before escalating.

---

## 6. Escalation (narrowed)

Escalate — `needs-attention` label on the PR + a `🛠️ [Implementing Agent]` comment stating exactly
what's blocked + a `PushNotification` — then **stop on this PR** and move on. Escalate **only** when:

- A fix would require editing a **contract file** (OPERATIONS.md §7) or `.github/workflows/*`.
- The feedback needs a genuine **product/design decision**, or is **out of the linked issue's scope**.
- **Iteration cap** (§4) reached, or **circular / no-progress** detected.
- A rebase conflict involves **real overlapping logic**.

```powershell
& $gh pr edit $n --repo $slug --add-label "needs-attention"
$body = "🛠️ **[Implementing Agent]**`n`nEscalating — human attention required.`n`n**Reason:** <...>`n`n<what's blocked / what you tried>"
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $body)
& $gh pr comment $n --repo $slug --body-file $tmp; Remove-Item $tmp
# then send a PushNotification with a one-line summary + the PR URL
```

**Hard limits (never):** approve a PR; merge; force-past a failing required check; edit
`.github/workflows/*`; change branch protection / rulesets / secrets; edit issues or their labels
(except adding `needs-attention` on the PR); touch a branch that isn't `claude/agent/issue-*`.

---

## 7. Done state — merge-ready

A PR is merge-ready when: `frontend` + `backend` checks are `SUCCESS`; `mergeStateStatus` is `CLEAN`
(not behind/dirty); and there are no unaddressed `🔎 [Reviewing Agent]` findings (the latest review is
clean or every point has a `🛠️`/`👤` reply). When that holds, post a brief `🛠️` "merge-ready" note and
send a `PushNotification`: `"PR #N '<title>' is green + review-clean, ready to merge. <url>"`.
**The babysitter never merges — the human does.**

---

## 8. Cleanup

Remove the worktree you created when done with this run's PR:
```powershell
Set-Location $repoRoot
git worktree remove "D:\Users\Boaz\CodeProjects\dnd-wt\issue-$n" --force
```
The branch persists until its PR merges/closes, then is pruned by `cleanup.ps1` (OPERATIONS.md §9).

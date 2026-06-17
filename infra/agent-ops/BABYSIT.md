# PR Babysitter — step-by-step procedure

Keeps agent-authored PRs on `claude/agent/issue-*` green and mergeable.
**Mechanical fixes only. Escalate anything substantive.**

Shared contract (identity, labels, role headers, escalation, Windows gotchas): [`OPERATIONS.md`](OPERATIONS.md).
This document is the step-by-step procedure that builds on top of it.

---

## 1. Preconditions

Before any babysitter action the GitHub App token must be in the environment and verified.

```powershell
# Set App env vars (the key path lives outside the repo)
$env:GH_APP_ID             = "4070567"
$env:GH_APP_INSTALLATION_ID = "140736715"
$env:GH_APP_PRIVATE_KEY_PATH = "<absolute path to the .pem, outside the repo>"

# Mint a short-lived installation token and hand it to gh + git
$env:GH_TOKEN = (python infra/agent-ops/agent_token.py)

# Verify — output must show the App (dnd-agent), not the human account
& "C:\Program Files\GitHub CLI\gh.exe" auth status
```

The token expires in ~10 minutes. Re-mint with another `python infra/agent-ops/agent_token.py` call
if a run is long (see §5 commit-cap).

---

## 2. Select PRs

List all open PRs whose head branch matches `claude/agent/issue-*`, along with their CI check
status, review state, and mergeability.

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"

# Fetch open agent PRs
$prs = & $gh pr list `
  --repo bendboaz/dnd-session-assistant `
  --state open `
  --json number,title,headRefName,baseRefName,mergeable,reviewDecision,statusCheckRollup `
  | ConvertFrom-Json

# Filter to agent branches only — never touch interactive claude/... branches
$agentPRs = $prs | Where-Object { $_.headRefName -match '^claude/agent/issue-' }

# Inspect each PR
foreach ($pr in $agentPRs) {
    Write-Host "PR #$($pr.number)  $($pr.headRefName)  mergeable=$($pr.mergeable)  review=$($pr.reviewDecision)"
    foreach ($check in $pr.statusCheckRollup) {
        Write-Host "  check: $($check.name)  status=$($check.status)  conclusion=$($check.conclusion)"
    }
}
```

Key fields:
- `mergeable`: `MERGEABLE` | `CONFLICTING` | `UNKNOWN`
- `reviewDecision`: `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | `""` (none)
- `statusCheckRollup[].name`: look for `frontend` and `backend`
- `statusCheckRollup[].conclusion`: `SUCCESS` | `FAILURE` | `CANCELLED` | `null` (in-progress)

Process each PR in the order returned (highest-priority work is dispatched first). For each PR,
work through steps 3a → 3b → 3c in order, applying the commit-cap (§4) throughout.

---

## 3. Per-PR actions

### 3a. Behind main? — rebase

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"

# Check mergeability; CONFLICTING also means behind-and-conflicting
$prData = & $gh pr view $prNumber `
  --repo bendboaz/dnd-session-assistant `
  --json mergeable,headRefName `
  | ConvertFrom-Json

if ($prData.mergeable -eq "CONFLICTING") {
    # Fetch and rebase
    git fetch origin main
    git checkout $prData.headRefName
    git rebase origin/main
    # ... resolve conflicts if any, then:
    git push --force-with-lease origin $prData.headRefName
}
```

**Conflict triage:**

| Conflict type | Action |
|---|---|
| Lockfile (`package-lock.json`, `poetry.lock`) | Delete the conflicted file, re-run `npm ci` or `pip install`, stage result, continue rebase |
| Import-order or whitespace-only | Accept incoming or current (either is correct), continue rebase |
| Generated files (`.css` output, build artifacts) | Regenerate with `npm run build`, stage, continue rebase |
| Any real logic change with overlapping edits | **Escalate** (§Escalation below), `git rebase --abort`, leave the PR |

After a successful rebase+push, decrement the commit-cap counter for this PR (§4).

### 3b. CI failed? — read logs and fix or escalate

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"

# Get the latest workflow run for this PR
$runs = & $gh run list `
  --repo bendboaz/dnd-session-assistant `
  --branch $headRefName `
  --json databaseId,name,status,conclusion `
  | ConvertFrom-Json

# Pick the most recent failed run
$failedRun = $runs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1

if ($failedRun) {
    # Show the failed jobs and their logs
    & $gh run view $failedRun.databaseId `
      --repo bendboaz/dnd-session-assistant `
      --log-failed
}
```

**Failure triage:**

| Failure pattern | Action |
|---|---|
| ESLint / Prettier / tsc error in a file the PR touched | Fix the specific lint/type error, push (mechanical) |
| Type error: `any` used to silence the compiler | Replace with the correct explicit type (mechanical if the type is obvious from context) |
| Flaky/transient: network timeout, rate limit, random seed, no change to source | Re-run the job: `& $gh run rerun $runId --repo bendboaz/dnd-session-assistant --failed` |
| `frontend` build error from a real logic problem | **Escalate** |
| `backend` test failure from a real logic problem | **Escalate** |
| Contract file touched (per OPERATIONS.md §7 *Contract files (frozen)*) | **Escalate** — do not attempt to fix |

For a re-run, wait for the run to complete before moving on to step 3c. A re-run does NOT count
against the commit-cap (no push is involved).

After a mechanical fix+push, decrement the commit-cap counter for this PR (§4).

### 3c. AI-review nits — read thread, fix or escalate

Fetch the full PR comment thread and locate all `🔎 **[Reviewing Agent]**` comments.

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"

$thread = & $gh pr view $prNumber `
  --repo bendboaz/dnd-session-assistant `
  --json comments `
  | ConvertFrom-Json

# Print all comments with their authors for manual inspection
foreach ($c in $thread.comments) {
    Write-Host "--- $($c.author.login) ---"
    Write-Host $c.body
    Write-Host ""
}
```

For each `[Reviewing Agent]` point that has NOT already been addressed by a `🛠️ [Implementing Agent]`
or `👤 [Human]` reply:

**Mechanical nit (auto-fix and push):**

| Nit type | Examples |
|---|---|
| Dead/unused code | Unused import, commented-out block, unreachable branch |
| Hard-coded hex color | Replace with `var(--color-*)` from `src/index.css` |
| `any` used only to silence the compiler | Replace with the correct explicit type |
| Trivially-missing test | A test for a pure function with obvious inputs/outputs |

Fix in code, push, then post a reply comment:

```powershell
# Write the comment body to a temp file (avoid shell escaping issues)
$body = @"
🛠️ **[Implementing Agent]**

Addressed the following review nits:

- <bullet: what was fixed and where>
- <bullet: ...>
"@

$tmpFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpFile, $body)

& $gh pr comment $prNumber `
  --repo bendboaz/dnd-session-assistant `
  --body-file $tmpFile

Remove-Item $tmpFile
```

After fix+push, decrement the commit-cap counter for this PR (§4).

**Substantive/logic nit (escalate):**

If the review comment requires a product decision, redesign, real logic change, or touches a
contract file — post an acknowledgement and escalate (see §Escalation below).

```powershell
$body = @"
🛠️ **[Implementing Agent]**

Acknowledging the review comment. This point requires substantive input and has been escalated:

> <paste the reviewer's point>

Adding `needs-attention` and notifying the human.
"@
```

---

## 4. Commit-cap (churn guard)

**Default cap: 3 pushes per PR per babysitter run.**

Track pushes (rebase push, fix push) against this cap. Re-runs (CI re-trigger with no push) do not
count.

```powershell
# Pseudocode — track per PR in a hashtable
$pushCount = @{}
$CAP = 3

function Register-Push($prNumber) {
    if (-not $pushCount.ContainsKey($prNumber)) { $pushCount[$prNumber] = 0 }
    $pushCount[$prNumber]++
    if ($pushCount[$prNumber] -ge $CAP) {
        # Stop all further work on this PR and escalate
        Invoke-Escalate -PrNumber $prNumber -Reason "Commit-cap of $CAP reached; PR still not green."
        return $false   # caller should skip remaining steps for this PR
    }
    return $true
}
```

If the cap is hit: escalate (§Escalation), stop touching that PR, move on to the next PR in the
list. This prevents infinite fix-push loops.

Re-mint the token if you have been running for more than ~8 minutes:

```powershell
$env:GH_TOKEN = (python infra/agent-ops/agent_token.py)
```

---

## 5. AI-review timing race (issue #13)

The AI review workflow (`ai-review.yml`) fetches the PR comment thread at **job start**. A reply
you post moments before a new push triggers a fresh review run may not appear in that run's thread
snapshot — so the reviewer might re-raise a point you just addressed.

**Do not loop fighting a stale review.** After addressing nits and pushing:
- Either re-trigger a fresh AI review run manually:
  ```powershell
  $gh = "C:\Program Files\GitHub CLI\gh.exe"
  & $gh workflow run ai-review.yml `
    --repo bendboaz/dnd-session-assistant `
    --ref $headRefName
  ```
- Or rely on the next-sync conversation-aware pass — `ai_review.py` reads the prior thread and
  skips already-addressed points (`[Implementing Agent]` replies are recognized).

If the next review run re-raises an already-replied-to point, do **not** fix it again. Confirm the
reply is in the thread, note the race, and let the following run resolve it.

---

## 6. Escalation

Escalate when the babysitter hits something outside mechanical scope. From OPERATIONS.md §5:

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"

function Invoke-Escalate {
    param(
        [int]$PrNumber,
        [string]$Reason
    )

    # 1. Add needs-attention label to the PR (not the issue)
    & $gh pr edit $PrNumber `
      --repo bendboaz/dnd-session-assistant `
      --add-label "needs-attention"

    # 2. Post a role-headed comment explaining what is blocked
    $body = @"
🛠️ **[Implementing Agent]**

Escalating — human attention required.

**Reason:** $Reason

The babysitter has stopped working on this PR. Please review and clear `needs-attention` when resolved.
"@
    $tmpFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmpFile, $body)
    & $gh pr comment $PrNumber --repo bendboaz/dnd-session-assistant --body-file $tmpFile
    Remove-Item $tmpFile

    # 3. Send a PushNotification (one-line summary + PR URL)
    $prUrl = "https://github.com/bendboaz/dnd-session-assistant/pull/$PrNumber"
    # (Use the PushNotification tool available in the Claude Code session)
}
```

Escalate (never attempt to fix) when:
- Rebase conflict involves real logic overlap
- CI failure requires real logic or a product decision
- Review comment is substantive or touches a contract file
- Commit-cap is reached and the PR is still not green
- Any ambiguity about whether a fix is truly mechanical

After escalating, move on to the next PR. Do not leave the babysitter blocked on a single PR.

**Hard limits (never, ever):**
- Never approve a PR
- Never merge a PR
- Never force-past a failing required check (`frontend` or `backend`)
- Never edit `.github/workflows/*`
- Never change branch protection or secrets
- Never edit issues or their labels except adding `needs-attention` (on the PR, not the issue)
- Never touch a PR whose branch does not match `claude/agent/issue-*`

---

## 7. Done state — merge-ready notification

A PR is merge-ready when:
1. Both `frontend` and `backend` checks are `SUCCESS`
2. No open unaddressed `[Reviewing Agent]` nits (all have `[Implementing Agent]` or `[Human]` replies)
3. `mergeable` is `MERGEABLE` (not `CONFLICTING`)

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"

$prData = & $gh pr view $prNumber `
  --repo bendboaz/dnd-session-assistant `
  --json number,title,url,mergeable,statusCheckRollup `
  | ConvertFrom-Json

$allGreen = ($prData.statusCheckRollup | Where-Object { $_.conclusion -ne "SUCCESS" }).Count -eq 0
$mergeable = $prData.mergeable -eq "MERGEABLE"

if ($allGreen -and $mergeable) {
    Write-Host "PR #$($prData.number) is merge-ready: $($prData.url)"
    # Send PushNotification: "PR #N '<title>' is green and ready to merge. <url>"
}
```

Send a `PushNotification` to the human: `"PR #N '<title>' is green and ready to merge. <url>"`.
**The babysitter never merges.** The human merges.

---

## 8. Cleanup

If you created a git worktree to make a fix, **remove it when done** with the PR:

```powershell
git worktree remove <worktree-path> --force
```

The branch itself stays until its PR is merged/closed — it is then pruned automatically by
`cleanup.ps1` (OPERATIONS.md §9), which the dispatcher runs at the start of each run (or run it
on demand: `pwsh infra/agent-ops/cleanup.ps1`).

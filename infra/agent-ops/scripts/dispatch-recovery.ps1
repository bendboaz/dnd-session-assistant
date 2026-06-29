# dispatch-recovery.ps1
# Dead-agent recovery scan for the dispatcher loop.
# Runs at the start of every dispatch session (DISPATCH.md ss1c).
# Finds lock files left by interrupted subagent sessions and recovers their state:
#   - Still alive  -> skip
#   - Dead + commits on branch -> draft PR + needs-attention on PR and issue
#   - Dead + no commits        -> unclaim issue (remove in-progress); silent re-dispatch
# Either way: remove worktree and delete lock file.
param(
    [string]$StateDir      = "D:\Users\Boaz\CodeProjects\dnd-session-assistant\.claude\agent-state",
    [string]$Gh            = "C:\Program Files\GitHub CLI\gh.exe",
    [string]$Slug          = "bendboaz/dnd-session-assistant",
    [string]$RepoRoot      = "D:\Users\Boaz\CodeProjects\dnd-session-assistant",
    [string]$TranscriptDir = "C:\Users\Boaz\.claude\projects\D--Users-Boaz-CodeProjects"
)

$ErrorActionPreference = 'Continue'

function Test-SessionActive {
    param([string]$SessionId)
    if (-not $SessionId -or $SessionId -like 'unknown-*') { return $false }
    $transcript = "$TranscriptDir\$SessionId.jsonl"
    if (-not (Test-Path $transcript)) { return $false }
    $age = (Get-Date) - (Get-Item $transcript).LastWriteTime
    return $age.TotalMinutes -lt 15
}

$lockFiles = @(Get-ChildItem "$StateDir\dispatch-lock-*.json" -ErrorAction SilentlyContinue)
if ($lockFiles.Count -eq 0) { return }

Write-Host "[dispatch-recovery] Found $($lockFiles.Count) lock file(s); scanning for dead agents."

foreach ($lf in $lockFiles) {
    $lock = $null
    try { $lock = Get-Content $lf.FullName -Raw | ConvertFrom-Json } catch {
        Write-Warning "[dispatch-recovery] Cannot parse $($lf.Name); removing corrupt lock."
        Remove-Item $lf.FullName -ErrorAction SilentlyContinue
        continue
    }

    $n     = $lock.issueNumber
    $age   = (Get-Date) - [datetime]$lock.startedAt
    $alive = Test-SessionActive $lock.sessionId

    if ($alive -and $age.TotalHours -lt 2) {
        Write-Host "[dispatch-recovery] Issue #${n}: session $($lock.sessionId) still active ($([int]$age.TotalMinutes)min); skipping."
        continue
    }

    Write-Host "[dispatch-recovery] Issue #${n}: dead agent (session=$($lock.sessionId), age=$([int]$age.TotalMinutes)min)"

    # If a PR already exists for this branch, the agent may have finished; just clean the lock.
    $existingPR = @(& $Gh pr list --repo $Slug --head $lock.branch --state open --json number | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) {
        # Can't confirm whether a PR already exists; proceeding could open a duplicate.
        # Skip this lock and let the next run retry once gh is reachable again.
        Write-Warning "[dispatch-recovery] Issue #${n}: 'gh pr list' failed (exit $LASTEXITCODE); skipping this lock to avoid a duplicate PR (will retry next run)."
        continue
    }
    if ($existingPR.Count -gt 0) {
        Write-Host "[dispatch-recovery] Issue #${n}: PR #$($existingPR[0].number) already open; removing stale lock only."
        Remove-Item $lf.FullName -ErrorAction SilentlyContinue
        continue
    }

    # Check for commits on the orphaned branch.
    $hasCommits = $false
    $wt = $lock.worktreePath
    if (Test-Path $wt) {
        $commits = @(git -C $wt log "origin/main..HEAD" --oneline | Where-Object { $_ })
        if ($LASTEXITCODE -ne 0) {
            # An invalid/corrupt worktree makes git fail; without this check the empty
            # result would silently take the "no commits" path and unclaim a branch that
            # may actually hold work. Treat the failure as "unknown" -> no commits, but loudly.
            Write-Warning "[dispatch-recovery] Issue #${n}: 'git log' failed in $wt (exit $LASTEXITCODE); treating as no commits."
            $commits = @()
        }
        $hasCommits = $commits.Count -gt 0
    }

    if ($hasCommits) {
        Write-Host "[dispatch-recovery] Issue #${n}: $($commits.Count) commit(s) found; salvaging as draft PR."

        git -C $wt push origin $lock.branch
        if ($LASTEXITCODE -ne 0) {
            # Without the branch on the remote, the draft PR creation below would fail
            # confusingly. Skip this lock (leave it + the worktree in place) so the next
            # dispatch run retries the recovery rather than half-completing it.
            Write-Warning "[dispatch-recovery] Issue #${n}: 'git push' failed (exit $LASTEXITCODE); skipping PR creation and leaving the lock for the next run to retry."
            continue
        }

        $tmp = "$StateDir\cc-comment.txt"
        @"
🛠️ **[Implementing Agent]**

Orphaned-branch recovery: the implementing subagent for issue #$n failed or was interrupted mid-run.
$($commits.Count) commit(s) were found on this branch; opening as a draft PR for human review.

**Action needed:** review the draft, continue or close, then clear ``needs-attention`` when done.
"@ | Set-Content $tmp -Encoding utf8

        $prUrl = & $Gh pr create --repo $Slug --head $lock.branch --base main --draft `
            --title "[DRAFT] Issue #$n — orphaned by interrupted agent" `
            --body-file $tmp
        if ($LASTEXITCODE -ne 0) {
            # PR creation failed: the branch is pushed but unmerged. Leave the lock and
            # worktree in place so the next run retries, rather than deleting them below
            # and silently stranding the orphaned branch with no PR.
            Write-Warning "[dispatch-recovery] Issue #${n}: 'gh pr create' failed (exit $LASTEXITCODE); leaving the lock for the next run to retry."
            Remove-Item $tmp -ErrorAction SilentlyContinue
            continue
        }
        Remove-Item $tmp -ErrorAction SilentlyContinue

        # Add needs-attention to both the PR and the issue.
        $prNumber = ($prUrl -split '/')[-1]
        if ($prNumber -match '^\d+$') {
            & $Gh pr edit $prNumber --repo $Slug --add-label "needs-attention"
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "[dispatch-recovery] Issue #${n}: could not add 'needs-attention' to PR #$prNumber (exit $LASTEXITCODE)."
            }
        }
        & $Gh issue edit $n --repo $Slug --add-label "needs-attention"
    } else {
        # No commits: silently unclaim so the next dispatch run can re-dispatch.
        # Removing in-progress here is dispatcher-owned cleanup (this script runs only from
        # within the dispatcher loop, DISPATCH.md 1c) — not a cross-loop label write.
        Write-Host "[dispatch-recovery] Issue #${n}: no commits; unclaiming for re-dispatch."
        & $Gh issue edit $n --repo $Slug --remove-label "in-progress"
    }

    # Remove the worktree (branch stays on remote if it was pushed above).
    if (Test-Path $wt) {
        git -C $RepoRoot worktree remove $wt
        if (Test-Path $wt) {
            Write-Warning "[dispatch-recovery] Issue #${n}: worktree removal blocked (file lock?); manual cleanup needed: $wt"
        }
    }

    Remove-Item $lf.FullName -ErrorAction SilentlyContinue
    Write-Host "[dispatch-recovery] Issue #${n}: recovery complete."
}

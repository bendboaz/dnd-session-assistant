# dispatch-lock-write.ps1
# Called by the dispatcher immediately after creating a worktree for an issue (DISPATCH.md ss5.1).
# Records the issue, branch, worktree path, and a best-effort Claude session identifier so the
# recovery scan (dispatch-recovery.ps1) can detect a dead subagent on the next dispatcher run.
#
# Session ID caveat: extracted from the most-recently-modified scratchpad directory under the
# project's temp area. This is a heuristic — if multiple Claude Code sessions for this project
# run simultaneously, it may pick the wrong UUID. The 2-hour TTL in dispatch-recovery.ps1
# is the safety net when the session ID cannot be confirmed.
param(
    [Parameter(Mandatory)][int]   $IssueNumber,
    [Parameter(Mandatory)][string]$WorktreePath,
    [Parameter(Mandatory)][string]$Branch,
    [string]$StateDir = "D:\Users\Boaz\CodeProjects\dnd-session-assistant\.claude\agent-state"
)

$ErrorActionPreference = 'Continue'

$scratchpadBase = "C:\Users\Boaz\AppData\Local\Temp\claude\D--Users-Boaz-CodeProjects"
$sessionId = (Get-ChildItem "$scratchpadBase\*\scratchpad" -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).Parent.Name
if (-not $sessionId) { $sessionId = "unknown-$(Get-Date -Format 'HHmmss')" }

if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Force -Path $StateDir | Out-Null }

@{
    version      = 1
    issueNumber  = $IssueNumber
    sessionId    = $sessionId
    startedAt    = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    worktreePath = $WorktreePath
    branch       = $Branch
} | ConvertTo-Json | Set-Content "$StateDir\dispatch-lock-$IssueNumber.json" -Encoding utf8

Write-Host "[dispatch-lock] Lock written for issue #$IssueNumber (session=$sessionId)"

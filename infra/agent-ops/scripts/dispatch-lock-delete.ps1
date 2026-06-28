# dispatch-lock-delete.ps1
# Called at the end of both the success path (DISPATCH.md ss7.5) and the failure/escalation
# path (DISPATCH.md ss8.4) to release the lock written by dispatch-lock-write.ps1.
param(
    [Parameter(Mandatory)][int]$IssueNumber,
    [string]$StateDir = "D:\Users\Boaz\CodeProjects\dnd-session-assistant\.claude\agent-state"
)

$ErrorActionPreference = 'Continue'

$lockFile = "$StateDir\dispatch-lock-$IssueNumber.json"
if (Test-Path $lockFile) {
    Remove-Item $lockFile -ErrorAction SilentlyContinue
    if (-not (Test-Path $lockFile)) {
        Write-Host "[dispatch-lock] Lock released for issue #$IssueNumber"
    } else {
        Write-Warning "[dispatch-lock] Could not remove lock file for issue #$IssueNumber; manual cleanup: $lockFile"
    }
} else {
    Write-Host "[dispatch-lock] No lock file for issue #$IssueNumber (already clean)"
}

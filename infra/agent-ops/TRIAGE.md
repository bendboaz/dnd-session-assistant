# Backlog Triage — Procedure

**Propose-only guarantee (do not skip this):**
Triage **never** applies or removes `ready`, `priority:*`, `blocked`, `in-progress`, or
`needs-attention` on real backlog issues. The **only** thing it writes to GitHub is its own
triage-report issue (create or in-place update). It opens no code PRs and touches no branches.
The human is the sole gate on labeling.

This procedure builds on [`OPERATIONS.md`](OPERATIONS.md). Read that file first — it is the frozen
shared contract for identity, label taxonomy, coordination, escalation, and Windows/PowerShell
gotchas. This document adds only the step-by-step triage flow; it does not redefine anything in
OPERATIONS.md.

**Runs:** locally on this machine — on demand or via a local scheduled run that opens a Claude Code
session (cloud routine deferred; see OPERATIONS.md §6). Date is supplied to each run as `$triageDate`
(format `YYYY-MM-DD`); never invent a date.

---

## 1. Preconditions

1. `GH_TOKEN` must be set to a short-lived GitHub App installation token for `dnd-agent`
   (App ID `4070567`, Installation ID `140736715`). See OPERATIONS.md §1 for the full identity
   and KEY-ENV CONSTRAINT. The token grants read-mostly access plus issue-write for the report.

2. Local (PowerShell):
   ```powershell
   $env:GH_APP_ID = "4070567"
   $env:GH_APP_INSTALLATION_ID = "140736715"
   $env:GH_APP_PRIVATE_KEY_PATH = "<path to the .pem, outside the repo>"
   $env:GH_TOKEN = (python infra/agent-ops/agent_token.py)
   & "C:\Program Files\GitHub CLI\gh.exe" auth status   # must show the App, not the human
   ```

3. Cloud (GitHub Actions): token is minted by `actions/create-github-app-token` and passed as
   `GH_TOKEN`. See OPERATIONS.md §1 (CI subsection).

4. The token is short-lived (~10 min). Re-mint if a long run might exceed that window.

---

## 2. Gather open issues

Pull all open issues as JSON, excluding the triage-report issue itself (identified in step 6).

```powershell
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$repo = "bendboaz/dnd-session-assistant"

# Fetch all open issues (up to 200; increase --limit if the backlog grows)
$issuesRaw = & $gh issue list `
    --repo $repo `
    --state open `
    --limit 200 `
    --json number,title,labels,body,createdAt,updatedAt

$issues = $issuesRaw | ConvertFrom-Json
```

**Find the triage-report issue number** (so it can be excluded from assessment):

```powershell
$reportIssue = $issues | Where-Object { $_.title -like "*Backlog triage*" }
$reportNumber = if ($reportIssue) { $reportIssue.number } else { $null }

# Working set: everything except the report itself
$backlog = if ($reportNumber) {
    $issues | Where-Object { $_.number -ne $reportNumber }
} else {
    $issues
}
```

**Fetch linked PRs** per issue (needed to detect in-review status and blocked relationships):

```powershell
# For each issue, check for open PRs that reference it via "Closes #N"
# gh issue view --json number gives developmentBranch; alternatively scan open PRs:
$openPRsRaw = & $gh pr list `
    --repo $repo `
    --state open `
    --limit 100 `
    --json number,title,body,headRefName,labels

$openPRs = $openPRsRaw | ConvertFrom-Json

# Build a lookup: issueNumber -> linked PR (if any)
$linkedPR = @{}
foreach ($pr in $openPRs) {
    $matches = [regex]::Matches($pr.body, "(?i)closes\s+#(\d+)")
    foreach ($m in $matches) {
        $linkedPR[[int]$m.Groups[1].Value] = $pr
    }
}
```

**Compute age** for staleness (days since `updatedAt`):

```powershell
$today = [datetime]::UtcNow
foreach ($issue in $backlog) {
    $issue | Add-Member -NotePropertyName "daysSinceUpdate" `
        -NotePropertyValue ([int]($today - [datetime]$issue.updatedAt).TotalDays) `
        -Force
}
```

---

## 3. Assess each issue

For every issue in `$backlog`, evaluate four dimensions. Record your findings; they populate the
report in step 6.

### 3a. Completeness (can a dispatcher build from this?)

A well-specified issue has all three sections that `DISPATCH.md` requires to claim and build:

- **Scope** — what is being built and why
- **Files / Owned files** — which files the agent may touch
- **Acceptance criteria** — testable conditions for done

Flag as **incomplete** if any section is missing, vague, or too short to act on without product
decisions. An incomplete issue is not a ready candidate regardless of other factors.

### 3b. Suggested priority

Assign `high` / `medium` / `low` with a one-line rationale. Signals:

- **high** — blocks other work, directly impacts a live user path, or has an explicit request from
  the human to do it soon
- **medium** — meaningful feature or fix, no hard dependency
- **low** — polish, docs, refactor, or long-tail edge case

This is a *suggestion* for the human. The human applies the `priority:*` label (see OPERATIONS.md
§2).

### 3c. Blocked-by / dependency relationships

Check issue body for explicit "depends on #N", "blocked by #N", or similar language. Also check
whether any referenced upstream issue is still open. Flag as **blocked** if a hard dependency is
unmet. (Triage proposes the `blocked` flag in the report; the human sets the label.)

### 3d. Duplicates and staleness

- **Duplicate:** two issues describe the same change. Flag both; propose which to close.
- **Stale:** not updated in more than **60 days** OR the work it describes was already merged
  (check whether a merged PR body references the issue number). Flag for human review.

---

## 4. Pick `ready` candidates

From the assessed backlog, select the top **3–5** issues that are:

1. **Complete** — all three sections present and unambiguous
2. **Unblocked** — no unmet hard dependencies
3. **Not a duplicate** and not stale
4. Well-sized — dispatchable in a single focused PR (not a multi-week epic)

Rank by suggested priority, then by issue number (older issues first within the same priority).

**Triage recommends; the human applies `ready`.** Write the candidates into the report with a
one-sentence rationale for each. Do not touch the `ready` label.

---

## 5. Propose a next dispatcher batch

From the ready candidates (or the shortlist of candidates you'd bless if the human agrees),
produce an ordered list — **priority descending, then number ascending** — of up to **5** issues
that the dispatcher should pick up once the human labels them `ready`.

Note: the dispatcher caps concurrent open PRs at **3** (OPERATIONS.md §3). A batch may be larger
(so there is a queue), but flag that the dispatcher won't exceed the cap.

---

## 6. Write the triage-report issue

### Find or create the report issue

The report lives in **exactly one** open issue whose canonical title is `🗂️ Backlog triage`. Match
it by the **plain substring `Backlog triage`** (not the emoji) so the lookup is robust regardless of
how the title renders; always create it *with* the emoji.

```powershell
# Reuse $issues from step 2 (the report may have been excluded from $backlog there)
$reportIssue  = $issues | Where-Object { $_.title -match "Backlog triage" }
$reportNumber = if ($reportIssue) { $reportIssue[0].number } else { $null }
```

**If the report issue already exists:** edit its body in place — do NOT create a new one.

```powershell
# Write the report body to a temp file (avoids here-string / interpolation issues — OPERATIONS.md §8)
$bodyFile = "$env:TEMP\triage-report-body.md"
Set-Content -Path $bodyFile -Value $reportBody -Encoding utf8

& $gh issue edit $reportNumber `
    --repo $repo `
    --body-file $bodyFile
```

**If no report issue exists (first run / cold start):** create it.

```powershell
& $gh issue create `
    --repo $repo `
    --title "🗂️ Backlog triage" `
    --body-file $bodyFile
```

After creating, capture the returned URL and extract the issue number from it for the
`PushNotification` link in step 7.

### Report body format

The body must open with the `🛠️ **[Implementing Agent]**` role header (OPERATIONS.md §4), followed
by a blank line, then the sections below. Date-stamp with the value of `$triageDate`.

```markdown
🛠️ **[Implementing Agent]**

_Last updated: YYYY-MM-DD_

---

## Summary

| Stat | Count |
|---|---|
| Open backlog issues (excl. this report) | N |
| Complete & unblocked | N |
| Incomplete | N |
| Blocked | N |
| Duplicate | N |
| Stale (>60 days since update) | N |

---

## Ready candidates

Issues recommended for the human to bless with `ready`:

| # | Title | Rationale |
|---|---|---|
| #N | Title | One-line rationale |
...

> ⚠️ Triage proposes; the human applies the `ready` label.

---

## Suggested priorities

| Issue | Suggested priority | Why |
|---|---|---|
| #N Title | high / medium / low | One-line reason |
...

> ⚠️ Triage proposes; the human applies `priority:*` labels.

---

## Blocked / Duplicate / Stale flags

**Blocked**
- #N — blocked by #M (still open)

**Duplicate**
- #N duplicates #M — recommend closing #N

**Stale**
- #N — last updated DD days ago; may be obsoleted by <merged work or reason>

_(If any section is empty, write "None detected.")_

---

## Proposed next dispatcher batch

Ordered shortlist for the dispatcher once the human blesses them. Dispatcher cap: 3 concurrent PRs.

1. #N — Title (priority: high)
2. #N — Title (priority: high)
3. #N — Title (priority: medium)
...

---

_Propose-only run. No labels were applied or removed. No PRs were opened._
```

---

## 7. Notify

After the report is written (or updated), send a `PushNotification` with:

- **Title:** `Backlog triage complete — YYYY-MM-DD`
- **Body:** one line summarising counts and the top ready candidate, e.g.:
  `12 open issues: 4 complete/unblocked, 3 ready candidates. Top pick: #42 Add phonetic matching. Report: <URL>`

Do NOT send a notification for routine intermediate steps — only once the report is posted.
See OPERATIONS.md §5 for escalation policy (use `needs-attention` + notify if triage itself hits an
unexpected error; do not silently swallow failures).

---

## 8. Cold-start note (first run)

On the first run the backlog is unlabeled — no `ready`, no `priority:*`, no `blocked`. Triage
still runs the full assessment above. The report does the initial pass over all open issues,
proposing priorities and ready candidates. This is intentional: the human reviews the report and
applies labels to bootstrap the labeling state. Subsequent runs will have a richer starting
point.

---

## Operational notes

- **Do not** apply or remove any label on any backlog issue. This constraint comes from
  OPERATIONS.md §2 and §3, which assign label ownership. Triage owns no labels on backlog issues.
- **Do not** open code PRs, create branches, or push commits.
- **Re-mint the token** if the run takes longer than ~10 minutes. See OPERATIONS.md §1.
- **Windows / PowerShell gotchas:** see OPERATIONS.md §8. In particular: use `--body-file` not
  inline `--body` for multiline content; avoid `2>&1` on `gh`/`git`; no `&&` — use `;` or
  `if ($?) { ... }`.
- **gh path:** `C:\Program Files\GitHub CLI\gh.exe` (not always on `PATH`). Assign to `$gh` at
  the top of the script.

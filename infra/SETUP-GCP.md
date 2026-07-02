# GCP Setup Instructions

Setup for deploying the D&D Session Assistant to GCP. **Project id:** `dnd-session-assistant-52633`.
**Region:** `europe-west1` (Cloud Run + Firestore). All commands are PowerShell (Windows).

> Status: the GCP project `dnd-session-assistant-52633`, `gcloud`/`firebase` CLIs, and Firebase
> Auth (Google provider) + the web app are set up. **Billing must be on the Blaze plan**
> (linked billing account) for Cloud Run / Artifact Registry / Cloud Build. The three Secret
> Manager secrets (`SONIOX_API_KEY`, `DEEPGRAM_API_KEY`, `ALLOWED_EMAILS`) must be created in
> *this* project (an earlier set was created in a stray `dnd-session-assistant` project that
> is being deleted). This doc lists the full path for reproducibility.

```powershell
$PROJECT_ID = "dnd-session-assistant-52633"
$REGION     = "europe-west1"
gcloud config set project $PROJECT_ID
```

## 1. Enable required APIs

```powershell
gcloud services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  firestore.googleapis.com `
  secretmanager.googleapis.com `
  cloudbuild.googleapis.com `
  identitytoolkit.googleapis.com `
  --project=$PROJECT_ID
```

## 2. Artifact Registry

```powershell
gcloud artifacts repositories create docker-repo `
  --repository-format=docker `
  --location=$REGION `
  --project=$PROJECT_ID `
  --description="Docker repository for D&D Session Assistant"
```

## 3. Firestore (Native mode)

> The Firestore **location is permanent** once created. We use `europe-west1`.

```powershell
gcloud firestore databases create `
  --location=$REGION `
  --type=firestore-native `
  --project=$PROJECT_ID
```

Lock the database to backend-only access by deploying the repo's rules (the browser never
touches Firestore directly — only the backend, via the Admin SDK, does):

```powershell
firebase deploy --only firestore:rules --project=$PROJECT_ID
```

(See `firestore.rules` — it denies all direct client read/write.)

## 4. Firebase Authentication

Already enabled (Google sign-in provider). Once the Hosting URL exists, add it under
**Firebase console → Authentication → Settings → Authorized domains**
(`dnd-session-assistant-52633.web.app` / `.firebaseapp.com`).

## 5. Secrets (Secret Manager)

The three secrets already exist (`SONIOX_API_KEY`, `DEEPGRAM_API_KEY`, `ALLOWED_EMAILS`),
created with a Windows-safe helper that avoids the trailing-newline/BOM corruption of the
`echo "..." | gcloud` pattern. `ALLOWED_EMAILS` is a comma-separated allowlist of Google
account emails permitted to sign in. To rotate a value, add a new version:

```powershell
$tmp = New-TemporaryFile
[System.IO.File]::WriteAllText($tmp.FullName, "NEW_VALUE")   # no newline, no BOM
gcloud secrets versions add SONIOX_API_KEY --data-file="$($tmp.FullName)" --project=$PROJECT_ID
Remove-Item $tmp.FullName -Force
```

### Grant the Cloud Run runtime service account access

Cloud Run mounts the secrets as env vars (`--set-secrets`), so the **runtime** service
account needs `secretmanager.secretAccessor`. The default runtime SA is the Compute
default SA:

```powershell
$PNUM = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"
$RUNTIME_SA = "$PNUM-compute@developer.gserviceaccount.com"

foreach ($s in @("SONIOX_API_KEY","DEEPGRAM_API_KEY","ALLOWED_EMAILS")) {
  gcloud secrets add-iam-policy-binding $s `
    --member="serviceAccount:$RUNTIME_SA" `
    --role="roles/secretmanager.secretAccessor" `
    --project=$PROJECT_ID
}
```

## 6. Service account for GitHub Actions (CI/CD deploys)

```powershell
$SA_NAME  = "github-actions"
$SA_EMAIL = "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create $SA_NAME `
  --display-name="GitHub Actions Deployment Account" --project=$PROJECT_ID

foreach ($role in @("roles/run.admin","roles/artifactregistry.writer","roles/firebase.admin","roles/secretmanager.secretAccessor","roles/iam.serviceAccountUser","roles/cloudbuild.builds.editor")) {
  gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:$SA_EMAIL" --role=$role
}

# Key file -> store securely, add contents as the GCP_SA_KEY GitHub Actions secret.
gcloud iam service-accounts keys create github-actions-key.json `
  --iam-account=$SA_EMAIL --project=$PROJECT_ID
```

## 7. GitHub Actions: secrets & variables

In the repo: **Settings → Secrets and variables → Actions**.

**Secrets** (sensitive):
- `GCP_SA_KEY` — contents of `github-actions-key.json` above.
- `ANTHROPIC_API_KEY` — for the AI code-review workflow (if not already set).

**Variables** (non-secret, inlined into the frontend build by Vite — see `deploy.yml`):
- `VITE_API_BASE` — the deployed Cloud Run URL (fill after the first backend deploy).
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET` — from Firebase console → Project settings → Your apps
  (register a Web app if you haven't). These are non-secret but project-specific.

## 8. Deploy

**Manual (PowerShell):**
```powershell
.\infra\deploy-backend.ps1     # build container -> Cloud Run (cost guards + secrets baked in)
# Then set VITE_API_BASE + VITE_FIREBASE_* in a local .env (copy .env.example), and:
.\infra\deploy-frontend.ps1    # build -> Firebase Hosting
```

**CI/CD:** `.github/workflows/deploy.yml` runs the same steps. It is `workflow_dispatch`
only until a manual deploy proves the wiring; then switch the trigger to `push: [main]`.

## 9. Verification

```powershell
gcloud run services describe dnd-session-backend --region=$REGION --format="value(status.url)"
Invoke-RestMethod "$URL/api/health"                       # -> { status = ok }
Invoke-RestMethod "$URL/api/stt-token?provider=soniox"    # -> 401 (no auth) — expected
gcloud secrets list --project=$PROJECT_ID
```

The `/api/stt-token` call returning 401 without a Firebase ID token is the auth gate
working as intended.

## 10. Monitoring & Alerting

`infra/monitoring.ps1` creates one email notification channel and three Cloud Monitoring
alert policies for `dnd-session-backend`, so failures are surfaced instead of discovered
mid-session. Requires the `alpha`/`beta` gcloud components:

```powershell
gcloud components install alpha beta
```

Edit `$ALERT_EMAIL` at the top of the script, then run it:

```powershell
.\infra\monitoring.ps1
```

It creates:

1. **Storage fallback (log-based)** — fires when `backend/storage.py` logs a Firestore
   fallback warning (ADC failure, ineligible credentials, Firestore outage/quota). Matches
   both `jsonPayload.message` and `textPayload`, since the backend currently logs via plain
   `logging.basicConfig` (text, not structured JSON) — see the script comments for the exact
   log lines matched.
2. **Error rate** — `run.googleapis.com/request_count` filtered to `response_code_class=5xx`,
   threshold >5 requests/min sustained for 2 consecutive minutes.
3. **Latency (lower priority)** — `run.googleapis.com/request_latencies` p95 > 2000ms for
   5 consecutive minutes. **Known limitation:** Cloud Run's built-in latency metric has no
   per-route label, so this alerts on the whole service's p95, not `/api/stt-token`
   specifically — see the script's comments for the caveat and a possible log-based-metric
   follow-up.

The script is **not idempotent** — re-running it creates new channel/policy resources rather
than updating existing ones. See the "Cleanup" comment block at the bottom of the script for
the list/delete commands to tear down and re-run cleanly.

### Verification

After running the script, confirm end-to-end delivery manually (this can't be automated from
a sandboxed environment without live GCP credentials):

```powershell
# Storage-fallback alert: deliberately misconfigure Firestore access (e.g. revoke the
# runtime SA's Firestore role, or point GCP_PROJECT at a project without a Firestore DB),
# hit any endpoint that touches storage, and confirm an email arrives within ~5 minutes.

# Error-rate alert: drive a burst of 5xx responses (e.g. loop a request against a route
# that errors, or restart with a broken secret so auth/storage calls fail) and confirm an
# email arrives within ~5 minutes.

gcloud alpha monitoring policies list --project=$PROJECT_ID --format="table(displayName,enabled)"
```

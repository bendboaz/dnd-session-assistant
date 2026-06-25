# GCP Setup Instructions

Setup for deploying the D&D Session Assistant to GCP. **Project id:** `dnd-session-assistant`.
**Region:** `europe-west1` (Cloud Run + Firestore). All commands are PowerShell (Windows).

> Status: the GCP project, billing, budget alerts, `gcloud`/`firebase` CLIs, Firebase Auth
> (Google provider), and the three Secret Manager secrets (`SONIOX_API_KEY`,
> `DEEPGRAM_API_KEY`, `ALLOWED_EMAILS`) are already set up. This doc documents the full
> path for reproducibility and lists the remaining provisioning steps.

```powershell
$PROJECT_ID = "dnd-session-assistant"
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
(`dnd-session-assistant.web.app` / `.firebaseapp.com`).

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

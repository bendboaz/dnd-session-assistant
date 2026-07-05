# Operations Runbook

Recovery procedures for infra-level incidents. Currently covers the billing killswitch
(see `infra/SETUP-GCP.md#11-billing-killswitch` for setup and `infra/killswitch/main.py`
for the implementation).

## Billing killswitch fired

### 1. Detect it

- **Budget alert email** from GCP Billing noting ≥90% of the $5 budget.
- **Function logs:**
  ```powershell
  gcloud functions logs read budget-killswitch --region=europe-west1 --project=dnd-session-assistant-52633 --limit=50
  ```
  A `max-instances set to 0` warning confirms the killswitch acted (as opposed to the
  alert firing below the 90% action threshold, which it logs but does not act on).
- **Cloud Run state:**
  ```powershell
  gcloud run services describe dnd-session-backend --region=europe-west1 --project=dnd-session-assistant-52633 | Select-String maxScale
  ```
  `maxScale: '0'` means the killswitch is currently engaged.
- **User-visible symptom:** in-flight requests finish normally, but once existing
  instances drain, new requests to `/api/*` start failing (no instance can start). The
  frontend itself (Firebase Hosting) is unaffected — only backend API calls fail.

### 2. Verify no data loss

The killswitch only calls the Cloud Run Admin API to change `max-instances`; it never
touches Firestore, Secret Manager, or the deployed container image/revision. To confirm:

- Firestore data is untouched — spot-check the most recent session documents in the
  Firebase console; nothing about scaling to zero can delete or corrupt them.
- Secret Manager access is untouched — secrets remain readable (Cloud Run being scaled
  to zero doesn't revoke any IAM bindings).
- The Cloud Run **revision** is unchanged; only its instance ceiling is. No redeploy or
  rollback is needed to restore service — see step 4.

### 3. Find and fix the root cause before restoring capacity

Restoring `--max-instances=2` without understanding why spend spiked just re-arms the
same failure. Before step 4:

- **GCP Billing → Reports**, broken down by SKU and time, to find what actually drove the
  cost (Cloud Run compute, Cloud Build, network egress, an STT provider key used outside
  this app, etc.). The killswitch tells you *that* spend crossed the threshold, not *why*.
- **Cloud Run request logs** for the window before the alert, looking for traffic
  anomalies (retry storms, a bot, a deploy loop):
  ```powershell
  gcloud run services logs read dnd-session-backend --region=europe-west1 --project=dnd-session-assistant-52633 --limit=200
  ```
- If a provider key leaked (Soniox/Deepgram), rotate it in Secret Manager **before**
  restoring traffic (see `infra/SETUP-GCP.md` §5) — otherwise the same leak keeps billing
  once instances can start again.

### 4. Restore service (target: under 5 minutes once the root cause is addressed)

```powershell
$GCP_PROJECT_ID = "dnd-session-assistant-52633"
$GCP_REGION = "europe-west1"

gcloud run services update dnd-session-backend `
    --max-instances 2 `
    --region $GCP_REGION `
    --project $GCP_PROJECT_ID
```

Confirm and smoke-test:

```powershell
gcloud run services describe dnd-session-backend --region=$GCP_REGION --project=$GCP_PROJECT_ID | Select-String maxScale
# -> maxScale: '2'

$URL = gcloud run services describe dnd-session-backend --region=$GCP_REGION --project=$GCP_PROJECT_ID --format="value(status.url)"
Invoke-RestMethod "$URL/api/health"   # -> { status = ok }
```

No other re-arming is needed — the Pub/Sub topic and Cloud Function stay wired for the
next event; the budget alert in the console doesn't need to be reset or re-triggered.

### 5. Post-incident

- If the killswitch fired due to a genuine cost runaway (not a manual test per
  `infra/SETUP-GCP.md`'s verification steps), consider whether `$MAX_INSTANCES` in
  `infra/deploy-backend.ps1` should be lowered further, or `ALLOWED_EMAILS` tightened,
  before declaring the incident closed.
- File a GitHub issue (or update an existing one) recording the root cause and fix —
  this repo tracks infra changes via GitHub Issues per the project `CLAUDE.md`.

## Notes / limitations

- The 90%-of-budget action threshold and target service name are baked into
  `infra/killswitch/main.py` via env vars set at deploy time
  (`infra/killswitch.ps1 --set-env-vars`). Changing them requires redeploying the
  function, not a live config edit.
- Only the softer "scale Cloud Run to zero" response is implemented. Disabling billing
  on the project entirely (the "nuclear" option raised in the originating issue) is
  intentionally not built — it would also cut off the ability to investigate via
  Firestore/Secret Manager, which defeats the point of having a recovery runbook at all.

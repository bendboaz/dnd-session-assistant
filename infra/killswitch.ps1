# D&D Session Assistant - Billing Killswitch Setup Script
# Wires a GCP budget alert -> Pub/Sub -> Cloud Function that scales dnd-session-backend
# to --max-instances=0 once spend crosses 90% of the budget. See infra/OPERATIONS.md for
# the recovery runbook.

# Configuration
$GCP_PROJECT_ID = "dnd-session-assistant-52633"
$GCP_REGION = "europe-west1"
$BACKEND_SERVICE_NAME = "dnd-session-backend"
$TOPIC_NAME = "budget-alert"
$FUNCTION_NAME = "budget-killswitch"
$FUNCTION_SA_NAME = "budget-killswitch-fn"
$FUNCTION_SA_EMAIL = "$FUNCTION_SA_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com"

# Ensure gcloud is authenticated
Write-Host "Authenticating with gcloud..."
gcloud auth login

# 1. Pub/Sub topic the budget alert publishes to.
Write-Host "Creating Pub/Sub topic '$TOPIC_NAME'..."
gcloud pubsub topics create $TOPIC_NAME --project $GCP_PROJECT_ID

if (-not $?) {
    Write-Warning "Topic create failed (may already exist) -- continuing."
}

# 2. Dedicated service account, scoped to this one Cloud Run service -- not the
# project-wide run.admin role -- so a compromised function can't touch anything else.
Write-Host "Creating service account '$FUNCTION_SA_EMAIL'..."
gcloud iam service-accounts create $FUNCTION_SA_NAME `
    --display-name="Budget killswitch Cloud Function" `
    --project $GCP_PROJECT_ID

if (-not $?) {
    Write-Warning "Service account create failed (may already exist) -- continuing."
}

Write-Host "Granting run.services.update on $BACKEND_SERVICE_NAME to $FUNCTION_SA_EMAIL..."
gcloud run services add-iam-policy-binding $BACKEND_SERVICE_NAME `
    --region $GCP_REGION `
    --member="serviceAccount:$FUNCTION_SA_EMAIL" `
    --role="roles/run.developer" `
    --project $GCP_PROJECT_ID

if (-not $?) {
    Write-Error "IAM binding failed"
    exit 1
}

# 3. Deploy the Cloud Function, triggered on the budget-alert topic.
Write-Host "Deploying Cloud Function '$FUNCTION_NAME'..."
gcloud functions deploy $FUNCTION_NAME `
    --gen2 `
    --runtime python312 `
    --region $GCP_REGION `
    --source infra/killswitch `
    --entry-point budget_killswitch `
    --trigger-topic $TOPIC_NAME `
    --service-account $FUNCTION_SA_EMAIL `
    --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,GCP_REGION=$GCP_REGION,BACKEND_SERVICE_NAME=$BACKEND_SERVICE_NAME" `
    --no-allow-unauthenticated `
    --project $GCP_PROJECT_ID

if ($?) {
    Write-Host "Killswitch function deployed."
    Write-Host ""
    Write-Host "MANUAL STEP STILL REQUIRED (no gcloud/API surface for this):"
    Write-Host "  GCP Billing console -> Budgets & alerts -> the `$5 budget -> Manage notifications"
    Write-Host "  -> Connect a Pub/Sub topic -> $TOPIC_NAME"
    Write-Host "  See infra/SETUP-GCP.md#billing-killswitch."
} else {
    Write-Error "Cloud Function deployment failed"
    exit 1
}

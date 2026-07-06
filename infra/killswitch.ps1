# D&D Session Assistant - Billing Killswitch Setup Script
# Wires a GCP budget alert -> Pub/Sub -> Cloud Function that revokes allUsers' public
# invoker access on dnd-session-backend once spend crosses 90% of the budget (Cloud Run
# then rejects new requests with 403 before any instance starts -- no new compute spend).
# See infra/OPERATIONS.md for the recovery runbook.

# Configuration
$GCP_PROJECT_ID = "dnd-session-assistant-52633"
$GCP_REGION = "europe-west1"
$BACKEND_SERVICE_NAME = "dnd-session-backend"
$TOPIC_NAME = "budget-alert"
$FUNCTION_NAME = "budget-killswitch"
$FUNCTION_SA_NAME = "budget-killswitch-fn"
$FUNCTION_SA_EMAIL = "$FUNCTION_SA_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com"
$INVOKER_TOGGLE_ROLE_ID = "budgetKillswitchInvokerToggle"

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

# A custom role with ONLY run.services.{get,set}IamPolicy -- narrower than any
# predefined role (roles/run.admin also grants delete/reconfigure on the service; there
# is no predefined role that grants IAM-policy management alone). The function only
# ever needs to flip one binding (allUsers/run.invoker), never touch scaling/revisions,
# so this is the actual minimum needed -- see infra/killswitch/main.py for why an
# earlier max-instances-based design was abandoned.
Write-Host "Creating custom role '$INVOKER_TOGGLE_ROLE_ID' (run.services.getIamPolicy + setIamPolicy)..."
gcloud iam roles create $INVOKER_TOGGLE_ROLE_ID `
    --project $GCP_PROJECT_ID `
    --title="Budget Killswitch Invoker Toggle" `
    --description="Minimum permissions to read/write IAM policy on one Cloud Run service (toggle public access)." `
    --permissions="run.services.getIamPolicy,run.services.setIamPolicy" `
    --stage=GA

if (-not $?) {
    Write-Warning "Custom role create failed (may already exist) -- continuing."
}

Write-Host "Granting $INVOKER_TOGGLE_ROLE_ID on $BACKEND_SERVICE_NAME to $FUNCTION_SA_EMAIL..."
gcloud run services add-iam-policy-binding $BACKEND_SERVICE_NAME `
    --region $GCP_REGION `
    --member="serviceAccount:$FUNCTION_SA_EMAIL" `
    --role="projects/$GCP_PROJECT_ID/roles/$INVOKER_TOGGLE_ROLE_ID" `
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

if (-not $?) {
    Write-Error "Cloud Function deployment failed"
    exit 1
}

# 4. Grant the trigger's service account permission to invoke the function's OWN
# backing Cloud Run service. This is separate from the invoker-toggle grant on
# dnd-session-backend above (step 2) -- that lets the function's code flip that
# service's IAM policy; this lets Eventarc's Pub/Sub push subscription invoke the
# function in the first place. Without it, every trigger delivery fails with
# "The request was not authenticated ... lacks {run.routes.invoke} permission"
# and Pub/Sub retries (briefly -- the trigger's retry policy is not indefinite)
# without the function ever running.
Write-Host "Granting run.invoker on $FUNCTION_NAME (its own backing service) to $FUNCTION_SA_EMAIL..."
gcloud run services add-iam-policy-binding $FUNCTION_NAME `
    --region $GCP_REGION `
    --member="serviceAccount:$FUNCTION_SA_EMAIL" `
    --role="roles/run.invoker" `
    --project $GCP_PROJECT_ID

if (-not $?) {
    Write-Error "run.invoker binding on the function's own service failed"
    exit 1
}

Write-Host "Killswitch function deployed."
Write-Host ""
Write-Host "MANUAL STEP STILL REQUIRED (no gcloud/API surface for this):"
Write-Host "  GCP Billing console -> Budgets & alerts -> the `$5 budget -> Manage notifications"
Write-Host "  -> Connect a Pub/Sub topic -> $TOPIC_NAME"
Write-Host "  See infra/SETUP-GCP.md#billing-killswitch."

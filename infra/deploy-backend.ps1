# D&D Session Assistant - Backend Deployment Script
# Deploy FastAPI backend to GCP Cloud Run

# Configuration
$GCP_PROJECT_ID = "dnd-session-assistant"
$GCP_REGION = "europe-west1"
$BACKEND_SERVICE_NAME = "dnd-session-backend"
$DOCKER_REPO = "docker-repo"

# Cost / abuse guards (see docs/DESIGN.md + the deploy plan).
$MAX_INSTANCES = 2     # Denial-of-Wallet backstop: caps compute spend under flood.
$CONCURRENCY  = 40     # Requests per instance; 2 instances still serve a table.

# CORS: the Firebase Hosting origins for this project (default domains).
$FRONTEND_ORIGINS = "https://dnd-session-assistant.web.app,https://dnd-session-assistant.firebaseapp.com"

# Secrets are mounted from Secret Manager as env vars (never baked into the image).
$SECRETS = "SONIOX_API_KEY=SONIOX_API_KEY:latest,DEEPGRAM_API_KEY=DEEPGRAM_API_KEY:latest,ALLOWED_EMAILS=ALLOWED_EMAILS:latest"

# Ensure gcloud is authenticated
Write-Host "Authenticating with gcloud..."
gcloud auth login

# Build and push container image
Write-Host "Building and pushing backend container image..."
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev"

$IMAGE_URL = "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$DOCKER_REPO/$BACKEND_SERVICE_NAME`:latest"

Write-Host "Building image: $IMAGE_URL"
gcloud builds submit `
    --tag $IMAGE_URL `
    backend/

if (-not $?) {
    Write-Error "Container build failed"
    exit 1
}

# Deploy to Cloud Run.
# --allow-unauthenticated keeps the URL public at the IAM layer; the app gates every
# paid route via Firebase Auth + the ALLOWED_EMAILS allowlist (see backend/auth.py).
Write-Host "Deploying to Cloud Run..."
gcloud run deploy $BACKEND_SERVICE_NAME `
    --image $IMAGE_URL `
    --region $GCP_REGION `
    --platform managed `
    --allow-unauthenticated `
    --max-instances $MAX_INSTANCES `
    --concurrency $CONCURRENCY `
    --set-secrets $SECRETS `
    --set-env-vars "GCP_PROJECT=$GCP_PROJECT_ID,ALLOWED_ORIGINS=$FRONTEND_ORIGINS,STT_TOKEN_TTL_SECONDS=300" `
    --project $GCP_PROJECT_ID

if ($?) {
    Write-Host "Backend deployment successful!"
    $SERVICE_URL = gcloud run services describe $BACKEND_SERVICE_NAME --region $GCP_REGION --format "value(status.url)" --project $GCP_PROJECT_ID
    Write-Host "Service URL: $SERVICE_URL"
} else {
    Write-Error "Cloud Run deployment failed"
    exit 1
}

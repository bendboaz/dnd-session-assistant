# D&D Session Assistant - Backend Deployment Script
# Deploy FastAPI backend to GCP Cloud Run

# Configuration
$GCP_PROJECT_ID = "YOUR_GCP_PROJECT_ID"
$GCP_REGION = "us-central1"
$BACKEND_SERVICE_NAME = "dnd-session-backend"
$DOCKER_REPO = "docker-repo"

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

# Deploy to Cloud Run
Write-Host "Deploying to Cloud Run..."
gcloud run deploy $BACKEND_SERVICE_NAME `
    --image $IMAGE_URL `
    --region $GCP_REGION `
    --platform managed `
    --allow-unauthenticated `
    --project $GCP_PROJECT_ID

if ($?) {
    Write-Host "Backend deployment successful!"
    $SERVICE_URL = gcloud run services describe $BACKEND_SERVICE_NAME --region $GCP_REGION --format "value(status.url)" --project $GCP_PROJECT_ID
    Write-Host "Service URL: $SERVICE_URL"
} else {
    Write-Error "Cloud Run deployment failed"
    exit 1
}

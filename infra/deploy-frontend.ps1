# D&D Session Assistant - Frontend Deployment Script
# Deploy Vite + React frontend to Firebase Hosting

# Configuration
$GCP_PROJECT_ID = "YOUR_GCP_PROJECT_ID"

# Ensure gcloud is authenticated
Write-Host "Authenticating with gcloud..."
gcloud auth login

# Check for build directory
if (-not (Test-Path "dist")) {
    Write-Host "Building frontend..."
    npm ci
    npm run build
} else {
    Write-Host "dist/ directory found, skipping build"
}

# Deploy to Firebase Hosting
Write-Host "Deploying to Firebase Hosting..."
npm install -g firebase-tools

$ACCESS_TOKEN = gcloud auth application-default print-access-token
firebase deploy --project $GCP_PROJECT_ID --token $ACCESS_TOKEN

if ($?) {
    Write-Host "Frontend deployment successful!"
} else {
    Write-Error "Firebase deployment failed"
    exit 1
}

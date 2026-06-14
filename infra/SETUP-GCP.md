# GCP Setup Instructions

This document outlines the steps to set up GCP infrastructure for the D&D Session Assistant project.

## Prerequisites

### Install gcloud CLI

The `gcloud` command-line tool is not yet installed on this machine. Download and install it from:
https://cloud.google.com/sdk/docs/install

After installation, initialize gcloud:
```powershell
gcloud init
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID
```

## Enable Required APIs

Run the following commands to enable necessary GCP APIs:

```powershell
$PROJECT_ID = "YOUR_GCP_PROJECT_ID"

# Enable Cloud Run
gcloud services enable run.googleapis.com --project=$PROJECT_ID

# Enable Artifact Registry
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID

# Enable Firestore
gcloud services enable firestore.googleapis.com --project=$PROJECT_ID

# Enable Secret Manager
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID

# Enable Cloud Build
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
```

## Create Artifact Registry Repository

```powershell
$PROJECT_ID = "YOUR_GCP_PROJECT_ID"
$REGION = "us-central1"

gcloud artifacts repositories create docker-repo `
  --repository-format=docker `
  --location=$REGION `
  --project=$PROJECT_ID `
  --description="Docker repository for D&D Session Assistant"
```

## Create and Configure Secrets

### Create Speech-to-Text API Secret (Soniox)

```powershell
$PROJECT_ID = "YOUR_GCP_PROJECT_ID"

# Create the secret
echo "YOUR_SONIOX_API_KEY" | gcloud secrets create SONIOX_API_KEY `
  --data-file=- `
  --project=$PROJECT_ID

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding SONIOX_API_KEY `
  --member=serviceAccount:YOUR_CLOUD_RUN_SA@$PROJECT_ID.iam.gserviceaccount.com `
  --role=roles/secretmanager.secretAccessor `
  --project=$PROJECT_ID
```

### Create Speech-to-Text API Secret (Deepgram)

```powershell
$PROJECT_ID = "YOUR_GCP_PROJECT_ID"

# Create the secret
echo "YOUR_DEEPGRAM_API_KEY" | gcloud secrets create DEEPGRAM_API_KEY `
  --data-file=- `
  --project=$PROJECT_ID

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding DEEPGRAM_API_KEY `
  --member=serviceAccount:YOUR_CLOUD_RUN_SA@$PROJECT_ID.iam.gserviceaccount.com `
  --role=roles/secretmanager.secretAccessor `
  --project=$PROJECT_ID
```

## Create Service Account for GitHub Actions Deployment

Create a service account with permissions to deploy:

```powershell
$PROJECT_ID = "YOUR_GCP_PROJECT_ID"
$SA_NAME = "github-actions"
$SA_EMAIL = "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# Create the service account
gcloud iam service-accounts create $SA_NAME `
  --display-name="GitHub Actions Deployment Account" `
  --project=$PROJECT_ID

# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member=serviceAccount:$SA_EMAIL `
  --role=roles/run.admin

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member=serviceAccount:$SA_EMAIL `
  --role=roles/artifactregistry.writer

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member=serviceAccount:$SA_EMAIL `
  --role=roles/firebase.admin

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member=serviceAccount:$SA_EMAIL `
  --role=roles/secretmanager.secretAccessor

# Download and save the service account key
gcloud iam service-accounts keys create github-actions-key.json `
  --iam-account=$SA_EMAIL `
  --project=$PROJECT_ID

# Store this file securely and add its contents as the GCP_SA_KEY secret in GitHub
```

## Initialize Firestore Database

```powershell
$PROJECT_ID = "YOUR_GCP_PROJECT_ID"

gcloud firestore databases create `
  --location=us-central1 `
  --type=firestore-native `
  --project=$PROJECT_ID
```

## GitHub Actions Secrets

Add the following secrets to your GitHub repository. Go to **Settings** → **Secrets and variables** → **Actions**.

### Required Secrets

1. **ANTHROPIC_API_KEY**
   - Description: Anthropic API key for AI code reviews
   - Value: Your Anthropic API key (see https://console.anthropic.com)

2. **GCP_SA_KEY**
   - Description: GCP service account JSON key for deployments
   - Value: Contents of `github-actions-key.json` created above

### Optional Configuration Secrets (if you prefer to override defaults)

3. **GCP_PROJECT_ID** (optional; see `.github/workflows/deploy.yml` for default)
   - Your GCP project ID

4. **GCP_REGION** (optional; see `.github/workflows/deploy.yml` for default)
   - Default: `us-central1`

5. **BACKEND_SERVICE_NAME** (optional; see `.github/workflows/deploy.yml` for default)
   - Default: `dnd-session-backend`

## Verification

After setup, verify everything is working:

```powershell
# Test gcloud authentication
gcloud auth list

# List enabled APIs
gcloud services list --enabled --project=$PROJECT_ID

# List secrets
gcloud secrets list --project=$PROJECT_ID

# List service accounts
gcloud iam service-accounts list --project=$PROJECT_ID
```

## Deploy Manually (without GitHub)

Use the PowerShell scripts in the `infra/` directory:

```powershell
# Deploy backend
.\infra\deploy-backend.ps1

# Deploy frontend
.\infra\deploy-frontend.ps1
```

Make sure to update the configuration variables at the top of each script with your project details.

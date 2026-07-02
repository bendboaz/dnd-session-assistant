# D&D Session Assistant - Cloud Monitoring Alert Policies
#
# Infrastructure-as-code for the three alert policies described in
# docs/DESIGN.md-adjacent issue #49: storage fallback (log-based), backend
# error rate, and /api/stt-token latency. All three share one email
# notification channel. Re-running this script creates NEW resources each
# time (channel + policies) -- it does not check for/update existing ones,
# matching the style of the other infra/*.ps1 scripts. If you're re-running
# after a partial failure, delete the half-created channel/policies first
# (see "Cleanup" at the bottom) or you'll end up with duplicates.
#
# Requires the `alpha` and `beta` gcloud components:
#   gcloud components install alpha beta

# Configuration
$GCP_PROJECT_ID       = "dnd-session-assistant-52633"
$GCP_REGION           = "europe-west1"
$BACKEND_SERVICE_NAME = "dnd-session-backend"

# Email that receives alerts. Fill this in before running (project owner's address).
$ALERT_EMAIL = "REPLACE_ME@example.com"

if ($ALERT_EMAIL -eq "REPLACE_ME@example.com") {
    Write-Error "Set `$ALERT_EMAIL to a real address before running this script."
    exit 1
}

# ---------------------------------------------------------------------------
# Step 1: Notification channel (email), reused by all three policies below.
# ---------------------------------------------------------------------------
Write-Host "Creating email notification channel..."
$CHANNEL_NAME = gcloud beta monitoring channels create `
    --project=$GCP_PROJECT_ID `
    --display-name="dnd-session-backend alerts" `
    --description="Email channel for dnd-session-backend Cloud Monitoring alerts" `
    --type=email `
    --channel-labels=email_address=$ALERT_EMAIL `
    --format="value(name)"

if (-not $? -or [string]::IsNullOrWhiteSpace($CHANNEL_NAME)) {
    Write-Error "Failed to create notification channel"
    exit 1
}
Write-Host "Notification channel: $CHANNEL_NAME"

# ---------------------------------------------------------------------------
# Step 2: Log-based alert - Firestore storage fallback (backend/storage.py).
#
# storage.py logs a WARNING via the stdlib `logging` module (plain
# `logging.basicConfig`, not structured JSON), so Cloud Run/Cloud Logging
# ingests these lines as `textPayload`, not `jsonPayload`. The filter below
# matches BOTH shapes so the alert keeps working if the backend later moves
# to structured JSON logging. It matches the two fallback log lines emitted
# by `init_storage()`:
#   - "Firestore unavailable (...); falling back to local JSONL storage."
#   - "No Firestore credentials configured; using local JSONL storage at ..."
# (The issue's shorthand filter text "storage fallback" doesn't appear
# verbatim in either message -- this regex targets the actual log text.)
# ---------------------------------------------------------------------------
$storageFallbackFilter = 'resource.type="cloud_run_revision" resource.labels.service_name="' + $BACKEND_SERVICE_NAME + '" (jsonPayload.message=~"(?i)(falling back to local jsonl storage|no firestore credentials configured)" OR textPayload=~"(?i)(falling back to local jsonl storage|no firestore credentials configured)")'

$storageFallbackPolicy = @"
displayName: "$BACKEND_SERVICE_NAME: storage fallback detected"
combiner: OR
conditions:
  - displayName: "Firestore fallback log entry (storage.py)"
    conditionMatchedLog:
      filter: |-
        $storageFallbackFilter
notificationChannels:
  - "$CHANNEL_NAME"
alertStrategy:
  notificationRateLimit:
    period: 300s
"@

$storageFallbackFile = "$env:TEMP\dnd-alert-storage-fallback.yaml"
$storageFallbackPolicy | Set-Content -Path $storageFallbackFile -Encoding utf8

Write-Host "Creating storage-fallback log-based alert policy..."
gcloud alpha monitoring policies create `
    --project=$GCP_PROJECT_ID `
    --policy-from-file=$storageFallbackFile

if (-not $?) {
    Write-Error "Failed to create storage-fallback alert policy"
    exit 1
}
Remove-Item $storageFallbackFile -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Step 3: Error-rate alert - >5 5xx responses/min for 2 consecutive minutes.
#
# run.googleapis.com/request_count is a DELTA/INT64 metric. ALIGN_RATE
# converts it to a per-second rate, so ">5 requests/min" becomes a threshold
# of 5/60 requests/sec over a 60s alignment period, sustained for 120s (2
# consecutive 1-minute samples).
# ---------------------------------------------------------------------------
$errorRateFilter = 'resource.type="cloud_run_revision" resource.labels.service_name="' + $BACKEND_SERVICE_NAME + '" metric.type="run.googleapis.com/request_count" metric.labels.response_code_class="5xx"'

$errorRatePolicy = @"
displayName: "$BACKEND_SERVICE_NAME: elevated 5xx error rate"
combiner: OR
conditions:
  - displayName: ">5 5xx requests/min for 2 min"
    conditionThreshold:
      filter: |-
        $errorRateFilter
      comparison: COMPARISON_GT
      thresholdValue: 0.0834
      duration: 120s
      aggregations:
        - alignmentPeriod: 60s
          perSeriesAligner: ALIGN_RATE
          crossSeriesReducer: REDUCE_SUM
          groupByFields:
            - resource.label.service_name
notificationChannels:
  - "$CHANNEL_NAME"
alertStrategy:
  notificationRateLimit:
    period: 300s
"@

$errorRateFile = "$env:TEMP\dnd-alert-error-rate.yaml"
$errorRatePolicy | Set-Content -Path $errorRateFile -Encoding utf8

Write-Host "Creating error-rate alert policy..."
gcloud alpha monitoring policies create `
    --project=$GCP_PROJECT_ID `
    --policy-from-file=$errorRateFile

if (-not $?) {
    Write-Error "Failed to create error-rate alert policy"
    exit 1
}
Remove-Item $errorRateFile -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Step 4: Latency alert (lower priority) - p95 request latency > 2000ms for
# 5 consecutive minutes.
#
# KNOWN LIMITATION: Cloud Run's built-in run.googleapis.com/request_latencies
# metric has no per-route/path label (only response_code / response_code_class),
# so this cannot be scoped to /api/stt-token specifically via the built-in
# metric -- it alerts on the whole dnd-session-backend service's p95 latency.
# In practice /api/stt-token is the dominant call during a live session, so a
# service-wide p95 spike is a reasonable proxy. For true per-route latency,
# a log-based distribution metric would need to be built from the Cloud Run
# request logs' `httpRequest.requestUrl` + `httpRequest.latency` fields
# (gcloud logging metrics create --value-extractor=...) -- left as a
# follow-up if path-level precision becomes necessary.
# ---------------------------------------------------------------------------
$latencyFilter = 'resource.type="cloud_run_revision" resource.labels.service_name="' + $BACKEND_SERVICE_NAME + '" metric.type="run.googleapis.com/request_latencies"'

$latencyPolicy = @"
displayName: "$BACKEND_SERVICE_NAME: p95 latency high (service-wide)"
combiner: OR
conditions:
  - displayName: "p95 latency > 2000ms for 5 min"
    conditionThreshold:
      filter: |-
        $latencyFilter
      comparison: COMPARISON_GT
      thresholdValue: 2000
      duration: 300s
      aggregations:
        - alignmentPeriod: 60s
          perSeriesAligner: ALIGN_PERCENTILE_95
          crossSeriesReducer: REDUCE_MEAN
          groupByFields:
            - resource.label.service_name
notificationChannels:
  - "$CHANNEL_NAME"
alertStrategy:
  notificationRateLimit:
    period: 300s
"@

$latencyFile = "$env:TEMP\dnd-alert-latency.yaml"
$latencyPolicy | Set-Content -Path $latencyFile -Encoding utf8

Write-Host "Creating latency alert policy..."
gcloud alpha monitoring policies create `
    --project=$GCP_PROJECT_ID `
    --policy-from-file=$latencyFile

if (-not $?) {
    Write-Error "Failed to create latency alert policy"
    exit 1
}
Remove-Item $latencyFile -Force -ErrorAction SilentlyContinue

Write-Host "Done. Review policies at:"
Write-Host "https://console.cloud.google.com/monitoring/alerting/policies?project=$GCP_PROJECT_ID"

# ---------------------------------------------------------------------------
# Cleanup (manual): to tear down and re-run from scratch:
#   gcloud alpha monitoring policies list --project=$GCP_PROJECT_ID --format="value(name,displayName)"
#   gcloud alpha monitoring policies delete POLICY_NAME --project=$GCP_PROJECT_ID
#   gcloud beta monitoring channels list --project=$GCP_PROJECT_ID --format="value(name,displayName)"
#   gcloud beta monitoring channels delete CHANNEL_NAME --project=$GCP_PROJECT_ID
# ---------------------------------------------------------------------------

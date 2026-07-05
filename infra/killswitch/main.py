"""Budget killswitch Cloud Function.

Triggered by GCP budget alerts published to the `budget-alert` Pub/Sub topic (the
budget -> topic link is a manual console step -- see infra/SETUP-GCP.md#billing-killswitch).
When spend crosses the action threshold, this scales `dnd-session-backend` on Cloud Run
to `--max-instances=0`. That stops new requests (and therefore new compute spend) while
leaving Firestore/Secret Manager reachable so a human can investigate without racing the
meter. This is the softer of the two options the originating issue considered; disabling
project billing entirely ("nuclear") is intentionally not implemented here.

Budget alert message shape (published by GCP Billing -- see
https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications):
    {
      "budgetDisplayName": str,
      "costAmount": float,
      "budgetAmount": float,
      "alertThresholdExceeded": float,   # e.g. 0.9 for a 90% threshold rule
      "currencyCode": str,
      ...
    }

`budgetAmount` is optional in practice (a budget can track "last month's spend" instead
of a fixed amount), so it's backed by an env var default -- see BUDGET_ALERT_THRESHOLD_USD
below -- rather than being required on every message.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

import functions_framework
from cloudevents.http import CloudEvent
from google.cloud import run_v2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("budget-killswitch")

# Deploy-time configuration (see infra/killswitch.ps1 --set-env-vars).
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "dnd-session-assistant-52633")
GCP_REGION = os.getenv("GCP_REGION", "europe-west1")
BACKEND_SERVICE_NAME = os.getenv("BACKEND_SERVICE_NAME", "dnd-session-backend")

# Falls back to the $5 budget documented in infra/SETUP-GCP.md when the alert message
# itself doesn't carry a budgetAmount (some budget types track relative spend, not a
# fixed dollar figure).
BUDGET_ALERT_THRESHOLD_USD = float(os.getenv("BUDGET_ALERT_THRESHOLD_USD", "5.0"))

# We act at 90% regardless of which alert rule (50%/90%/100%) actually fired -- the
# issue's acceptance criteria hinge on this specific fraction.
ACTION_FRACTION = 0.9


@functions_framework.cloud_event
def budget_killswitch(cloud_event: CloudEvent) -> None:
    """Entry point registered via `--entry-point budget_killswitch` in killswitch.ps1."""
    message = _decode_pubsub_message(cloud_event)
    if message is None:
        logger.warning("Received Pub/Sub message with no decodable data; ignoring.")
        return

    cost_amount = _as_float(message.get("costAmount"))
    if cost_amount is None:
        logger.warning("Budget alert message missing costAmount: %s", message)
        return

    budget_amount = _as_float(message.get("budgetAmount")) or BUDGET_ALERT_THRESHOLD_USD
    threshold = budget_amount * ACTION_FRACTION

    logger.info(
        "Budget alert: cost=%.2f budget=%.2f action_threshold(%.0f%%)=%.2f",
        cost_amount,
        budget_amount,
        ACTION_FRACTION * 100,
        threshold,
    )

    if cost_amount < threshold:
        logger.info("Cost below action threshold; no action taken.")
        return

    logger.warning(
        "Cost %.2f >= %.0f%% of budget %.2f -- scaling %s to max-instances=0.",
        cost_amount,
        ACTION_FRACTION * 100,
        budget_amount,
        BACKEND_SERVICE_NAME,
    )
    _scale_to_zero()


def _decode_pubsub_message(cloud_event: CloudEvent) -> dict[str, Any] | None:
    data = cloud_event.data or {}
    encoded = data.get("message", {}).get("data")
    if not encoded:
        return None
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
        return json.loads(decoded)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.error("Failed to decode Pub/Sub message data: %s", exc)
        return None


def _as_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _scale_to_zero() -> None:
    """Sets Cloud Run `--max-instances=0` via the Admin API (run.services.update).

    Requires the function's runtime service account to hold `run.services.update` on
    `BACKEND_SERVICE_NAME` -- granted narrowly (not project-wide run.admin) by
    infra/killswitch.ps1. See infra/OPERATIONS.md for the recovery path.
    """
    client = run_v2.ServicesClient()
    service_path = client.service_path(GCP_PROJECT_ID, GCP_REGION, BACKEND_SERVICE_NAME)

    service = client.get_service(name=service_path)
    service.template.scaling.max_instance_count = 0

    operation = client.update_service(service=service)
    operation.result()  # block until the new revision (max-instances=0) is live
    logger.warning("%s max-instances set to 0.", BACKEND_SERVICE_NAME)

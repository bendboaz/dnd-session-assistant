"""Budget killswitch Cloud Function.

Triggered by GCP budget alerts published to the `budget-alert` Pub/Sub topic (the
budget -> topic link is a manual console step -- see infra/SETUP-GCP.md#billing-killswitch).
When spend crosses the action threshold, this revokes `allUsers`' `roles/run.invoker`
binding on `dnd-session-backend`, so Cloud Run rejects new requests with 403 before any
instance starts (no new compute spend) while leaving Firestore/Secret Manager reachable
so a human can investigate without racing the meter. This is the softer of the two
options the originating issue considered; disabling project billing entirely ("nuclear")
is intentionally not implemented here.

Earlier versions of this function tried to achieve the same goal via
`service.template.scaling.max_instance_count = 0` (Cloud Run Admin API). That does NOT
work: per https://docs.cloud.google.com/run/docs/configuring/max-instances,
service-level `max-instances=0` means "no cap" (unlimited), not "stopped" -- confirmed
live, where it silently *removed* the instance ceiling instead of applying one. Revoking
public invoker access is also simpler operationally: it's a pure IAM policy change (no
new revision), so it applies instantly and needs only
`run.services.{get,set}IamPolicy` -- see the custom role in infra/killswitch.ps1.

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
        "Cost %.2f >= %.0f%% of budget %.2f -- revoking public access to %s.",
        cost_amount,
        ACTION_FRACTION * 100,
        budget_amount,
        BACKEND_SERVICE_NAME,
    )
    _revoke_public_invoker()


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


def _revoke_public_invoker() -> None:
    """Revokes `allUsers`' `roles/run.invoker` binding on `BACKEND_SERVICE_NAME`.

    This is a pure IAM policy change -- no new revision is created, so it applies
    instantly and needs only `run.services.getIamPolicy` / `run.services.setIamPolicy`
    (granted via the custom role in infra/killswitch.ps1, not project-wide `run.admin`).
    Recovery (re-granting the binding) is a manual human step -- see
    infra/OPERATIONS.md -- this function only ever removes access, never restores it.
    """
    client = run_v2.ServicesClient()
    service_path = client.service_path(GCP_PROJECT_ID, GCP_REGION, BACKEND_SERVICE_NAME)

    policy = client.get_iam_policy(request={"resource": service_path})

    revoked = False
    for binding in policy.bindings:
        if binding.role == "roles/run.invoker" and "allUsers" in binding.members:
            binding.members.remove("allUsers")
            revoked = True

    if not revoked:
        logger.warning(
            "%s had no allUsers/run.invoker binding to revoke -- already blocked, "
            "or was never public.",
            BACKEND_SERVICE_NAME,
        )
        return

    client.set_iam_policy(request={"resource": service_path, "policy": policy})
    logger.warning("Revoked public (allUsers) invoker access on %s.", BACKEND_SERVICE_NAME)

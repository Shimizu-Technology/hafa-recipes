"""Fail closed when an AWS account cannot use CloudFront's Free pricing plan."""

from __future__ import annotations

import json
from typing import Any, Protocol

import boto3
from botocore.exceptions import ClientError

MAX_FREE_CLOUDFRONT_PLANS = 3
COUNTED_SUBSCRIPTION_STATUSES = {"PENDING_APPROVAL", "ACTIVE", "SYNC_IN_PROGRESS"}


class FreeTierClient(Protocol):
    """Subset of the AWS Free Tier client required by the preflight."""

    def get_account_plan_state(self) -> dict[str, Any]: ...


class PricingPlanClient(Protocol):
    """Subset of Pricing Plan Manager required by the preflight."""

    def list_subscriptions(self, **kwargs: str) -> dict[str, Any]: ...


def _account_plan_type(client: FreeTierClient) -> str:
    """Return the new account-plan type, or LEGACY when the API has no record."""

    try:
        response = client.get_account_plan_state()
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            return "LEGACY"
        raise
    plan_type = response.get("accountPlanType")
    if plan_type not in {"FREE", "PAID"}:
        raise RuntimeError("AWS Free Tier returned an unknown account plan type")
    return str(plan_type)


def _cloudfront_free_plan_count(client: PricingPlanClient) -> int:
    """Count current CloudFront Free plans across every response page."""

    count = 0
    next_token: str | None = None
    while True:
        response = client.list_subscriptions(**({"nextToken": next_token} if next_token else {}))
        count += sum(
            1
            for subscription in response.get("subscriptionSummaries", [])
            if subscription.get("planFamily") == "CloudFront"
            and subscription.get("planTier") == "FREE"
            and subscription.get("status") in COUNTED_SUBSCRIPTION_STATUSES
        )
        next_token = response.get("nextToken")
        if not next_token:
            return count


def check_pricing_plan_eligibility(
    free_tier_client: FreeTierClient,
    pricing_plan_client: PricingPlanClient,
) -> dict[str, Any]:
    """Return safe eligibility evidence and reject unsupported account state."""

    account_plan_type = _account_plan_type(free_tier_client)
    free_plan_count = _cloudfront_free_plan_count(pricing_plan_client)
    eligible = (
        account_plan_type != "FREE" and free_plan_count < MAX_FREE_CLOUDFRONT_PLANS
    )
    return {
        "eligible": eligible,
        "account_plan_type": account_plan_type,
        "cloudfront_free_plan_count": free_plan_count,
        "cloudfront_free_plan_limit": MAX_FREE_CLOUDFRONT_PLANS,
    }


def main() -> None:
    """Print privacy-safe evidence and exit unsuccessfully when ineligible."""

    result = check_pricing_plan_eligibility(
        boto3.client("freetier", region_name="us-east-1"),
        boto3.client("pricing-plan-manager", region_name="us-east-1"),
    )
    print(json.dumps(result, sort_keys=True))
    if not result["eligible"]:
        raise SystemExit("AWS account is not eligible for another CloudFront Free plan")


if __name__ == "__main__":
    main()

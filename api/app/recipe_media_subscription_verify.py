"""Verify a CloudFront pricing subscription within a strict time budget."""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Collection
from typing import Any, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    ConnectionClosedError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)

AWS_API_CONFIG = Config(
    connect_timeout=5,
    read_timeout=10,
    retries={"total_max_attempts": 1, "mode": "standard"},
)
RETRYABLE_ERROR_CODES = {
    "InternalFailure",
    "InternalServerError",
    "RequestTimeout",
    "RequestTimeoutException",
    "ServiceUnavailable",
    "ServiceUnavailableException",
    "Throttling",
    "ThrottlingException",
    "TooManyRequestsException",
}
RETRYABLE_CONNECTION_ERRORS = (
    ConnectionClosedError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)
TIMEOUT_MESSAGE = "pricing subscription did not become ACTIVE within 5 minutes"


class PricingPlanClient(Protocol):
    """Subset of Pricing Plan Manager used by the verifier."""

    def get_subscription(self, *, arn: str) -> dict[str, Any]: ...


def _is_retryable_error(exc: Exception) -> bool:
    """Return whether a transient AWS failure is safe to retry within the deadline."""

    if isinstance(exc, RETRYABLE_CONNECTION_ERRORS):
        return True
    if not isinstance(exc, ClientError):
        return False
    error = exc.response.get("Error", {})
    status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return error.get("Code") in RETRYABLE_ERROR_CODES or (isinstance(status, int) and status >= 500)


def wait_for_active_subscription(
    client: PricingPlanClient,
    *,
    subscription_arn: str,
    expected_resource_arns: Collection[str],
    timeout_seconds: float = 300,
    poll_interval_seconds: float = 10,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Wait for ACTIVE and require the exact expected resources before returning."""

    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive")
    if poll_interval_seconds <= 0:
        raise ValueError("poll_interval_seconds must be positive")

    expected_resources = set(expected_resource_arns)
    deadline = monotonic() + timeout_seconds
    while True:
        if monotonic() >= deadline:
            raise TimeoutError(TIMEOUT_MESSAGE)
        try:
            subscription = client.get_subscription(arn=subscription_arn)["subscription"]
        except Exception as exc:
            if not _is_retryable_error(exc):
                raise
            checked_at = monotonic()
            if checked_at >= deadline:
                raise TimeoutError(TIMEOUT_MESSAGE) from exc
            sleep(min(poll_interval_seconds, deadline - checked_at))
            continue

        status = subscription.get("status")
        if status == "FAILED":
            raise RuntimeError("pricing subscription entered FAILED status")
        checked_at = monotonic()
        if checked_at >= deadline:
            raise TimeoutError(TIMEOUT_MESSAGE)
        if status == "ACTIVE":
            if set(subscription.get("resourceArns", [])) != expected_resources:
                raise RuntimeError("pricing subscription resource ARNs do not match the stack")
            return subscription
        sleep(min(poll_interval_seconds, deadline - checked_at))


def _parse_args() -> argparse.Namespace:
    """Parse the stack identifiers required for post-update verification."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subscription-arn", required=True)
    parser.add_argument("--distribution-id", required=True)
    parser.add_argument("--web-acl-arn", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=300)
    return parser.parse_args()


def main() -> None:
    """Verify the deployed subscription and print privacy-safe evidence."""

    args = _parse_args()
    sts = boto3.client("sts", region_name="us-east-1", config=AWS_API_CONFIG)
    account_id = sts.get_caller_identity()["Account"]
    distribution_arn = f"arn:aws:cloudfront::{account_id}:distribution/{args.distribution_id}"
    pricing = boto3.client(
        "pricing-plan-manager",
        region_name="us-east-1",
        config=AWS_API_CONFIG,
    )
    subscription = wait_for_active_subscription(
        pricing,
        subscription_arn=args.subscription_arn,
        expected_resource_arns={distribution_arn, args.web_acl_arn},
        timeout_seconds=args.timeout_seconds,
    )
    print(
        json.dumps(
            {
                "resource_arns": sorted(subscription["resourceArns"]),
                "status": subscription["status"],
                "subscription_arn": args.subscription_arn,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

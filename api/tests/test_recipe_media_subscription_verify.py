from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.recipe_media_subscription_verify import (
    TIMEOUT_MESSAGE,
    wait_for_active_subscription,
)

SUBSCRIPTION_ARN = "arn:aws:pricingplanmanager::123456789012:subscription:sub_test"
EXPECTED_RESOURCES = {
    "arn:aws:cloudfront::123456789012:distribution/E123",
    "arn:aws:wafv2:us-east-1:123456789012:global/webacl/test/abc",
}


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class FakePricingPlanClient:
    def __init__(
        self,
        responses: list[dict[str, Any] | Exception],
        *,
        clock: FakeClock | None = None,
        call_duration: float = 0,
    ) -> None:
        self.responses = responses
        self.clock = clock
        self.call_duration = call_duration
        self.calls = 0

    def get_subscription(self, *, arn: str) -> dict[str, Any]:
        assert arn == SUBSCRIPTION_ARN
        self.calls += 1
        if self.clock is not None:
            self.clock.now += self.call_duration
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _response(status: str, resources: set[str] = EXPECTED_RESOURCES) -> dict[str, Any]:
    return {"subscription": {"status": status, "resourceArns": list(resources)}}


def _wait(
    client: FakePricingPlanClient,
    clock: FakeClock,
    *,
    timeout_seconds: float = 5,
) -> dict[str, Any]:
    return wait_for_active_subscription(
        client,
        subscription_arn=SUBSCRIPTION_ARN,
        expected_resource_arns=EXPECTED_RESOURCES,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=2,
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )


def test_returns_only_active_subscription_with_exact_resources() -> None:
    clock = FakeClock()
    client = FakePricingPlanClient([_response("ACTIVE")])

    subscription = _wait(client, clock)

    assert subscription["status"] == "ACTIVE"
    assert client.calls == 1
    assert clock.sleeps == []


def test_retries_transient_connection_error_within_deadline() -> None:
    clock = FakeClock()
    client = FakePricingPlanClient(
        [EndpointConnectionError(endpoint_url="https://example.test"), _response("ACTIVE")]
    )

    subscription = _wait(client, clock)

    assert subscription["status"] == "ACTIVE"
    assert client.calls == 2
    assert clock.sleeps == [2]


def test_non_retryable_client_error_propagates_immediately() -> None:
    clock = FakeClock()
    error = ClientError(
        {
            "Error": {"Code": "AccessDeniedException", "Message": "denied"},
            "ResponseMetadata": {"HTTPStatusCode": 403},
        },
        "GetSubscription",
    )
    client = FakePricingPlanClient([error])

    with pytest.raises(ClientError, match="AccessDeniedException"):
        _wait(client, clock)

    assert client.calls == 1
    assert clock.sleeps == []


def test_failed_subscription_stops_without_retry() -> None:
    clock = FakeClock()
    client = FakePricingPlanClient([_response("FAILED")])

    with pytest.raises(RuntimeError, match="entered FAILED status"):
        _wait(client, clock)

    assert client.calls == 1


def test_active_response_after_deadline_is_rejected() -> None:
    clock = FakeClock()
    client = FakePricingPlanClient(
        [_response("ACTIVE")],
        clock=clock,
        call_duration=5,
    )

    with pytest.raises(TimeoutError, match=TIMEOUT_MESSAGE):
        _wait(client, clock)


def test_transient_error_consuming_deadline_raises_timeout() -> None:
    clock = FakeClock()
    client = FakePricingPlanClient(
        [EndpointConnectionError(endpoint_url="https://example.test")],
        clock=clock,
        call_duration=5,
    )

    with pytest.raises(TimeoutError, match=TIMEOUT_MESSAGE):
        _wait(client, clock)


def test_active_subscription_with_wrong_resources_is_rejected() -> None:
    clock = FakeClock()
    client = FakePricingPlanClient([_response("ACTIVE", {"unexpected"})])

    with pytest.raises(RuntimeError, match="resource ARNs do not match"):
        _wait(client, clock)

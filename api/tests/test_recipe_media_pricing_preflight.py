from typing import Any

from botocore.exceptions import ClientError

from app.recipe_media_pricing_preflight import check_pricing_plan_eligibility


class FakeFreeTierClient:
    def __init__(self, plan_type: str | None) -> None:
        self.plan_type = plan_type

    def get_account_plan_state(self) -> dict[str, Any]:
        if self.plan_type is None:
            raise ClientError(
                {"Error": {"Code": "ResourceNotFoundException", "Message": "missing"}},
                "GetAccountPlanState",
            )
        return {"accountPlanType": self.plan_type}


class FakePricingPlanClient:
    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages
        self.calls = 0

    def list_subscriptions(self, **kwargs: str) -> dict[str, Any]:
        expected_token = None if self.calls == 0 else "next-page"
        assert kwargs.get("nextToken") == expected_token
        self.calls += 1
        return self.pages.pop(0)


def _subscription(*, tier: str = "FREE", status: str = "ACTIVE") -> dict[str, str]:
    return {"planFamily": "CloudFront", "planTier": tier, "status": status}


def test_legacy_account_with_capacity_is_eligible_across_paginated_results() -> None:
    pricing = FakePricingPlanClient(
        [
            {"subscriptionSummaries": [_subscription()], "nextToken": "next-page"},
            {
                "subscriptionSummaries": [
                    _subscription(tier="PRO"),
                    _subscription(status="FAILED"),
                ]
            },
        ]
    )

    result = check_pricing_plan_eligibility(FakeFreeTierClient(None), pricing)

    assert result == {
        "eligible": True,
        "account_plan_type": "LEGACY",
        "cloudfront_free_plan_count": 1,
        "cloudfront_free_plan_limit": 3,
    }


def test_new_free_tier_account_is_ineligible() -> None:
    result = check_pricing_plan_eligibility(
        FakeFreeTierClient("FREE"),
        FakePricingPlanClient([{"subscriptionSummaries": []}]),
    )

    assert result["eligible"] is False


def test_account_at_three_free_plans_is_ineligible() -> None:
    result = check_pricing_plan_eligibility(
        FakeFreeTierClient("PAID"),
        FakePricingPlanClient(
            [{"subscriptionSummaries": [_subscription(), _subscription(), _subscription()]}]
        ),
    )

    assert result["eligible"] is False

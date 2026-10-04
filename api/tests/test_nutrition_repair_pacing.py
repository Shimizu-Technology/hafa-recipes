"""Real request-limiter coverage with a virtual clock and no paid provider calls."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app import ai_governance
from app.nutrition_backfill import RepairPacer
from app.rate_limit import UserRateLimiter
from app.services import nutrition
from tests.test_nutrition_enrichment import TOTAL, recipe


class VirtualClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def read(self):
        return self.now

    async def sleep(self, seconds):
        assert 0 < seconds <= 7.0
        self.sleeps.append(seconds)
        self.now += seconds


def configure_virtual_nutrition(monkeypatch):
    """Exercise the actual limiter, tracker and result validation, stubbing only SDK I/O."""
    clock = VirtualClock()
    starts = []
    settings = nutrition.get_settings().model_copy(update={"allow_paid_ai_in_development": True})
    monkeypatch.setattr(nutrition, "get_settings", lambda: settings)
    monkeypatch.setattr(ai_governance, "get_settings", lambda: settings)
    monkeypatch.setattr(nutrition, "ai_rate_limiter", UserRateLimiter(clock=clock.read))
    record = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", record)

    async def complete(**kwargs):
        starts.append(clock.now)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps({"total": TOTAL, "assumptions": []}))
                )
            ]
        )

    create = AsyncMock(side_effect=complete)

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(nutrition, "AsyncOpenAI", Client)
    return SimpleNamespace(
        clock=clock, starts=starts, create=create, record=record, settings=settings
    )


async def test_actual_same_owner_burst_classifies_local_denial_before_provider(monkeypatch):
    harness = configure_virtual_nutrition(monkeypatch)
    for _ in range(10):
        await nutrition.calculate_totals(recipe(), user_id="same-owner")
    with pytest.raises(nutrition.NutritionUnavailable) as caught:
        await nutrition.calculate_totals(recipe(), user_id="same-owner")
    assert caught.value.code == "local_rate_limit"
    assert caught.value.retry_after == 60
    assert harness.create.await_count == harness.record.await_count == 10
    result = await nutrition.enrich_nutrition(recipe(), user_id="same-owner")
    assert result["derivedData"]["nutrition"]["errorCode"] == "local_rate_limit"
    assert result["derivedData"]["nutrition"]["status"] == "unavailable"
    assert result["components"] == recipe()["components"]
    assert harness.create.await_count == harness.record.await_count == 10


async def test_paced_same_owner_burst_keeps_actual_per_owner_limit_enabled(monkeypatch):
    harness = configure_virtual_nutrition(monkeypatch)
    pacer = RepairPacer(clock=harness.clock.read, sleep=harness.clock.sleep)
    # Keep the same pacer when continuing a batch: its next start survives calls.
    for batch in (range(6), range(5)):
        for _ in batch:
            await pacer.wait()
            await nutrition.calculate_totals(recipe(), user_id="same-owner")
    assert harness.create.await_count == harness.record.await_count == 11
    assert harness.starts == [7.0 * number for number in range(11)]
    assert len(harness.clock.sleeps) == 10
    # Pacing is not a bypass: an unrelated immediate burst still hits the budget.
    for _ in range(10):
        await nutrition.calculate_totals(recipe(), user_id="another-owner")
    with pytest.raises(nutrition.NutritionUnavailable) as caught:
        await nutrition.calculate_totals(recipe(), user_id="another-owner")
    assert caught.value.code == "local_rate_limit"

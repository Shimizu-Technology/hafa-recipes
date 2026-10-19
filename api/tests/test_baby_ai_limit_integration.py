"""Real admission rejection preserves source identities without provider calls."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.domains.baby import budget, provider
from app.domains.baby.budget import OWNER_DAILY_CAP
from app.domains.baby.models import BabyAIAdmission, BabyImport, BabyMessage, BabyRecord
from app.domains.baby.provider import AI_UNAVAILABLE_MESSAGE, DAILY_LIMIT_CODE, DAILY_LIMIT_MESSAGE
from app.domains.baby.runtime import BabyWorker
from app.models.ai import AIInvocation
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)


async def reject_ai(baby_api, monkeypatch, reason):
    monkeypatch.setattr(budget, "AsyncSessionLocal", baby_api.sessions)
    assert (
        await baby_api.client.patch(
            "/api/v1/baby/profile", headers=shared.GEN, json={"ai_consent": True}
        )
    ).status_code == 200
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(
        provider,
        "get_settings",
        lambda: SimpleNamespace(
            baby_ai_model="gpt-5.6-luna" if reason == "exhausted" else "unpriced-fixture-model",
            is_ai_capability_enabled=lambda _: True,
        ),
    )
    # The HTTP client must never even be constructed when admission rejects.
    outbound = Mock(side_effect=AssertionError("Admission must prevent provider calls"))
    monkeypatch.setattr(provider.httpx, "AsyncClient", outbound)
    if reason == "exhausted":
        async with baby_api.sessions() as db:
            db.add(
                BabyAIAdmission(
                    app_user_id="owner",
                    generation=1,
                    capability="baby_chat",
                    reserved_microusd=OWNER_DAILY_CAP,
                )
            )
            await db.commit()
    return outbound


@pytest.mark.parametrize("reason", ["exhausted", "unpriced"])
async def test_import_budget_rejection_keeps_original_and_same_retry_identity(
    baby_api, monkeypatch, reason
):
    outbound = await reject_ai(baby_api, monkeypatch, reason)
    c = baby_api.client
    body = {"id": str(uuid4()), "text": "Synthetic original text", "topics": ["Saved"]}
    created = await c.post("/api/v1/baby/imports", headers=shared.GEN, json=body)
    assert created.status_code == 200, created.text
    initial = created.json()
    worker = BabyWorker(baby_api.sessions)
    assert await worker.tick()
    message = DAILY_LIMIT_MESSAGE if reason == "exhausted" else AI_UNAVAILABLE_MESSAGE
    for attempt in (1, 2):
        job = (await c.get(f"/api/v1/baby/imports/{body['id']}")).json()
        assert job["record_id"] == initial["record_id"]
        assert job["status"] == "incomplete" and job["error"] == message
        source = (await c.get(f"/api/v1/baby/records/{initial['record_id']}")).json()
        assert source["data"]["source_text"] == body["text"]
        assert source["data"]["evidence"] == [{"location": "pasted_text", "text": body["text"]}]
        assert source["data"]["coverage_notes"] == [message]
        assert "workouts" not in str(job) and "workouts" not in str(source)
        if attempt == 1:
            replay = await c.post("/api/v1/baby/imports", headers=shared.GEN, json=body)
            assert replay.json()["record_id"] == initial["record_id"]
            assert (
                await c.post(f"/api/v1/baby/imports/{body['id']}/retry", headers=shared.GEN)
            ).status_code == 200
            assert await worker.tick()
    outbound.assert_not_called()
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyRecord)) == 1
        assert await db.scalar(select(func.count()).select_from(BabyImport)) == 1
        assert await db.scalar(select(func.count()).select_from(AIInvocation)) == 0
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission)) == (
            1 if reason == "exhausted" else 0
        )


@pytest.mark.parametrize("reason,status", [("exhausted", 429), ("unpriced", 503)])
async def test_chat_budget_limit_is_distinct_from_operational_unavailability(
    baby_api, monkeypatch, reason, status
):
    outbound = await reject_ai(baby_api, monkeypatch, reason)
    body = {"request_id": str(uuid4()), "message": "Synthetic question", "scope": "all"}
    response = await baby_api.client.post("/api/v1/baby/chat", headers=shared.GEN, json=body)
    assert response.status_code == status, response.text
    expected = (
        {"code": DAILY_LIMIT_CODE, "message": DAILY_LIMIT_MESSAGE}
        if reason == "exhausted"
        else AI_UNAVAILABLE_MESSAGE
    )
    assert response.json() == {"detail": expected}
    assert "workouts" not in response.text and "unpriced-fixture-model" not in response.text
    outbound.assert_not_called()
    async with baby_api.sessions() as db:
        message = await db.get(BabyMessage, body["request_id"])
        assert message.content["message"] == body["message"]
        assert message.content["status"] == "failed" and message.content["lease_until"] is None
        assert await db.scalar(select(func.count()).select_from(BabyMessage)) == 1
        assert await db.scalar(select(func.count()).select_from(AIInvocation)) == 0

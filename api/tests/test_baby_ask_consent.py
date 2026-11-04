"""AI permission alone doesn't authorize the new Ask: the current disclosure must be acknowledged."""

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.ai_governance import ai_request_context
from app.domains.baby import ask_gate, budget, router
from app.domains.baby.ask_gate import ASK_CONSENT_VERSION, ask_v2_allowed
from app.domains.baby.budget import AskCall, reserve_ask
from app.domains.baby.models import BabyAIAdmission, BabyMembership
from app.domains.workouts.budget import BudgetError
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)
PROFILE = "/api/v1/baby/profile"
CALL = AskCall(model="gpt-6-luna", input_bytes=100, max_output_tokens=100)


def flag(monkeypatch, on=True):
    settings = SimpleNamespace(baby_ask_v2_enabled=on)
    monkeypatch.setattr(ask_gate, "get_settings", lambda: settings)


@pytest.mark.parametrize(
    ("environment", "approved", "expected"),
    [
        ("production", "", False),
        ("production", "   ", False),
        ("production", "2026-11-20 Dr. Example", True),
        ("development", "", True),
    ],
)
def test_production_needs_the_clinician_approval_recorded_as_well_as_the_flag(monkeypatch, environment, approved, expected):
    settings = SimpleNamespace(baby_ask_v2_enabled=True, environment=environment, baby_ask_clinician_approval=approved)
    monkeypatch.setattr(ask_gate, "get_settings", lambda: settings)
    assert ask_gate.ask_v2_on() is expected


@pytest.mark.parametrize(
    ("on", "profile", "expected"),
    [
        (False, {"ai_consent": True, "ai_consent_version": ASK_CONSENT_VERSION}, False),
        (True, {"ai_consent": True}, False),
        (True, {"ai_consent": True, "ai_consent_version": 0}, False),
        (True, {"ai_consent": True, "ai_consent_version": ASK_CONSENT_VERSION - 1}, False),
        (True, {"ai_consent": True, "ai_consent_version": ASK_CONSENT_VERSION + 1}, False),
        (True, {"ai_consent": False, "ai_consent_version": ASK_CONSENT_VERSION}, False),
        (True, {"ai_consent": True, "ai_consent_version": ASK_CONSENT_VERSION}, True),
    ],
)
def test_only_the_flag_and_the_current_version_together_allow_it(monkeypatch, on, profile, expected):
    flag(monkeypatch, on)
    assert ask_v2_allowed(profile) is expected


async def stored(baby_api):
    async with baby_api.sessions() as db:
        return (await db.get(BabyMembership, "owner", populate_existing=True)).profile


@needs_database
async def test_acknowledging_is_recorded_and_withdrawing_clears_it(baby_api, monkeypatch):
    flag(monkeypatch, True)
    c = baby_api.client
    response = await c.patch(PROFILE, headers=shared.GEN, json={"ai_consent": True})
    assert response.status_code == 200 and response.json()["ai_consent_version"] == 0
    response = await c.patch(
        PROFILE, headers=shared.GEN, json={"acknowledge_ai_consent_version": ASK_CONSENT_VERSION}
    )
    assert response.json()["ai_consent_version"] == ASK_CONSENT_VERSION
    assert ask_v2_allowed(await stored(baby_api))
    response = await c.patch(PROFILE, headers=shared.GEN, json={"ai_consent": False})
    assert response.json()["ai_consent_version"] == 0
    # Turning AI back on doesn't bring the old acknowledgment with it.
    response = await c.patch(PROFILE, headers=shared.GEN, json={"ai_consent": True})
    assert response.json()["ai_consent_version"] == 0
    assert not ask_v2_allowed(await stored(baby_api))


@needs_database
async def test_an_old_app_sending_its_cached_profile_cannot_acknowledge(baby_api, monkeypatch):
    flag(monkeypatch, True)
    c = baby_api.client
    assert (await c.patch(PROFILE, headers=shared.GEN, json={"ai_consent": True})).status_code == 200
    # Whatever number a cached profile holds, in either direction, it changes nothing.
    sent = {"ai_consent": True, "display_name": "", "ai_consent_version": ASK_CONSENT_VERSION}
    response = await c.patch(PROFILE, headers=shared.GEN, json=sent)
    assert response.status_code == 200 and response.json()["ai_consent_version"] == 0
    await c.patch(PROFILE, headers=shared.GEN, json={"acknowledge_ai_consent_version": ASK_CONSENT_VERSION})
    response = await c.patch(PROFILE, headers=shared.GEN, json={**sent, "ai_consent_version": 0})
    assert response.json()["ai_consent_version"] == ASK_CONSENT_VERSION


@needs_database
@pytest.mark.parametrize(
    "body",
    [
        {"acknowledge_ai_consent_version": ASK_CONSENT_VERSION},  # AI is off
        {"ai_consent": True, "acknowledge_ai_consent_version": ASK_CONSENT_VERSION + 1},
        {"ai_consent": True, "acknowledge_ai_consent_version": 0},
        {"ai_consent": False, "acknowledge_ai_consent_version": ASK_CONSENT_VERSION},
    ],
)
async def test_an_acknowledgment_that_does_not_fit_is_refused(baby_api, monkeypatch, body):
    flag(monkeypatch, True)
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json=body)
    assert response.status_code == 422
    assert (await stored(baby_api)).get("ai_consent_version", 0) == 0


@needs_database
async def test_admission_refuses_anyone_who_has_not_acknowledged(baby_api, monkeypatch):
    flag(monkeypatch, True)
    monkeypatch.setattr(budget, "AsyncSessionLocal", baby_api.sessions)
    await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"ai_consent": True})
    def context():
        return ai_request_context(request_id="r", user_id="owner", job_id=None, route="/api/v1/baby/chat")

    with context(), pytest.raises(BudgetError):
        await reserve_ask("baby_ask", CALL)
    async with baby_api.sessions() as db:
        assert list(await db.scalars(select(BabyAIAdmission))) == []
    await baby_api.client.patch(
        PROFILE, headers=shared.GEN, json={"acknowledge_ai_consent_version": ASK_CONSENT_VERSION}
    )
    with context():
        await reserve_ask("baby_ask", CALL)
    flag(monkeypatch, False)
    with context(), pytest.raises(BudgetError):
        await reserve_ask("baby_ask", CALL)


@needs_database
@pytest.mark.parametrize(("on", "expected"), [(False, None), (True, ASK_CONSENT_VERSION)])
async def test_bootstrap_names_the_version_only_while_on(baby_api, monkeypatch, on, expected):
    monkeypatch.setattr(router, "ask_v2_on", lambda: on)
    response = await baby_api.client.post("/api/v1/baby/bootstrap")
    assert response.json()["ask_consent_version"] == expected

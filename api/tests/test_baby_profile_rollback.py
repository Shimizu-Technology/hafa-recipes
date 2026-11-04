"""A later release may store or send profile fields this one doesn't know. It has to keep working."""

import pytest
from sqlalchemy import update

from app.domains.baby.models import BabyMembership
from app.domains.baby.schemas import ProfilePatch
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
PROFILE = "/api/v1/baby/profile"
FROM_LATER_RELEASE = {"ai_consent_version": 1, "a_field_from_a_later_release": {"anything": True}}


async def store_later_fields(baby_api, **extra):
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        profile = {**member.profile, **FROM_LATER_RELEASE, **extra}
        await db.execute(update(BabyMembership).where(BabyMembership.app_user_id == "owner").values(profile=profile))
        await db.commit()


async def test_a_stored_profile_from_a_later_release_still_opens(baby_api):
    await store_later_fields(baby_api)
    response = await baby_api.client.post("/api/v1/baby/bootstrap")
    assert response.status_code == 200, response.text
    assert "ai_consent_version" not in response.json()["profile"]


async def test_consent_can_still_be_withdrawn_after_a_rollback(baby_api):
    await store_later_fields(baby_api, ai_consent=True)
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"ai_consent": False})
    assert response.status_code == 200, response.text
    assert response.json()["ai_consent"] is False


@pytest.mark.parametrize(
    "keys",
    [
        {"ai_consent_version": 1},
        {"acknowledge_ai_consent_version": 1},
        {"ai_consent_version": 1, "acknowledge_ai_consent_version": 1},
        {"ai_consent_version": None, "acknowledge_ai_consent_version": "anything"},
    ],
)
async def test_a_newer_app_sending_consent_keys_is_accepted_and_they_are_ignored(baby_api, keys):
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"display_name": "K", **keys})
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "K" and not set(keys) & set(response.json())
    async with baby_api.sessions() as db:
        assert not set(keys) & set((await db.get(BabyMembership, "owner")).profile)


async def test_consent_keys_alone_turn_nothing_on(baby_api):
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"acknowledge_ai_consent_version": 1})
    assert response.status_code == 200 and response.json()["ai_consent"] is False


async def test_every_other_unknown_key_is_still_refused(baby_api):
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"not_a_field": 1})
    assert response.status_code == 422
    with pytest.raises(ValueError):
        ProfilePatch.model_validate({"not_a_field": 1})

"""A later release may store profile fields this one doesn't know. It has to keep working.

From here on the consent keys are real fields, tested in test_baby_ask_consent.py.
"""

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
    assert "a_field_from_a_later_release" not in response.json()["profile"]


async def test_consent_can_still_be_withdrawn_after_a_rollback(baby_api):
    await store_later_fields(baby_api, ai_consent=True)
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"ai_consent": False})
    assert response.status_code == 200, response.text
    assert response.json()["ai_consent"] is False


async def test_every_other_unknown_key_is_still_refused(baby_api):
    response = await baby_api.client.patch(PROFILE, headers=shared.GEN, json={"not_a_field": 1})
    assert response.status_code == 422
    with pytest.raises(ValueError):
        ProfilePatch.model_validate({"not_a_field": 1})

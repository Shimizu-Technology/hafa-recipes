"""The F10 gate: every signed-in phone is on a family-capable build before Create family."""
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyChild, BabyMembership, BabySpace
from app.domains.baby.share_models import BabyShareCredential
from tests import test_baby_family_records as records
from tests import test_baby_invites as invites
from tests import test_baby_share_integration as native

baby_api, enabled, pytestmark = invites.baby_api, invites.enabled, invites.pytestmark
API = "/api/v1/baby"
BODY = {"publish_shared": True, "disclosure_version": 1}


@pytest.fixture
async def gate(baby_api, enabled):
    baby_api.settings.baby_invites_enabled = baby_api.settings.baby_new_kinds_enabled = True
    baby_api.client._transport.app.include_router(native.router)
    return enabled


def old_build(generation=1):
    return {"X-Test-Owner": "owner", "X-Baby-Client": "2", "X-Baby-Generation": str(generation)}


async def phone(api, personal, *, client="3", installation=None):
    """A phone provisioning its share credential, as every iOS build does when it opens."""
    installation = installation or str(uuid4())
    headers = records.headers(personal, generation=1) if client == "3" else old_build()
    result = await api.client.post(API + "/share/session", headers=headers, json={"installation_id": installation})
    assert result.status_code == 201, result.text
    return installation, result.json()["credential_id"]


async def family_count(api):
    async with api.sessions() as db:
        return await db.scalar(select(func.count()).select_from(BabySpace).where(BabySpace.kind == "family"))


async def create(api, personal):
    return await api.client.post(API + "/family/invites", headers=records.headers(personal, generation=1), json=BODY)


async def readiness(api, personal, **params):
    result = await api.client.get(API + "/family/readiness", headers=records.headers(personal, generation=1), params=params)
    assert result.status_code == 200, result.text
    return result.json()


async def test_a_phone_on_an_older_build_blocks_create_family_and_nothing_moves(baby_api, gate):
    h = records.headers(gate, generation=1)
    child = await baby_api.client.post(API + "/children", headers=h, json={"id": str(uuid4()), "name": "Mia"})
    assert child.status_code == 200, child.text
    _, credential = await phone(baby_api, gate, client="2")
    result = await create(baby_api, gate)
    assert result.status_code == 409, result.text
    detail = result.json()["detail"]
    assert detail["code"] == "phones_not_ready"
    assert [(row["id"], row["state"]) for row in detail["phones"]] == [(credential, "outdated")]
    assert await family_count(baby_api) == 0
    async with baby_api.sessions() as db:
        assert (await db.get(BabyChild, child.json()["id"])).space_id == gate, "Nothing moved"


async def test_updating_that_phone_clears_the_gate(baby_api, gate):
    installation, _ = await phone(baby_api, gate, client="2")
    assert (await readiness(baby_api, gate))["ready"] is False
    await phone(baby_api, gate, installation=installation)
    state = await readiness(baby_api, gate, installation_id=installation)
    assert state["ready"] is True
    assert state["phones"][0]["state"] == "ready" and state["phones"][0]["this_phone"] is True
    assert (await create(baby_api, gate)).status_code == 201


async def test_a_phone_it_cant_vouch_for_blocks_too_until_she_says_it_is_not_in_use(baby_api, gate):
    installation, credential = await phone(baby_api, gate)
    async with baby_api.sessions() as db:
        row = await db.get(BabyShareCredential, credential)
        row.expires_at = now() - timedelta(days=1)
        await db.commit()
    state = await readiness(baby_api, gate)
    assert state["ready"] is False and state["phones"][0]["state"] == "unknown"
    assert (await create(baby_api, gate)).status_code == 409
    forgot = await baby_api.client.post(f"{API}/family/phones/{credential}/forget", headers=records.headers(gate, generation=1))
    assert forgot.status_code == 200, forgot.text
    assert (await readiness(baby_api, gate))["ready"] is True
    assert (await create(baby_api, gate)).status_code == 201
    del installation


async def test_forget_refuses_someone_elses_phone(baby_api, gate):
    _, credential = await phone(baby_api, gate)
    async with baby_api.sessions() as db:
        row = await db.get(BabyShareCredential, credential)
        row.app_user_id = "other"
        await db.commit()
    result = await baby_api.client.post(f"{API}/family/phones/{credential}/forget", headers=records.headers(gate, generation=1))
    assert result.status_code == 404


async def test_a_signed_out_phone_doesnt_count(baby_api, gate):
    _, credential = await phone(baby_api, gate, client="2")
    async with baby_api.sessions() as db:
        (await db.get(BabyShareCredential, credential)).revoked_at = now()
        await db.commit()
    assert (await readiness(baby_api, gate))["ready"] is True


async def test_no_known_phone_isnt_a_reason_to_stop(baby_api, gate):
    assert (await readiness(baby_api, gate)) == {"ready": True, "phones": []}


async def test_only_the_first_invite_is_gated_since_nothing_moves_after_that(baby_api, gate):
    assert (await create(baby_api, gate)).status_code == 201
    await phone(baby_api, gate, client="2")
    assert (await create(baby_api, gate)).status_code == 201


async def test_its_marks_stay_out_of_every_response(baby_api, gate):
    await phone(baby_api, gate)
    h = records.headers(gate, generation=1)
    bootstrap = await baby_api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})
    assert "family_phones" not in bootstrap.json()["profile"]
    patched = await baby_api.client.patch(API + "/profile", headers=h, json={"display_name": "Kami"})
    assert patched.status_code == 200 and "family_phones" not in patched.json()
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "owner")).profile["family_phones"], "An edit from any build keeps them"


async def test_the_flag_off_changes_nothing(baby_api, gate):
    baby_api.settings.baby_family_enabled = False
    result = await baby_api.client.post(API + "/share/session", headers=old_build(), json={"installation_id": str(uuid4())})
    assert result.status_code == 201, result.text
    async with baby_api.sessions() as db:
        assert "family_phones" not in (await db.get(BabyMembership, "owner")).profile
    assert (await baby_api.client.get(API + "/family/readiness", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})).status_code == 404

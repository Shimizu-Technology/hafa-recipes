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


async def confirm(api, personal, **body):
    result = await api.client.post(API + "/family/phones/confirm", headers=records.headers(personal, generation=1), json=body)
    assert result.status_code == 200, result.text


async def test_a_phone_it_cant_vouch_for_blocks_too_until_she_says_it_is_not_in_use(baby_api, gate):
    _, credential = await phone(baby_api, gate)
    async with baby_api.sessions() as db:
        row = await db.get(BabyShareCredential, credential)
        row.expires_at = now() - timedelta(days=1)
        await db.commit()
    state = await readiness(baby_api, gate)
    assert state["ready"] is False and state["phones"][0]["state"] == "unknown"
    assert (await create(baby_api, gate)).status_code == 409
    await confirm(baby_api, gate)
    assert (await readiness(baby_api, gate))["ready"] is True
    assert (await create(baby_api, gate)).status_code == 201


async def test_confirming_leaves_this_phone_and_other_peoples_phones_alone(baby_api, gate):
    mine, here = await phone(baby_api, gate, client="2")
    _, stale = await phone(baby_api, gate, client="2")
    async with baby_api.sessions() as db:
        (await db.get(BabyShareCredential, stale)).app_user_id = "other"
        await db.commit()
    await confirm(baby_api, gate, installation_id=mine)
    async with baby_api.sessions() as db:
        assert (await db.get(BabyShareCredential, here)).revoked_at is None
        assert (await db.get(BabyShareCredential, stale)).revoked_at is None


async def test_a_signed_out_phone_doesnt_count(baby_api, gate):
    _, credential = await phone(baby_api, gate, client="2")
    async with baby_api.sessions() as db:
        (await db.get(BabyShareCredential, credential)).revoked_at = now()
        await db.commit()
    assert (await readiness(baby_api, gate))["ready"] is True


async def test_no_known_phone_isnt_a_reason_to_stop(baby_api, gate):
    assert (await readiness(baby_api, gate)) == {"ready": True, "phones": [], "older_client_at": None}


async def older_bootstrap(api, client="2"):
    headers = {"X-Test-Owner": "owner", **({"X-Baby-Client": client} if client else {})}
    result = await api.client.post(API + "/bootstrap", headers=headers)
    assert result.status_code == 200, result.text


async def no_sighting_yet(api):
    """The fixtures bootstrap as a legacy client before each test begins."""
    async with api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        member.profile = {key: value for key, value in member.profile.items() if key != "older_client_at"}
        await db.commit()


async def age_sighting(api, days):
    async with api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        member.profile = {**member.profile, "older_client_at": (now() - timedelta(days=days)).isoformat()}
        await db.commit()


@pytest.mark.older_client_gate
@pytest.mark.parametrize("client", ["2", None], ids=["client2", "build32"])
async def test_an_old_phone_that_only_ever_reads_bootstrap_blocks_create_family(baby_api, gate, client):
    await older_bootstrap(baby_api, client)
    state = await readiness(baby_api, gate)
    assert state["ready"] is False and state["older_client_at"] and state["phones"] == []
    result = await create(baby_api, gate)
    assert result.status_code == 409 and result.json()["detail"]["code"] == "phones_not_ready"
    assert await family_count(baby_api) == 0


@pytest.mark.older_client_gate
async def test_an_old_credential_request_is_a_sighting_and_undoes_readiness(baby_api, gate):
    await no_sighting_yet(baby_api)
    installation, _ = await phone(baby_api, gate)
    assert (await readiness(baby_api, gate))["ready"] is True
    await phone(baby_api, gate, client="2", installation=installation)
    state = await readiness(baby_api, gate)
    assert state["ready"] is False and state["older_client_at"] and state["phones"][0]["state"] == "outdated"
    assert (await create(baby_api, gate)).status_code == 409


@pytest.mark.older_client_gate
async def test_she_can_confirm_a_sighting_and_a_new_one_takes_it_back(baby_api, gate):
    installation, _ = await phone(baby_api, gate)
    await older_bootstrap(baby_api)
    await phone(baby_api, gate, installation=installation)
    assert (await readiness(baby_api, gate))["ready"] is False
    await confirm(baby_api, gate, installation_id=installation)
    assert (await readiness(baby_api, gate))["ready"] is True
    await older_bootstrap(baby_api)
    state = await readiness(baby_api, gate)
    assert state["ready"] is False, "A new sighting clears the confirmation"
    assert state["phones"][0]["state"] == "outdated", "and any readiness"
    assert (await create(baby_api, gate)).status_code == 409


@pytest.mark.older_client_gate
async def test_a_confirmation_from_before_the_sighting_doesnt_count(baby_api, gate):
    await older_bootstrap(baby_api)
    await confirm(baby_api, gate)
    await age_sighting(baby_api, 0)
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        member.profile = {**member.profile, "older_client_confirmed_at": (now() - timedelta(hours=2)).isoformat()}
        await db.commit()
    assert (await readiness(baby_api, gate))["ready"] is False


@pytest.mark.older_client_gate
async def test_a_sighting_stops_counting_after_14_days(baby_api, gate):
    await older_bootstrap(baby_api)
    await age_sighting(baby_api, 13)
    assert (await readiness(baby_api, gate))["ready"] is False
    await age_sighting(baby_api, 15)
    assert (await readiness(baby_api, gate)) == {"ready": True, "phones": [], "older_client_at": None}
    assert (await create(baby_api, gate)).status_code == 201


@pytest.mark.older_client_gate
async def test_this_build_is_never_a_sighting(baby_api, gate):
    await no_sighting_yet(baby_api)
    await older_bootstrap(baby_api, "3")
    installation, _ = await phone(baby_api, gate)
    await phone(baby_api, gate, installation=installation)
    assert (await readiness(baby_api, gate))["older_client_at"] is None
    baby_api.settings.baby_family_enabled = False
    three = {"X-Test-Owner": "owner", "X-Baby-Client": "3", "X-Baby-Generation": "1"}
    assert (await baby_api.client.post(API + "/bootstrap", headers=three)).status_code == 200
    assert (await baby_api.client.post(API + "/share/session", headers=three, json={"installation_id": installation})).status_code == 201
    async with baby_api.sessions() as db:
        assert "older_client_at" not in (await db.get(BabyMembership, "owner")).profile


@pytest.mark.older_client_gate
async def test_old_phones_are_seen_with_the_flag_off_too(baby_api, gate):
    baby_api.settings.baby_family_enabled = False
    await older_bootstrap(baby_api)
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "owner")).profile["older_client_at"]


@pytest.mark.older_client_gate
async def test_it_writes_at_most_hourly_unless_something_needs_clearing(baby_api, gate):
    await older_bootstrap(baby_api)
    async with baby_api.sessions() as db:
        first = (await db.get(BabyMembership, "owner")).profile["older_client_at"]
    await older_bootstrap(baby_api)
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "owner")).profile["older_client_at"] == first
    await age_sighting(baby_api, 0)
    await confirm(baby_api, gate)
    await older_bootstrap(baby_api)
    async with baby_api.sessions() as db:
        assert "older_client_confirmed_at" not in (await db.get(BabyMembership, "owner")).profile


async def test_only_the_first_invite_is_gated_since_nothing_moves_after_that(baby_api, gate):
    assert (await create(baby_api, gate)).status_code == 201
    await phone(baby_api, gate, client="2")
    assert (await create(baby_api, gate)).status_code == 201


@pytest.mark.older_client_gate
async def test_its_marks_stay_out_of_every_response_and_survive_an_edit(baby_api, gate):
    await no_sighting_yet(baby_api)
    await phone(baby_api, gate)
    h = records.headers(gate, generation=1)
    patched = await baby_api.client.patch(API + "/profile", headers=h, json={"display_name": "Kami"})
    assert patched.status_code == 200 and "family_phones" not in patched.json()
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "owner")).profile["family_phones"], "An edit from any build keeps them"
    await confirm(baby_api, gate)
    await older_bootstrap(baby_api)
    await confirm(baby_api, gate)
    patched = await baby_api.client.patch(API + "/profile", headers=h, json={"display_name": "Kami again"})
    bootstrap = await baby_api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})
    exported = await baby_api.client.get(API + "/export", headers=h)
    for body in (patched.text, bootstrap.text, exported.text):
        assert not any(word in body for word in ("family_phones", "older_client_at", "older_client_confirmed_at"))
    async with baby_api.sessions() as db:
        profile = (await db.get(BabyMembership, "owner")).profile
        assert profile["older_client_at"] and profile["older_client_confirmed_at"]


async def test_the_flag_off_keeps_the_route_shut(baby_api, gate):
    baby_api.settings.baby_family_enabled = False
    result = await baby_api.client.post(API + "/share/session", headers=old_build(), json={"installation_id": str(uuid4())})
    assert result.status_code == 201, result.text
    async with baby_api.sessions() as db:
        assert "family_phones" not in (await db.get(BabyMembership, "owner")).profile
    assert (await baby_api.client.get(API + "/family/readiness", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})).status_code == 404

"""The F10 gate: every signed-in phone is on a family-capable build before Create family."""
import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyChild, BabyMembership, BabySpace, BabySpaceMember
from app.domains.baby.share_models import BabyShareCredential
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
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


@pytest.mark.older_client_gate
async def test_get_bootstrap_stays_read_only_and_doesnt_wait_on_a_lock(baby_api, gate):
    """Exactly as on main with the flags off: nothing to record means nothing to wait for."""
    await no_sighting_yet(baby_api)
    baby_api.settings.baby_family_enabled = baby_api.settings.baby_invites_enabled = False

    async def timing_out():
        async with baby_api.sessions() as db:
            await db.execute(text("SET LOCAL lock_timeout='100ms'"))
            yield db

    app = baby_api.client._transport.app
    app.dependency_overrides[get_db] = timing_out
    async with baby_api.sessions() as blocker:
        await blocker.execute(select(BabyMembership).where(BabyMembership.app_user_id == "owner").with_for_update())
        try:
            seen = await baby_api.client.get(API + "/bootstrap", headers={"X-Baby-Client": "2"})
            assert seen.status_code == 200, seen.text
        finally:
            await blocker.rollback()
    async with baby_api.sessions() as db:
        assert "older_client_at" not in (await db.get(BabyMembership, "owner")).profile


@pytest.mark.older_client_gate
async def test_a_get_bootstrap_isnt_a_sighting_with_the_flags_on_either(baby_api, gate):
    await no_sighting_yet(baby_api)
    assert (await baby_api.client.get(API + "/bootstrap", headers={"X-Baby-Client": "2"})).status_code == 200
    assert (await readiness(baby_api, gate))["older_client_at"] is None


@pytest.mark.older_client_gate
async def test_a_sighting_survives_a_racing_profile_edit(baby_api, gate, monkeypatch):
    """Both go through the owner lock, so whichever waits writes on top of the other."""
    await no_sighting_yet(baby_api)
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        member.profile = {**member.profile, "ai_consent": True}
        await db.commit()
    entered, resume = asyncio.Event(), asyncio.Event()
    original = AsyncSession.scalars

    async def held(db, statement, *args, **kwargs):
        if asyncio.current_task().get_name() == "profile-edit" and "FROM baby_imports" in str(statement) and not entered.is_set():
            entered.set()
            await resume.wait()
        return await original(db, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "scalars", held)
    edit = asyncio.create_task(baby_api.client.patch(API + "/profile", headers=records.headers(gate, generation=1),
                                                     json={"ai_consent": False, "display_name": "Kami"}), name="profile-edit")
    await asyncio.wait_for(entered.wait(), 5)
    seen = asyncio.create_task(older_bootstrap(baby_api))
    await asyncio.sleep(0.2)
    assert not seen.done(), "The sighting waits for the edit's lock"
    resume.set()
    assert (await edit).status_code == 200
    await asyncio.wait_for(seen, 5)
    state = await readiness(baby_api, gate)
    assert state["older_client_at"] and not state["ready"]


@pytest.mark.older_client_gate
@pytest.mark.parametrize("how", ["bootstrap", "credential"])
async def test_recording_a_sighting_failing_doesnt_fail_the_request(baby_api, gate, monkeypatch, how):
    await no_sighting_yet(baby_api)
    original = AsyncSession.execute

    async def failing(db, statement, *args, **kwargs):
        if "older_client_at" in str(statement):
            raise DBAPIError("UPDATE", {}, Exception("no room"))
        return await original(db, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "execute", failing)
    if how == "bootstrap":
        result = await baby_api.client.post(API + "/bootstrap", headers=old_build())
        assert result.status_code == 200, result.text
        assert result.json()["profile"]
    else:
        await phone(baby_api, gate, client="2")


@pytest.mark.older_client_gate
async def test_a_joiner_gets_the_same_check_and_nothing_changes(baby_api, gate):
    await no_sighting_yet(baby_api)
    invitation = await invites.create(baby_api, gate)
    assert (await baby_api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "other", "X-Baby-Client": "2"})).status_code == 200
    result = await invites.accept(baby_api, invitation)
    assert result.status_code == 409, result.text
    assert result.json()["detail"]["code"] == "phones_not_ready"
    assert result.json()["detail"]["older_client_at"]
    async with baby_api.sessions() as db:
        assert await db.get(BabySpaceMember, (UUID(invitation["space_id"]), "other")) is None


@pytest.mark.older_client_gate
async def test_a_joiner_can_answer_it_and_then_join(baby_api, gate):
    await no_sighting_yet(baby_api)
    invitation = await invites.create(baby_api, gate)
    assert (await baby_api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "other", "X-Baby-Client": "2"})).status_code == 200
    personal = await invites.personal(baby_api, "other")
    answered = await baby_api.client.post(API + "/family/phones/confirm", headers=records.headers(personal, "other", 1), json={})
    assert answered.status_code == 200, answered.text
    assert (await invites.accept(baby_api, invitation)).status_code == 200


async def moved_feed(api, personal):
    """A timed feed from before Create family, whose finish is still queued on an older phone."""
    await no_sighting_yet(api)
    h = records.headers(personal, generation=1)
    child = str(uuid4())
    assert (await api.client.post(API + "/children", headers=h, json={"id": child, "name": "Nora"})).status_code == 200
    body = shared.payload("feeding", child_id=child, data={"method": "breast", "side": "left", "state": "running"})
    assert (await api.client.post(API + "/records", headers=h, json=body)).status_code == 200
    await older_bootstrap(api)
    await confirm(api, personal)
    invitation = await invites.create(api, personal)
    return body["id"], invitation["space_id"]


FINISH = {"action": "finish", "at": "2026-10-20T12:10:00+10:00"}


@pytest.mark.older_client_gate
async def test_an_older_phones_tap_on_a_moved_feed_is_retried_not_refused(baby_api, gate):
    """Builds 34 and 35 read a 404 or 409 here as "removed" and drop the tap. 5xx is what they keep and retry."""
    identifier, _ = await moved_feed(baby_api, gate)
    tap = await baby_api.client.post(API + f"/records/{identifier}/feed-action", headers=old_build(),
                                     json={"action_id": str(uuid4()), **FINISH})
    assert tap.status_code == 503, tap.text
    assert tap.headers["retry-after"]
    assert tap.json()["detail"]["code"] == "update_required"


@pytest.mark.older_client_gate
async def test_that_same_tap_goes_through_once_the_phone_is_updated(baby_api, gate):
    identifier, family = await moved_feed(baby_api, gate)
    action = {"action_id": str(uuid4()), **FINISH}
    assert (await baby_api.client.post(API + f"/records/{identifier}/feed-action", headers=old_build(), json=action)).status_code == 503
    moved = await baby_api.client.post(API + f"/records/{identifier}/feed-action", headers=records.headers(gate, generation=1), json=action)
    assert moved.status_code == 409 and moved.json()["code"] == "moved"
    done = await baby_api.client.post(API + f"/records/{identifier}/feed-action", headers=records.headers(family, generation=1), json=action)
    assert done.status_code == 200, done.text
    assert done.json()["data"]["state"] != "running"


@pytest.mark.older_client_gate
async def test_an_older_phones_session_tap_on_a_moved_entry_is_retried_too(baby_api, gate):
    await no_sighting_yet(baby_api)
    h = records.headers(gate, generation=1)
    body = shared.payload("kick_session", data={})
    made = await baby_api.client.post(API + "/records", headers=h, json=body)
    assert made.status_code == 200, made.text
    await older_bootstrap(baby_api)
    await confirm(baby_api, gate)
    await invites.create(baby_api, gate)
    tap = await baby_api.client.post(API + f"/records/{body['id']}/session-action", headers=old_build(),
                                     json={"action_id": str(uuid4()), "action": "tap", "at": "2026-10-20T12:10:00+10:00"})
    assert tap.status_code == 503, tap.text


@pytest.mark.older_client_gate
async def test_a_row_that_was_truly_removed_is_still_a_404_for_an_older_phone(baby_api, gate):
    await no_sighting_yet(baby_api)
    h = records.headers(gate, generation=1)
    body = shared.payload("feeding", data={"method": "breast", "side": "left", "state": "running"})
    assert (await baby_api.client.post(API + "/records", headers=h, json=body)).status_code == 200
    gone = await baby_api.client.delete(API + f"/records/{body['id']}", headers=h, params={"revision": 1})
    assert gone.status_code in (200, 204), gone.text
    tap = await baby_api.client.post(API + f"/records/{body['id']}/feed-action", headers=old_build(),
                                     json={"action_id": str(uuid4()), **FINISH})
    assert tap.status_code in (404, 410), tap.text


async def test_the_flag_off_keeps_the_route_shut(baby_api, gate):
    baby_api.settings.baby_family_enabled = False
    result = await baby_api.client.post(API + "/share/session", headers=old_build(), json={"installation_id": str(uuid4())})
    assert result.status_code == 201, result.text
    async with baby_api.sessions() as db:
        assert "family_phones" not in (await db.get(BabyMembership, "owner")).profile
    assert (await baby_api.client.get(API + "/family/readiness", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})).status_code == 404

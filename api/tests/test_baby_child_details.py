"""J1b child details: what old clients can't lose, and what a bad value is told."""
from importlib import import_module
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.domains.baby.models import BabyChild, BabyMembership, BabySpaceMember
from app.domains.baby.runtime import verify_baby_schema
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark
CHILDREN = "/api/v1/baby/children"
FULL = {"sex": "girl", "weight_at_birth_g": 3402, "length_at_birth_cm": 50.8,
        "weeks_at_birth": 39, "feeding": "both", "tracking": {"diaper": True, "bottle": False}}


async def born_with_details(api, headers, details=FULL):
    identifier = str(uuid4())
    result = await api.client.post(CHILDREN, headers=headers, json={"id": identifier, "name": "Synthetic", "details": details})
    assert result.status_code == 200, result.text
    return identifier


async def test_returned_by_create_patch_list_bootstrap_and_export(baby_api):
    c = baby_api.client
    identifier = await born_with_details(baby_api, shared.GEN)
    plain = await c.post(CHILDREN, headers=shared.GEN, json={"name": "No details"})
    assert plain.status_code == 200 and plain.json()["details"] == {}
    listed = {row["id"]: row for row in (await c.get(CHILDREN)).json()["items"]}
    assert listed[identifier]["details"] == FULL
    booted = {row["id"]: row for row in (await c.post("/api/v1/baby/bootstrap")).json()["children"]}
    assert booted[identifier]["details"] == FULL
    exported = {row["id"]: row for row in (await c.get("/api/v1/baby/export")).json()["children"]}
    assert exported[identifier]["details"] == FULL


@pytest.mark.parametrize("client", [None, "2"])
@pytest.mark.parametrize("edit", [{"birth_date": "2026-11-01"}, {"name": "Renamed", "birth_date": "2026-11-01", "due_date": None}])
async def test_build_33_patch_without_details_keeps_them(baby_api, client, edit):
    h = {**shared.GEN, **({"X-Baby-Client": client} if client else {})}
    identifier = await born_with_details(baby_api, h)
    result = await baby_api.client.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, **edit})
    assert result.status_code == 200, result.text
    assert result.json()["birth_date"] == "2026-11-01" and result.json()["details"] == FULL
    assert result.json()["revision"] == 2
    assert (await baby_api.client.get(CHILDREN, headers=h)).json()["items"][0]["details"] == FULL


async def test_client_3_patch_without_details_keeps_them(baby_api, family):
    h = records.headers(family)
    identifier = await born_with_details(baby_api, h)
    result = await baby_api.client.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, "birth_date": "2026-11-01"})
    assert result.status_code == 200 and result.json()["details"] == FULL
    assert result.json()["space_id"] == str(family)


async def test_patch_changes_only_what_was_sent(baby_api):
    c = baby_api.client
    identifier = await born_with_details(baby_api, shared.GEN)
    result = await c.patch(f"{CHILDREN}/{identifier}", headers=shared.GEN, json={
        "revision": 1, "details": {"sex": None, "feeding": "bottle", "tracking": {"bottle": True, "sleep": False}}})
    assert result.status_code == 200, result.text
    expected = {key: value for key, value in FULL.items() if key != "sex"} | {
        "feeding": "bottle", "tracking": {"diaper": True, "bottle": True, "sleep": False}}
    assert result.json()["details"] == expected
    # A null `details` or an empty one is no change at all, not a wipe.
    for revision, body in ((2, None), (3, {})):
        result = await c.patch(f"{CHILDREN}/{identifier}", headers=shared.GEN, json={"revision": revision, "details": body})
        assert result.status_code == 200 and result.json()["details"] == expected


async def test_unknown_keys_are_ignored_not_rejected_or_kept(baby_api):
    h, c = shared.GEN, baby_api.client
    identifier = await born_with_details(baby_api, h, {"sex": "boy", "from_the_future": {"a": 1}})
    async with baby_api.sessions() as db:
        assert (await db.get(BabyChild, UUID(identifier))).details == {"sex": "boy"}
    result = await c.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, "details": {"another": 1}})
    assert result.status_code == 200 and result.json()["details"] == {"sex": "boy"}


@pytest.mark.parametrize("details,detail", [
    ({"sex": "other"}, "Choose girl or boy, or leave it blank"),
    ({"weight_at_birth_g": 99}, "Enter a birth weight between 100 g and 10 kg"),
    ({"weight_at_birth_g": 10001}, "Enter a birth weight between 100 g and 10 kg"),
    ({"weight_at_birth_g": "3400"}, "Enter a birth weight between 100 g and 10 kg"),
    ({"weight_at_birth_g": True}, "Enter a birth weight between 100 g and 10 kg"),
    ({"length_at_birth_cm": 14.9}, "Enter a birth length between 15 and 80 cm"),
    ({"length_at_birth_cm": 80.1}, "Enter a birth length between 15 and 80 cm"),
    ({"weeks_at_birth": 19}, "Enter weeks at birth between 20 and 45"),
    ({"weeks_at_birth": 46}, "Enter weeks at birth between 20 and 45"),
    ({"feeding": "formula"}, "Choose nursing, bottle or both, or leave it blank"),
    ({"tracking": {"Diaper!": True}}, "A tracker setting could not be read"),
    ({"tracking": {"diaper": "yes"}}, "A tracker setting could not be read"),
    ({"tracking": {f"t{n}": True for n in range(41)}}, "A tracker setting could not be read"),
])
async def test_bad_values_get_a_plain_answer_and_change_nothing(baby_api, details, detail):
    c = baby_api.client
    result = await c.post(CHILDREN, headers=shared.GEN, json={"name": "Synthetic", "details": details})
    assert result.status_code == 422 and result.json()["detail"] == detail
    identifier = await born_with_details(baby_api, shared.GEN)
    result = await c.patch(f"{CHILDREN}/{identifier}", headers=shared.GEN, json={"revision": 1, "details": details})
    assert result.status_code == 422 and result.json()["detail"] == detail
    async with baby_api.sessions() as db:
        row = await db.get(BabyChild, UUID(identifier))
        assert row.revision == 1 and row.details == FULL


async def test_the_tracker_limit_holds_on_the_merged_map(baby_api):
    c, h = baby_api.client, shared.GEN
    first = {f"a{n}": True for n in range(40)}
    identifier = await born_with_details(baby_api, h, {"tracking": first})
    result = await c.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, "details": {"tracking": {"one_more": True}}})
    assert result.status_code == 422 and result.json()["detail"] == "A tracker setting could not be read"
    async with baby_api.sessions() as db:
        row = await db.get(BabyChild, UUID(identifier))
        assert row.revision == 1 and row.details["tracking"] == first
    # Changing one already there is still fine at the limit.
    result = await c.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, "details": {"tracking": {"a0": False}}})
    assert result.status_code == 200 and len(result.json()["details"]["tracking"]) == 40


async def test_birth_time_is_no_longer_kept(baby_api):
    identifier = await born_with_details(baby_api, shared.GEN, {"sex": "boy", "birth_time": "03:15"})
    async with baby_api.sessions() as db:
        assert (await db.get(BabyChild, UUID(identifier))).details == {"sex": "boy"}


async def test_length_keeps_one_decimal_and_a_whole_number_is_fine(baby_api):
    identifier = await born_with_details(baby_api, shared.GEN, {"length_at_birth_cm": 50})
    result = await baby_api.client.patch(f"{CHILDREN}/{identifier}", headers=shared.GEN,
                                         json={"revision": 1, "details": {"length_at_birth_cm": 50.8000001}})
    assert result.status_code == 200 and result.json()["details"] == {"length_at_birth_cm": 50.8}


async def test_a_retry_from_before_this_change_still_replays(baby_api):
    """Rows saved by older code hashed four fields. Their lost-response retries must not turn into conflicts."""
    from app.domains.baby.lifecycle import digest

    identifier = str(uuid4())
    body = {"id": identifier, "name": "Synthetic", "birth_date": None, "due_date": None}
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        db.add(BabyChild(id=UUID(identifier), app_user_id="owner", space_id=member.personal_space_id, generation=1,
                         revision=1, name="Synthetic", creation_hash=digest(body)))
        await db.commit()
    result = await baby_api.client.post(CHILDREN, headers=shared.GEN, json={"id": identifier, "name": "Synthetic"})
    assert result.status_code == 200 and result.json()["details"] == {}
    # With details the answer has to match too: the same id for different details is a different save.
    other = await baby_api.client.post(CHILDREN, headers=shared.GEN, json={"id": identifier, "name": "Synthetic", "details": {"sex": "boy"}})
    assert other.status_code == 409


async def test_replay_with_the_same_details_returns_the_one_row(baby_api):
    h, c = shared.GEN, baby_api.client
    identifier = await born_with_details(baby_api, h)
    replay = await c.post(CHILDREN, headers=h, json={"id": identifier, "name": "Synthetic", "details": FULL})
    assert replay.status_code == 200 and replay.json()["revision"] == 1


async def test_removing_a_profile_erases_its_details(baby_api):
    identifier = await born_with_details(baby_api, shared.GEN)
    result = await baby_api.client.delete(f"{CHILDREN}/{identifier}?revision=1", headers=shared.GEN)
    assert result.status_code == 204
    async with baby_api.sessions() as db:
        row = await db.get(BabyChild, UUID(identifier))
        assert row.deleted_at and row.details == {} and row.name == ""


async def test_caregiver_cannot_change_details_but_reads_them(baby_api, family):
    c = baby_api.client
    identifier = await born_with_details(baby_api, records.headers(family))
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    h = records.headers(family, "other")
    result = await c.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, "details": {"sex": "boy"}})
    assert result.status_code == 403
    assert (await c.get(CHILDREN, headers=h)).json()["items"][0]["details"] == FULL


async def test_the_shared_api_refuses_to_start_without_the_column(baby_api, monkeypatch):
    """Why #546 deploys only after 059 is applied: this stops every app on the API, Recipes and Workouts too."""
    monkeypatch.setattr("app.domains.baby.runtime.get_settings", lambda: baby_api.settings)
    await verify_baby_schema(baby_api.sessions)
    async with baby_api.engine.begin() as db:
        await db.execute(text("ALTER TABLE baby_children DROP COLUMN details"))
    with pytest.raises(RuntimeError, match="schema is incomplete"):
        await verify_baby_schema(baby_api.sessions)


async def test_create_family_carries_details_and_moved_answer_shows_them(baby_api):
    baby_api.settings.baby_family_enabled = baby_api.settings.baby_invites_enabled = True
    await import_module("migrations.058_contract_baby_spaces").run_migration(
        configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    c, h = baby_api.client, records.headers(personal, generation=1)
    identifier = await born_with_details(baby_api, h)
    made = await c.post("/api/v1/baby/family/invites", headers=h, json={"publish_shared": True, "disclosure_version": 1})
    assert made.status_code == 201, made.text
    target = records.headers(made.json()["space_id"], generation=1)
    moved = {row["id"]: row for row in (await c.get(CHILDREN, headers=target)).json()["items"]}[identifier]
    assert moved["details"] == FULL and moved["space_id"] == made.json()["space_id"]
    stale = await c.patch(f"{CHILDREN}/{identifier}", headers=h, json={"revision": 1, "name": "Stale"})
    assert stale.status_code == 409 and stale.json()["record"]["details"] == FULL
    edited = await c.patch(f"{CHILDREN}/{identifier}", headers=target, json={"revision": moved["revision"], "birth_date": "2026-11-01"})
    assert edited.status_code == 200 and edited.json()["details"] == FULL


async def test_changes_feed_shows_details_and_a_removed_child_gives_none(baby_api, family, monkeypatch):
    baby_api.client._transport.app.include_router(import_module("app.domains.baby.changes").router, prefix="/api/v1/baby")
    monkeypatch.setattr("app.domains.baby.changes.family_enabled", lambda: True, raising=False)
    c, h = baby_api.client, records.headers(family)
    identifier = await born_with_details(baby_api, h)
    page = (await c.get("/api/v1/baby/changes", headers=h)).json()
    items = [item for space in page["spaces"] if space["id"] == str(family) for item in space["items"]]
    assert next(item for item in items if item["id"] == identifier)["details"] == FULL
    assert (await c.delete(f"{CHILDREN}/{identifier}?revision=1", headers=h)).status_code == 204
    page = (await c.get("/api/v1/baby/changes", headers=h)).json()
    items = [item for space in page["spaces"] if space["id"] == str(family) for item in space["items"]]
    assert next(item for item in items if item["id"] == identifier) == {"id": identifier, "removed": True, "seq": items[-1]["seq"], "entity": "child"}

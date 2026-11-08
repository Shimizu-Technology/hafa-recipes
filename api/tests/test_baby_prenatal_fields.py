"""Optional visit metadata is verbatim and survives clients that omit it."""
from datetime import datetime

import pytest
from pydantic import ValidationError

from app.domains.baby.router import PATCH_ADDITIONS, kept_additions
from app.domains.baby.schemas import EventData
from tests import test_baby_access as foundation
from tests import test_baby_integration as shared
from tests.test_baby_events import allow_events, save

baby_api, family = shared.baby_api, foundation.family


def test_visit_fields_are_optional_and_do_not_change_old_creation_hashes():
    data = EventData(timezone="Pacific/Guam").model_dump(mode="json")
    assert not set(PATCH_ADDITIONS["event"]).intersection(data)


def test_old_client_patch_retains_words_and_snapshot_and_explicit_clear_works():
    original = {"clinician_age": "  12w6d per clinic  ", "results": "GBS swab done — result pending", "due_date_snapshot": "2026-12-10", "result_status": "pending"}
    saved = EventData(timezone="Pacific/Guam", **original).model_dump(mode="json")
    assert all(saved[key] == value for key, value in original.items())
    patched = kept_additions(saved, {"timezone": "Pacific/Guam"}, PATCH_ADDITIONS["event"])
    assert all(patched[key] == value for key, value in original.items())
    assert kept_additions(saved, {"results": None}, PATCH_ADDITIONS["event"])["results"] is None
    with pytest.raises(ValidationError):
        EventData(timezone="Pacific/Guam", result_status="positive")




@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_old_build_omission_preserves_saved_history(baby_api):
    await allow_events(baby_api)
    first, _ = await save(baby_api, "event", occurred_at="2026-11-08T00:00:00+10:00", data={"timezone": "Pacific/Guam", "clinician_age": "35 weeks per clinic", "results": "GBS swab done", "due_date_snapshot": "2026-12-10"})
    assert first.status_code == 200, first.text
    row = first.json()
    changed = await baby_api.client.patch(f"/api/v1/baby/records/{row['id']}", headers={**shared.GEN, "X-Baby-Client": "2"}, json={"revision": row["revision"], "data": {"timezone": "Pacific/Guam", "location": "Clinic"}})
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["clinician_age"] == "35 weeks per clinic"
    assert changed.json()["data"]["results"] == "GBS swab done"
    assert changed.json()["data"]["due_date_snapshot"] == "2026-12-10"


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_pasted_replay_keeps_first_capture_and_historical_due_date(baby_api):
    await allow_events(baby_api)
    source = {"text": "First test 💛", "start": 0, "end": 13, "original": True}
    first, body = await save(baby_api, "journal", body=source["text"], data={"paste_origin": source})
    assert first.status_code == 200, first.text
    body["occurred_at"] = "2026-11-08T00:00:00+10:00"
    body["title"] = "Another capture title"
    replay = await baby_api.client.post("/api/v1/baby/records", headers={**shared.GEN, "X-Baby-Client": "2"}, json=body)
    assert replay.status_code == 200, replay.text
    assert datetime.fromisoformat(replay.json()["occurred_at"]) == datetime.fromisoformat(first.json()["occurred_at"])
    body["body"] = "Different words"
    assert (await baby_api.client.post("/api/v1/baby/records", headers={**shared.GEN, "X-Baby-Client": "2"}, json=body)).status_code == 409


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_saved_defaults_read_beyond_the_phone_cache_and_do_not_mix_owners(baby_api):
    await allow_events(baby_api)
    saved, _ = await save(baby_api, "event", data={"timezone": "Pacific/Guam", "provider_default": True, "provider_default_at": 1794000000000, "doctor": "Dr Test", "location": "Test Clinic"})
    assert saved.status_code == 200, saved.text
    response = await baby_api.client.post("/api/v1/baby/visit-defaults/read", headers={**shared.GEN, "X-Baby-Client": "2"})
    assert response.status_code == 200, response.text
    assert response.json() == {"doctor": "Dr Test", "location": "Test Clinic"}
    foreign = await baby_api.client.post("/api/v1/baby/visit-defaults/read", headers={**shared.GEN, "X-Test-Owner": "other", "X-Baby-Client": "2"})
    assert foreign.json() is None


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_caregiver_cannot_read_or_overwrite_visit_words_and_only_contributor_redacts(baby_api, family):
    from app.domains.baby.models import BabySpaceMember
    from tests.test_baby_family_records import headers

    await allow_events(baby_api)
    c = baby_api.client
    body = shared.payload("event", body="Private visit notes", data={"category": "appointment", "timezone": "Pacific/Guam", "results": "Private results", "follow_up": "Private followup", "clinician_age": "35 weeks", "paste_origin": {"text": "Original", "start": 0, "end": 8, "original": False}})
    saved = await c.post("/api/v1/baby/records", headers=headers(family), json=body)
    assert saved.status_code == 200, saved.text
    refused_parent = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"), json={"revision": 1, "data": {"paste_origin": None}})
    assert refused_parent.status_code == 403
    async with baby_api.sessions() as db:
        member = await db.get(BabySpaceMember, (family, "other"))
        member.role = "caregiver"
        await db.commit()
    for path in (f"/records/{body['id']}", "/records", "/search?q=Private"):
        response = await c.get("/api/v1/baby" + path, headers=headers(family, "other"))
        assert response.status_code == 200, response.text
        assert "Private visit notes" not in response.text and "Private results" not in response.text and "Original" not in response.text
        if path.startswith("/search"):
            assert response.json()["items"] == [] and response.json()["total"] == 0
    parent_search = await c.get("/api/v1/baby/search", params={"q": "Private"}, headers=headers(family))
    assert parent_search.json()["total"] == 1
    visible_search = await c.get("/api/v1/baby/search", params={"q": body["title"]}, headers=headers(family, "other"))
    assert visible_search.json()["total"] == 1
    original_search = await c.get("/api/v1/baby/search", params={"q": "Original"}, headers=headers(family, "other"))
    assert original_search.json()["total"] == 0
    bypass = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"), json={"revision": 1, "data": {"category": "other", "timezone": "Pacific/Guam"}})
    assert bypass.status_code == 403
    changed = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"), json={"revision": 1, "body": "", "data": {"category": "appointment", "timezone": "Pacific/Guam", "location": "New place"}})
    assert changed.status_code == 200, changed.text
    parent = (await c.get(f"/api/v1/baby/records/{body['id']}", headers=headers(family))).json()
    assert parent["body"] == body["body"] and parent["data"]["results"] == "Private results"
    assert parent["data"]["location"] == "New place"
    refused = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"), json={"revision": parent["revision"], "data": {"paste_origin": None}})
    assert refused.status_code == 403
    removed = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family), json={"revision": parent["revision"], "data": {**parent["data"], "paste_origin": None}})
    assert removed.status_code == 200, removed.text
    assert removed.json()["data"].get("paste_origin") is None

    from types import SimpleNamespace
    from zoneinfo import ZoneInfo

    from app.domains.baby.access import access_for
    from app.domains.baby.ask_tools import entries
    from app.domains.baby.chat import retrieve
    from app.domains.baby.models import BabyRecord
    from app.domains.baby.schemas import ChatRequest

    async with baby_api.sessions() as db:
        access = await access_for(db, "other", client="3", space_id=family)
        row = await db.get(BabyRecord, body["id"])
        tools = SimpleNamespace(zone=ZoneInfo("Pacific/Guam"), tracked={"records": {}}, citable={}, logged={}, notes={}, displays={})
        results = await entries(tools, db, access, [row])
        assert len(results) == 1 and "Private" not in str(results) and not tools.notes
        context, displays, _ = await retrieve(db, access, 7, ChatRequest(message="What happened?", record_id=body["id"]))
        assert "Private" not in str(context) + str(displays)


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_event_replay_keeps_its_first_due_snapshot(baby_api):
    await allow_events(baby_api)
    source = {"text": "Visit words", "start": 0, "end": 11, "original": False}
    first, body = await save(baby_api, "event", body=source["text"], data={"timezone": "Pacific/Guam", "paste_origin": source, "due_date_snapshot": "2026-12-10"})
    assert first.status_code == 200, first.text
    body["data"]["due_date_snapshot"] = "2026-12-15"
    replay = await baby_api.client.post("/api/v1/baby/records", headers={**shared.GEN, "X-Baby-Client": "2"}, json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"]["due_date_snapshot"] == "2026-12-10"


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_recategorized_visit_remains_private_and_marker_cannot_be_cleared(baby_api, family):
    from app.domains.baby.models import BabySpaceMember
    from tests.test_baby_family_records import headers

    await allow_events(baby_api)
    body = shared.payload("event", body="Medical body", data={"category": "appointment", "timezone": "Pacific/Guam"})
    c = baby_api.client
    saved = await c.post("/api/v1/baby/records", headers=headers(family), json=body)
    assert saved.status_code == 200, saved.text
    changed = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family), json={"revision": 1, "data": {"category": "other", "category_label": "Class", "timezone": "Pacific/Guam", "medical_visit": False}})
    assert changed.status_code == 200 and changed.json()["data"]["medical_visit"] is True, changed.text
    async with baby_api.sessions() as db:
        member = await db.get(BabySpaceMember, (family, "other"))
        member.role = "caregiver"
        await db.commit()
    read = await c.get(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"))
    assert read.status_code == 200 and read.json()["body"] == "", read.text


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_only_moment_contributor_can_remove_provenance(baby_api, family):
    from tests.test_baby_family_records import headers

    source = {"text": "Moment", "start": 0, "end": 6, "original": False}
    body = shared.payload("journal", body="Moment", data={"paste_origin": source})
    c = baby_api.client
    assert (await c.post("/api/v1/baby/records", headers=headers(family), json=body)).status_code == 200
    denied = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"), json={"revision": 1, "data": {"paste_origin": None}})
    assert denied.status_code == 403
    allowed = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family), json={"revision": 1, "data": {"paste_origin": None}})
    assert allowed.status_code == 200, allowed.text


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_future_phone_clock_does_not_pin_old_provider_default(baby_api):
    from uuid import UUID

    from app.domains.baby.models import BabyRecord

    await allow_events(baby_api)
    first, body = await save(baby_api, "event", data={"timezone": "Pacific/Guam", "provider_default": True, "provider_default_at": 9999999999999, "doctor": "Old"})
    assert first.status_code == 200, first.text
    assert first.json()["data"]["provider_default_at"] < 9999999999999
    # A row already saved before server stamping was introduced.
    async with baby_api.sessions() as db:
        row = await db.get(BabyRecord, UUID(body["id"]))
        row.data = {**row.data, "provider_default_at": 9999999999999}
        await db.commit()
    newer, _ = await save(baby_api, "event", data={"timezone": "Pacific/Guam", "provider_default": True, "provider_default_at": 1, "doctor": "New"})
    assert newer.status_code == 200, newer.text
    defaults = await baby_api.client.post("/api/v1/baby/visit-defaults/read", headers={**shared.GEN, "X-Baby-Client": "2"})
    assert defaults.json()["doctor"] == "New"


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_bootstrap_advertises_reviewed_import_support(baby_api):
    reply = await baby_api.client.post("/api/v1/baby/bootstrap", headers={"X-Baby-Client": "2"})
    assert reply.status_code == 200, reply.text
    assert reply.json()["visit_import_available"] is True


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable database required")
async def test_caregiver_cannot_change_provider_default_ordering(baby_api, family):
    from app.domains.baby.models import BabySpaceMember
    from tests.test_baby_family_records import headers

    await allow_events(baby_api)
    c = baby_api.client
    body = shared.payload("event", data={"category": "appointment", "timezone": "Pacific/Guam", "provider_default": True, "provider_default_at": 1, "doctor": "Dr Parent"})
    saved = await c.post("/api/v1/baby/records", headers=headers(family), json=body)
    assert saved.status_code == 200, saved.text
    timestamp = saved.json()["data"]["provider_default_at"]
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    edited = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=headers(family, "other"), json={"revision": 1, "data": {"category": "appointment", "timezone": "Pacific/Guam", "location": "New place", "provider_default": True, "provider_default_at": 9999999999999}})
    assert edited.status_code == 200, edited.text
    parent = await c.get(f"/api/v1/baby/records/{body['id']}", headers=headers(family))
    assert parent.json()["data"]["provider_default_at"] == timestamp
    assert parent.json()["data"]["doctor"] == "Dr Parent"
    assert parent.json()["data"]["location"] == "New place"


def test_automatic_family_moves_keep_even_cleared_paste_metadata_personal():
    from app.domains.baby.moves import stays_personal

    assert stays_personal({"paste_origin": None})
    assert stays_personal({"just_me": True})
    assert not stays_personal({"just_me": False})

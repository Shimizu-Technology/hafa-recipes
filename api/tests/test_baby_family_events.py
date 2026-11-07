"""F4m event routes follow space access, including replay and every series mutation."""
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.models import BabyMembership, BabyRecord, BabySpaceMember
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark
API = "/api/v1/baby"
START = "2026-10-20T12:00:00+10:00"


@pytest.fixture
async def series(baby_api, family):
    baby_api.settings.baby_new_kinds_enabled = True
    body = shared.payload("event", data={"timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}})
    result = await baby_api.client.post(API + "/records", headers=records.headers(family), json=body)
    assert result.status_code == 200, result.text
    return body


async def test_other_parent_edits_every_series_path_and_stamps(baby_api, family, series):
    c, h = baby_api.client, records.headers(family, "other")
    response = await c.get(API + "/events?from=2026-10-20&to=2026-10-21", headers=h)
    assert response.status_code == 200
    assert [item["event_id"] for item in response.json()["items"]] == [series["id"]] * 2
    path = f"{API}/events/{series['id']}"
    previous = 0
    for method, suffix, kwargs in (
        ("PUT", "/occurrences", {"json": {"original_start": START, "cancelled": True, "revision": 1}}),
        ("DELETE", "/occurrences", {"params": {"original_start": START, "revision": 2}}),
        ("POST", "/end-series", {"json": {"from_date": "2026-10-22", "revision": 3}}),
    ):
        response = await c.request(method, path + suffix, headers=h, **kwargs)
        assert response.status_code == 200 and response.json()["space_id"] == str(family), response.text
        async with baby_api.sessions() as db:
            row = await db.get(BabyRecord, series["id"])
            assert row.change_seq > previous
            previous = row.change_seq
    response = await c.get(API + "/events?from=2026-10-20&to=2026-10-23", headers=h)
    assert len(response.json()["items"]) == 2
    response = await c.put(path + "/occurrences", headers={**h, "X-Baby-Generation": "1"},
                           json={"original_start": START, "cancelled": True, "revision": 4})
    assert response.status_code == 409


@pytest.mark.parametrize("client", [None, "2"])
async def test_legacy_clients_cannot_read_or_edit_their_own_family_series(baby_api, family, series, client):
    c, h = baby_api.client, {**shared.GEN, **({"X-Baby-Client": client} if client else {})}
    expected = 404 if client is None else 200
    response = await c.get(API + "/events?from=2026-10-20&to=2026-10-20", headers=h)
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["items"] == []
    path = f"{API}/events/{series['id']}"
    assert (await c.put(path + "/occurrences", headers=h,
                        json={"original_start": START, "cancelled": True, "revision": 1})).status_code == 404
    assert (await c.delete(path + "/occurrences", headers=h,
                           params={"original_start": START, "revision": 1})).status_code == 404
    assert (await c.post(path + "/end-series", headers=h,
                         json={"from_date": "2026-10-22", "revision": 1})).status_code == 404


async def test_removed_creator_cannot_read_or_mutate_family_series(baby_api, family, series):
    c = baby_api.client
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "owner"))).status = "removed"
        await db.commit()
    h = records.headers(family)
    # A current client reads across the remaining spaces without needing a header.
    response = await c.get(API + "/events?from=2026-10-20&to=2026-10-20", headers={"X-Baby-Client": "3"})
    assert response.status_code == 200 and response.json()["items"] == []
    path = f"{API}/events/{series['id']}"
    assert (await c.put(path + "/occurrences", headers=h,
                        json={"original_start": START, "cancelled": True, "revision": 1})).status_code == 403
    async with baby_api.sessions() as db:
        row = await db.get(BabyRecord, series["id"])
        assert row.revision == 1 and row.data["exceptions"] == []


async def test_series_cap_counts_target_space_and_event_delete_detaches_hidden_kinds(baby_api, family, series, monkeypatch):
    from app.domains.baby import events

    c, h = baby_api.client, records.headers(family)
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    monkeypatch.setattr(events, "MAX_SERIES", 1)
    private_event = shared.payload("event", data=series["data"])
    response = await c.post(API + "/records", headers=records.headers(personal, generation=1), json=private_event)
    assert response.status_code == 200, response.text
    response = await c.post(API + "/records", headers=h, json={**private_event, "id": str(uuid4())})
    assert response.status_code == 422
    journal = shared.payload("journal", data={"event_id": series["id"]})
    question = shared.payload("question", data={"event_id": series["id"]})
    for body in (journal, question):
        assert (await c.post(API + "/records", headers=h, json=body)).status_code == 200
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    assert (await c.delete(f"{API}/records/{series['id']}?revision=1", headers=records.headers(family, "other"))).status_code == 204
    async with baby_api.sessions() as db:
        linked = list(await db.scalars(select(BabyRecord).where(BabyRecord.id.in_([journal["id"], question["id"]]))))
        assert len(linked) == 2
        assert all("event_id" not in row.data and row.revision == 2 and row.change_seq > 0 for row in linked)
        assert (await db.get(BabyRecord, private_event["id"])).deleted_at is None


async def test_build32_calendar_stays_unavailable_before_baby_enrollment(baby_api):
    from app.models.identity import AppUser

    async with baby_api.sessions() as db:
        db.add(AppUser(id="not-enrolled"))
        await db.commit()
    h = {"X-Test-Owner": "not-enrolled", **shared.GEN}
    identifier = str(uuid4())
    c = baby_api.client
    assert (await c.get(API + "/events?from=2026-10-20&to=2026-10-20", headers=h)).status_code == 404
    assert (await c.put(f"{API}/events/{identifier}/occurrences", headers=h,
                        json={"original_start": START, "cancelled": True, "revision": 1})).status_code == 404
    assert (await c.delete(f"{API}/events/{identifier}/occurrences", headers=h,
                           params={"original_start": START, "revision": 1})).status_code == 404
    assert (await c.post(f"{API}/events/{identifier}/end-series", headers=h,
                         json={"from_date": "2026-10-22", "revision": 1})).status_code == 404


async def test_visit_series_writers_keep_medical_and_contributor_protection(baby_api, family):
    baby_api.settings.baby_new_kinds_enabled = True
    c = baby_api.client
    source = {"text": "Visit words", "start": 0, "end": 11, "original": False}
    body = shared.payload("event", body="Medical notes", data={"category": "appointment", "timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}, "paste_origin": source, "results": "Medical result"})
    saved = await c.post(API + "/records", headers=records.headers(family), json=body)
    assert saved.status_code == 200, saved.text
    path = f"{API}/events/{body['id']}"
    replacement = {**body, "id": str(uuid4()), "occurred_at": "2026-10-21T12:00:00+10:00", "data": {"category": "appointment", "timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}}}
    split = {"revision": 1, "from_start": "2026-10-21T12:00:00+10:00", "event": replacement}
    denied = await c.post(path + "/split", headers=records.headers(family, "other"), json=split)
    assert denied.status_code == 403, denied.text
    replacement["data"]["paste_origin"] = source
    allowed = await c.post(path + "/split", headers=records.headers(family, "other"), json=split)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["event"]["created_by"] == "owner"
    async with baby_api.sessions() as db:
        member = await db.get(BabySpaceMember, (family, "other"))
        member.role = "caregiver"
        await db.commit()
    occurrence = await c.put(path + "/occurrences", headers=records.headers(family, "other"), json={"revision": 2, "original_start": START, "overrides": {"category": "other"}})
    assert occurrence.status_code == 403, occurrence.text


async def test_caregiver_future_split_restores_hidden_source_before_contributor_check(baby_api, family):
    baby_api.settings.baby_new_kinds_enabled = True
    c = baby_api.client
    source = {"text": "Visit words", "start": 0, "end": 11, "original": False}
    body = shared.payload("event", body="Medical notes", data={"category": "appointment", "timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}, "paste_origin": source, "results": "Medical result"})
    assert (await c.post(API + "/records", headers=records.headers(family), json=body)).status_code == 200
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    replacement = {**body, "id": str(uuid4()), "body": "", "occurred_at": "2026-10-21T12:00:00+10:00", "data": {"category": "appointment", "timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}}}
    result = await c.post(f"{API}/events/{body['id']}/split", headers=records.headers(family, "other"), json={"revision": 1, "from_start": replacement["occurred_at"], "event": replacement})
    assert result.status_code == 200, result.text
    parent = await c.get(f"{API}/records/{replacement['id']}", headers=records.headers(family))
    assert parent.json()["data"]["paste_origin"] == source
    assert parent.json()["body"] == "Medical notes"
    assert parent.json()["data"]["results"] == "Medical result"

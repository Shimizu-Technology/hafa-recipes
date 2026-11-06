"""Her own name for a kind of event: free text beside the fixed categories, and it survives older builds."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.domains.baby.schemas import EventData, RecordCreate
from tests import test_baby_integration as shared
from tests.test_baby_events import allow_events, save

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
API = "/api/v1/baby"
V2 = {**shared.GEN, "X-Baby-Client": "2"}
START = "2026-11-10T09:00:00+10:00"
GUAM = {"timezone": "Pacific/Guam"}


def valid(**data):
    return RecordCreate.model_validate({"kind": "event", "title": "Oil change", "occurred_at": START, "data": {**GUAM, **data}})


def test_a_label_is_kept_trimmed_beside_the_fixed_category():
    data = valid(category="other", category_label="  Car stuff ").data
    assert data["category"] == "other" and data["category_label"] == "Car stuff"


def test_a_blank_label_is_no_label_and_an_event_without_one_stores_what_it_always_did():
    assert "category_label" not in valid(category_label="   ").data
    assert "category_label" not in valid(category_label=None).data
    # Unchanged, so a retried save of an older event keeps its creation hash.
    assert "category_label" not in EventData(timezone="Pacific/Guam").model_dump(mode="json")


def test_a_label_has_a_limit_on_what_is_left_after_trimming():
    assert valid(category_label="x" * 60).data["category_label"] == "x" * 60
    assert valid(category_label=f"  {'x' * 60}  ").data["category_label"] == "x" * 60
    assert valid(**overrides(category_label=f" {'x' * 60} ")).data["exceptions"][0]["overrides"] == {"category_label": "x" * 60}
    with pytest.raises(ValidationError):
        valid(**overrides(category_label="x" * 61))
    with pytest.raises(ValidationError):
        valid(category_label="x" * 61)
    with pytest.raises(ValidationError):
        valid(category_label=12)


def overrides(**fields):
    return {"recurrence": {"frequency": "daily"}, "exceptions": [{"original_start": "2026-11-11T09:00:00+10:00", "overrides": fields}]}


def test_one_date_can_have_its_own_label_or_clear_it():
    data = valid(**overrides(category_label=" Car ")).data
    assert data["exceptions"][0]["overrides"] == {"category_label": "Car"}
    assert valid(**overrides(category_label=None)).data["exceptions"][0]["overrides"] == {"category_label": None}
    # Blank means none, and a date that says so has cleared it.
    assert valid(**overrides(category_label="   ")).data["exceptions"][0]["overrides"] == {"category_label": None}


@needs_database
async def test_an_occurrence_carries_the_label_and_a_date_can_change_it(baby_api):
    await allow_events(baby_api)
    data = {**GUAM, "category": "other", "category_label": "Car", **overrides(category_label="Tires")}
    saved, _ = await save(baby_api, "event", occurred_at=START, data=data)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["category_label"] == "Car"
    listed = await baby_api.client.get(f"{API}/events", params={"from": "2026-11-10", "to": "2026-11-11"}, headers=V2)
    assert listed.status_code == 200, listed.text
    assert [(item["category"], item["category_label"]) for item in listed.json()["items"]] == [("other", "Car"), ("other", "Tires")]


@needs_database
async def test_a_date_with_a_blank_label_reads_as_none(baby_api):
    await allow_events(baby_api)
    data = {**GUAM, "category": "other", "category_label": "Car", **overrides(category_label="  ")}
    assert (await save(baby_api, "event", occurred_at=START, data=data))[0].status_code == 200
    listed = await baby_api.client.get(f"{API}/events", params={"from": "2026-11-10", "to": "2026-11-11"}, headers=V2)
    assert [item["category_label"] for item in listed.json()["items"]] == ["Car", None]


@needs_database
async def test_an_occurrence_without_a_label_says_so(baby_api):
    await allow_events(baby_api)
    assert (await save(baby_api, "event", occurred_at=START, data={**GUAM, "category": "family"}))[0].status_code == 200
    listed = await baby_api.client.get(f"{API}/events", params={"from": "2026-11-10", "to": "2026-11-11"}, headers=V2)
    assert [item["category_label"] for item in listed.json()["items"]] == [None]


@needs_database
async def test_an_older_build_sending_back_what_it_read_keeps_the_label(baby_api):
    # PATCH replaces `data`. Builds 34 to 36 spread what they read, so an unknown key comes back as it went out.
    await allow_events(baby_api)
    c = baby_api.client
    saved, _ = await save(baby_api, "event", occurred_at=START, data={**GUAM, "category": "other", "category_label": "Car"})
    read = saved.json()
    assert saved.status_code == 200, saved.text
    changed = await c.patch(f"{API}/records/{read['id']}", headers=V2, json={"revision": read["revision"], "title": "Oil and tires", "data": {**read["data"], "location": "Shop"}})
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["category_label"] == "Car" and changed.json()["data"]["location"] == "Shop"


@needs_database
async def test_an_event_that_never_had_a_label_reads_and_replays_as_before(baby_api):
    await allow_events(baby_api)
    identity = str(uuid4())
    first, body = await save(baby_api, "event", id=identity, occurred_at=START, data=GUAM)
    assert first.status_code == 200 and "category_label" not in first.json()["data"]
    again = await baby_api.client.post(f"{API}/records", headers={**V2, "X-Test-Owner": "owner"}, json=body)
    assert again.status_code == 200 and again.json()["id"] == identity

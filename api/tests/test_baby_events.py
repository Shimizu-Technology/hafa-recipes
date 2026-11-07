"""Calendar events: what a valid one is, and the questions and notes that point at one."""

from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text

from app.domains.baby.models import BabyRecord
from app.domains.baby.schemas import NEW_KINDS, V1_KINDS, EventData, RecordCreate
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
API = "/api/v1/baby"
V2 = {**shared.GEN, "X-Baby-Client": "2"}
START = "2026-11-10T09:00:00+10:00"
END = "2026-11-10T10:00:00+10:00"
GUAM = {"timezone": "Pacific/Guam"}


def event(data=None, **changes):
    return {"kind": "event", "title": "Check-up", "occurred_at": START, "data": {**GUAM, **(data or {})}, **changes}


def valid(data=None, **changes):
    return RecordCreate.model_validate(event(data, **changes))


@pytest.mark.parametrize("category", ["appointment", "family", "celebration", "milestone", "reminder", "other"])
def test_every_category_is_accepted(category):
    assert valid({"category": category}).data["category"] == category


def test_a_full_event_round_trips():
    data = valid({
        "end": END, "category": "appointment", "location": " Clinic ", "attendees": [" Kami ", "Leon"],
        "recurrence": {"frequency": "weekly", "interval": 2, "until": "2027-01-01"},
        "exceptions": [{"original_start": "2026-11-24T09:00:00+10:00", "cancelled": True}],
    }).data
    assert data["location"] == "Clinic" and data["attendees"] == ["Kami", "Leon"]
    assert data["recurrence"] == {"frequency": "weekly", "interval": 2, "until": "2027-01-01"}


@pytest.mark.parametrize(
    "data",
    [
        {"category": "birthday"},
        {"category": "Appointment"},
        {"end": START},  # Ends the moment it starts.
        {"end": "2026-11-10T08:59:00+10:00"},
        {"end": "2026-11-10T08:30:00+11:00"},  # Before the start once offsets are applied.
        {"end": "2027-11-12T09:00:00+10:00"},  # Longer than a year.
        {"attendees": ["Kami", " kami"]},
        {"attendees": ["  "]},
        {"recurrence": {"frequency": "monthly", "until": "2026-11-09"}},  # Ends before it starts.
        {"recurrence": {"frequency": "monthly", "until": "2101-01-01"}},
        {"recurrence": {"frequency": "daily", "interval": 100}},
        {"recurrence": {"frequency": "daily", "interval": True}},
        {"recurrence": {"frequency": "daily"}, "exceptions": [
            {"original_start": "2026-11-09T09:00:00+10:00", "cancelled": True},  # Before the series.
        ]},
        {"exceptions": [{"original_start": "2026-11-17T09:00:00+10:00", "cancelled": True}]},  # Not repeating.
        {"recurrence": {"frequency": "daily"}, "exceptions": [
            {"original_start": "2026-11-11T09:00:00+10:00", "overrides": {}},
        ]},
        {"recurrence": {"frequency": "daily"}, "exceptions": [
            {"original_start": "2026-11-11T09:00:00+10:00", "overrides": {"category": "party"}},
        ]},
        {"recurrence": {"frequency": "daily"}, "exceptions": [
            {"original_start": "2026-11-11T09:00:00+10:00", "overrides": {"start": START, "end": START}},
        ]},
        {"recurrence": {"frequency": "daily"}, "exceptions": [
            {"original_start": "2026-11-11T09:00:00+10:00", "overrides": {"all_day": True}},
        ]},
        {"timezone": "Mars/Base"},
        {"timezone": ""},
    ],
)
def test_incomplete_or_contradictory_events_are_refused(data):
    with pytest.raises(ValidationError):
        valid(data)


@pytest.mark.parametrize("start", ["1999-12-31T09:00:00+10:00", "2101-01-01T09:00:00+10:00"])
def test_a_start_outside_the_calendar_years_is_refused(start):
    with pytest.raises(ValidationError):
        valid(occurred_at=start)


def test_the_year_is_read_on_the_events_own_calendar():
    # 23:00 on Dec 31, 2100 in New York is already 2101 in UTC.
    assert valid({"timezone": "America/New_York"}, occurred_at="2100-12-31T23:00:00-05:00")


def test_a_title_is_still_required():
    with pytest.raises(ValidationError):
        valid(title="  ")


def test_all_day_events_start_and_end_at_midnight_on_their_own_calendar():
    midnight = "2026-11-12T00:00:00+10:00"
    assert valid({"all_day": True}, occurred_at=midnight)
    assert valid({"all_day": True, "end": "2026-11-14T00:00:00+10:00"}, occurred_at=midnight)
    for start, end in [(START, None), (midnight, "2026-11-13T12:00:00+10:00"), (midnight, midnight)]:
        with pytest.raises(ValidationError):
            valid({"all_day": True, **({"end": end} if end else {})}, occurred_at=start)
    # Midnight in Guam is the afternoon before in UTC: the calendar that counts is the event's.
    utc = "2026-11-11T14:00:00Z"
    assert valid({"all_day": True}, occurred_at=utc)
    with pytest.raises(ValidationError):
        valid({"all_day": True, "timezone": "UTC"}, occurred_at=utc)


def test_an_occurrence_can_move_or_change_without_leaving_the_rules():
    series = {"recurrence": {"frequency": "daily"}, "end": END}
    original = "2026-11-11T09:00:00+10:00"
    good = [
        {"title": "Moved", "location": "Home"},
        {"start": "2026-11-11T14:00:00+10:00", "end": "2026-11-11T15:00:00+10:00"},
        {"start": "2026-11-11T00:00:00+10:00", "all_day": True},
    ]
    for overrides in good:
        assert valid({**series, "exceptions": [{"original_start": original, "overrides": overrides}]})
    with pytest.raises(ValidationError):
        valid({**series, "exceptions": [{"original_start": original, "overrides": {
            "start": "2026-11-11T14:00:00+10:00", "all_day": True,  # Not midnight.
        }}]})


def test_events_are_a_new_kind_and_question_and_journal_gain_only_an_optional_link():
    assert "event" in NEW_KINDS and "event" not in V1_KINDS
    assert set(EventData.model_fields) == {
        "end", "all_day", "timezone", "category", "location", "attendees", "recurrence", "exceptions",
        "attachment_ids", "reminder_minutes", "category_label",
        "provider_default_at", "provider_default", "paste_origin", "clinician_age", "doctor", "due_date_snapshot", "results", "result_status", "follow_up",
    }
    plain = RecordCreate.model_validate({"kind": "question", "title": "Q", "occurred_at": START, "data": {}})
    # An unlinked question looks exactly as it did before, so replays keep their hash.
    assert plain.data == {"attachment_ids": [], "provenance": "caregiver_observation"}
    with pytest.raises(ValidationError):
        RecordCreate.model_validate({"kind": "question", "title": "Q", "occurred_at": START, "data": {"event_id": "nope"}})


async def allow_events(baby_api):
    async with baby_api.engine.begin() as db:
        await db.execute(text("ALTER TABLE baby_records DROP CONSTRAINT IF EXISTS ck_baby_record_kind"))
        await db.execute(text(f"""ALTER TABLE baby_records ADD CONSTRAINT ck_baby_record_kind
            CHECK (kind IN ({", ".join(f"'{kind}'" for kind in (*V1_KINDS, *NEW_KINDS))}))"""))
    baby_api.settings.baby_new_kinds_enabled = True


async def save(baby_api, kind, headers=V2, owner="owner", **changes):
    body = shared.payload(kind, **changes)
    response = await baby_api.client.post(f"{API}/records", headers={**headers, "X-Test-Owner": owner}, json=body)
    return response, body


@needs_database
async def test_events_save_with_a_child_or_for_the_whole_family(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    child = str(uuid4())
    await c.post(f"{API}/children", headers=shared.GEN, json={"id": child, "name": "Noa"})
    family, _ = await save(baby_api, "event", occurred_at=START, data=GUAM)
    own, _ = await save(baby_api, "event", occurred_at=START, data=GUAM, child_id=child)
    assert family.status_code == own.status_code == 200
    assert family.json()["child_id"] is None and own.json()["child_id"] == child
    # A child that is not this owner's is refused, as for any record.
    other, _ = await save(baby_api, "event", occurred_at=START, data=GUAM, child_id=str(uuid4()))
    assert other.status_code == 404
    bad, _ = await save(baby_api, "event", occurred_at=START, data={**GUAM, "end": START})
    assert bad.status_code == 422


@needs_database
async def test_a_question_or_note_can_point_at_an_event_of_the_owner(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    saved, _ = await save(baby_api, "event", occurred_at=START, data=GUAM)
    event_id = saved.json()["id"]
    question, body = await save(baby_api, "question", data={"event_id": event_id})
    assert question.status_code == 200 and question.json()["data"]["event_id"] == event_id
    note, _ = await save(baby_api, "journal", data={"event_id": event_id, "provenance": "clinician_instruction"})
    assert note.status_code == 200 and note.json()["data"]["provenance"] == "clinician_instruction"
    # A replay is the same save.
    assert (await c.post(f"{API}/records", headers=V2, json=body)).status_code == 200

    # Not an event, not found, someone else's, or removed: none can be linked.
    not_event, _ = await save(baby_api, "journal")
    for target in (not_event.json()["id"], str(uuid4())):
        assert (await save(baby_api, "question", data={"event_id": target}))[0].status_code in {404, 422}
    theirs, _ = await save(baby_api, "event", owner="other", occurred_at=START, data=GUAM)
    assert (await save(baby_api, "question", data={"event_id": theirs.json()["id"]}))[0].status_code == 404
    gone, _ = await save(baby_api, "event", occurred_at=START, data=GUAM)
    assert (await c.delete(f"{API}/records/{gone.json()['id']}", headers=V2, params={"revision": 1})).status_code == 204
    assert (await save(baby_api, "question", data={"event_id": gone.json()["id"]}))[0].status_code == 404


@needs_database
async def test_the_link_can_be_changed_cleared_and_survives_an_older_client(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    first = (await save(baby_api, "event", occurred_at=START, data=GUAM))[0].json()["id"]
    second = (await save(baby_api, "event", occurred_at=START, data=GUAM))[0].json()["id"]
    question = (await save(baby_api, "question", data={"event_id": first}))[0].json()
    url = f"{API}/records/{question['id']}"
    # An older build edits the text without knowing the link.
    older = await c.patch(url, headers=shared.GEN, json={"revision": 1, "title": "Reworded", "data": {}})
    assert older.status_code == 200 and older.json()["data"]["event_id"] == first
    # It cannot set one.
    assert (await c.patch(url, headers=shared.GEN, json={"revision": 2, "data": {"event_id": second}})).status_code == 422
    assert (await save(baby_api, "question", headers=shared.GEN, data={"event_id": first}))[0].status_code == 422
    moved = await c.patch(url, headers=V2, json={"revision": 2, "data": {"event_id": second}})
    assert moved.json()["data"]["event_id"] == second
    cleared = await c.patch(url, headers=V2, json={"revision": 3, "data": {"event_id": None}})
    assert "event_id" not in cleared.json()["data"]
    unreadable = await c.patch(url, headers=V2, json={"revision": 4, "data": {"event_id": str(uuid4())}})
    assert unreadable.status_code == 404


@needs_database
async def test_deleting_an_event_keeps_its_questions_and_notes_but_not_the_link(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    event_id = (await save(baby_api, "event", occurred_at=START, data=GUAM))[0].json()["id"]
    other_id = (await save(baby_api, "event", occurred_at=START, data=GUAM))[0].json()["id"]
    question = (await save(baby_api, "question", title="Ask about sleep", data={"event_id": event_id}))[0].json()
    note = (await save(baby_api, "journal", data={"event_id": event_id, "provenance": "clinician_instruction"}))[0].json()
    unrelated = (await save(baby_api, "question", data={"event_id": other_id}))[0].json()
    assert (await c.delete(f"{API}/records/{event_id}", headers=V2, params={"revision": 1})).status_code == 204
    for record, linked in ((question, False), (note, False), (unrelated, True)):
        row = (await c.get(f"{API}/records/{record['id']}", headers=V2)).json()
        assert ("event_id" in row["data"]) is linked
        assert row["revision"] == (1 if linked else 2)
    assert (await c.get(f"{API}/records/{question['id']}", headers=V2)).json()["title"] == "Ask about sleep"
    assert (await c.get(f"{API}/records/{note['id']}", headers=V2)).json()["data"]["provenance"] == "clinician_instruction"
    async with baby_api.sessions() as db:
        assert await db.scalar(select(BabyRecord.deleted_at).where(BabyRecord.id == event_id)) is not None


WEEKLY = {"frequency": "weekly"}
NOV_8 = "2026-11-08T09:00:00+10:00"  # Sundays, like the series' first day, Nov 1.
NOV_15 = "2026-11-15T09:00:00+10:00"
NOV_22 = "2026-11-22T09:00:00+10:00"
NOV_9 = "2026-11-09T09:00:00+10:00"


async def weekly_with_cancelled(baby_api, *dates):
    """A weekly series from Sunday Nov 1 with the given occurrences cancelled."""
    exceptions = [{"original_start": day, "cancelled": True} for day in dates]
    saved, _ = await save(
        baby_api, "event", occurred_at="2026-11-01T09:00:00+10:00",
        data={**GUAM, "recurrence": WEEKLY, "exceptions": exceptions},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


@needs_database
async def test_a_series_can_start_later_than_a_change_it_already_has(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    series = await weekly_with_cancelled(baby_api, NOV_8, NOV_22)
    url = f"{API}/records/{series['id']}"
    later = await c.patch(url, headers=V2, json={"revision": 1, "occurred_at": NOV_15, "data": series["data"]})
    assert later.status_code == 200, later.text
    # Nov 8 is before the new start and goes; Nov 22 is still one of its dates and stays.
    assert [item["original_start"] for item in later.json()["data"]["exceptions"]] == [NOV_22]
    assert later.json()["revision"] == 2
    # Starting on Monday the 9th gives it different weekdays, so no old change belongs to it.
    monday = await c.patch(url, headers=V2, json={"revision": 2, "occurred_at": NOV_9, "data": series["data"]})
    assert monday.status_code == 200, monday.text
    assert monday.json()["data"]["exceptions"] == []


@needs_database
async def test_changing_the_repeat_drops_only_the_changes_it_leaves_behind(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    series = await weekly_with_cancelled(baby_api, NOV_8, NOV_15, NOV_22)
    url = f"{API}/records/{series['id']}"
    revision = 0

    async def edit(**changes):
        nonlocal revision
        revision += 1
        data = {**series["data"], **changes.pop("data", {})}
        response = await c.patch(url, headers=V2, json={"revision": revision, "data": data, **changes})
        assert response.status_code == 200, response.text
        return [item["original_start"] for item in response.json()["data"]["exceptions"]]

    assert await edit(data={"recurrence": {**WEEKLY, "until": "2026-11-15"}}) == [NOV_8, NOV_15]
    assert await edit(data={"recurrence": {"frequency": "weekly", "interval": 2}}) == [NOV_15]
    assert await edit(data={"exceptions": [{"original_start": NOV_8, "cancelled": True}]}) == [NOV_8]
    # A different time of day gives every date a new start.
    assert await edit(occurred_at="2026-11-01T10:00:00+10:00") == []
    # No longer repeating: nothing is left to change.
    assert await edit(data={"recurrence": None}) == []


@needs_database
async def test_a_patch_that_fails_leaves_the_changes_in_place(baby_api):
    await allow_events(baby_api)
    c = baby_api.client
    series = await weekly_with_cancelled(baby_api, NOV_8)
    url = f"{API}/records/{series['id']}"
    refused = await c.patch(url, headers=V2, json={
        "revision": 1, "occurred_at": NOV_15, "data": {**series["data"], "end": "2026-11-15T08:00:00+10:00"},
    })
    assert refused.status_code == 422
    stored = (await c.get(url, headers=V2)).json()
    assert stored["revision"] == 1 and len(stored["data"]["exceptions"]) == 1


def overrides(**fields):
    return {"recurrence": {"frequency": "daily"}, "exceptions": [
        {"original_start": "2026-11-11T09:00:00+10:00", "overrides": fields}]}


@pytest.mark.parametrize(
    "fields",
    [
        {"all_day": None, "title": "x"},
        {"title": None, "location": "Home"},
        {"attendees": None, "location": "Home"},
        {"start": None, "location": "Home"},
        {"all_day": None},
        {"title": "   "},
    ],
)
def test_an_explicit_null_is_refused_where_a_value_is_required(fields):
    with pytest.raises(ValidationError):
        valid(overrides(**fields))


def test_an_explicit_null_clears_what_can_be_empty_and_is_remembered_as_such():
    data = valid(overrides(end=None, category=None, location=None)).data
    assert data["exceptions"][0]["overrides"] == {"end": None, "category": None, "location": None}
    # Leaving a field out is not clearing it, and is stored that way: only what was said is kept.
    data = valid(overrides(title="Moved", attendees=[])).data
    assert data["exceptions"][0]["overrides"] == {"title": "Moved", "attendees": []}
    again = valid(data).data
    assert again == data


def test_a_change_that_only_clears_something_is_still_a_change():
    assert valid(overrides(location=None))
    with pytest.raises(ValidationError):
        valid(overrides())

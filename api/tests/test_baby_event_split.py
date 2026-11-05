"""Changing a repeat from one date on is one step, and a question stays with its own child's visits."""
from datetime import UTC, date, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.domains.baby import events as baby_events
from app.domains.baby.events import occurrences_of
from app.domains.baby.models import BabyRecord
from app.domains.baby.recurrence import starts_between
from app.domains.baby.schemas import RecordCreate
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests.test_baby_events import allow_events, save

API = "/api/v1/baby"
V2 = {**shared.GEN, "X-Baby-Client": "2"}
GUAM = {"timezone": "Pacific/Guam"}
WEEKLY = {"frequency": "weekly"}
family = foundation.family
baby_api = foundation.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


def replacement(start, **changes):
    data = changes.pop("data", {**GUAM, "recurrence": WEEKLY})
    return {"id": str(uuid4()), "kind": "event", "title": "New name", "occurred_at": start, "data": data, **changes}


async def series(baby_api, start="2026-11-01T09:00:00+10:00", recurrence=WEEKLY, **data):
    saved, _ = await save(baby_api, "event", occurred_at=start, data={**GUAM, "recurrence": recurrence, **data})
    assert saved.status_code == 200, saved.text
    return saved.json()


async def split(baby_api, row, start, event, headers=V2, revision=None):
    return await baby_api.client.post(
        f"{API}/events/{row['id']}/split", headers=headers,
        json={"revision": revision or row["revision"], "from_start": start, "event": event},
    )


async def stored(baby_api, identifier):
    async with baby_api.sessions() as db:
        return await db.scalar(
            select(BabyRecord).where(BabyRecord.id == identifier).execution_options(populate_existing=True)
        )


async def starts(baby_api, first, last, headers=V2):
    response = await baby_api.client.get(f"{API}/events?from={first}&to={last}", headers=headers)
    assert response.status_code == 200, response.text
    return [(item["occurrence_start"], item["title"]) for item in response.json()["items"]]


@needs_database
async def test_a_split_ends_the_series_and_starts_the_next_in_one_step(baby_api):
    await allow_events(baby_api)
    row = await series(baby_api, exceptions=[
        {"original_start": "2026-11-08T09:00:00+10:00", "cancelled": True},
        {"original_start": "2026-11-22T09:00:00+10:00", "cancelled": True},
    ])
    event = replacement("2026-11-15T09:00:00+10:00")
    event["data"]["exceptions"] = [{"original_start": "2026-11-22T09:00:00+10:00", "cancelled": True}]
    response = await split(baby_api, row, "2026-11-15T09:00:00+10:00", event)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["series"]["revision"] == row["revision"] + 1
    assert body["series"]["data"]["recurrence"]["until"] == "2026-11-14"
    assert [item["original_start"] for item in body["series"]["data"]["exceptions"]] == ["2026-11-08T09:00:00+10:00"]
    assert body["event"]["id"] == event["id"] and body["event"]["revision"] == 1
    assert await starts(baby_api, "2026-11-01", "2026-11-29") == [
        ("2026-11-01T09:00:00+10:00", "Notes"),
        ("2026-11-15T09:00:00+10:00", "New name"),
        ("2026-11-29T09:00:00+10:00", "New name"),
    ]


@needs_database
async def test_a_retry_after_a_lost_answer_is_the_same_split(baby_api):
    await allow_events(baby_api)
    row = await series(baby_api)
    event = replacement("2026-11-15T09:00:00+10:00")
    first = await split(baby_api, row, "2026-11-15T09:00:00+10:00", event)
    assert first.status_code == 200, first.text
    again = await split(baby_api, row, "2026-11-15T09:00:00+10:00", event)
    assert again.status_code == 200, again.text
    assert again.json()["event"]["revision"] == 1
    assert again.json()["series"]["revision"] == row["revision"] + 1
    async with baby_api.sessions() as db:
        assert len(list(await db.scalars(select(BabyRecord).where(BabyRecord.kind == "event")))) == 2
    # Even if the first half has since been deleted, the new series is what she asked for.
    removed = await baby_api.client.delete(f"{API}/records/{row['id']}?revision={row['revision'] + 1}", headers=V2)
    assert removed.status_code == 204, removed.text
    again = await split(baby_api, row, "2026-11-15T09:00:00+10:00", event)
    assert again.status_code == 200 and again.json()["series"] is None and again.json()["event"]["id"] == event["id"]


@needs_database
async def test_a_used_id_with_other_content_or_a_removed_series_is_refused(baby_api):
    await allow_events(baby_api)
    row = await series(baby_api)
    event = replacement("2026-11-15T09:00:00+10:00")
    assert (await split(baby_api, row, "2026-11-15T09:00:00+10:00", event)).status_code == 200
    changed = await split(baby_api, row, "2026-11-15T09:00:00+10:00", {**event, "title": "Other"})
    assert changed.status_code == 409
    moved = await split(baby_api, row, "2026-11-22T09:00:00+10:00", event)
    assert moved.status_code == 409
    removed = await baby_api.client.delete(f"{API}/records/{event['id']}?revision=1", headers=V2)
    assert removed.status_code == 204
    assert (await split(baby_api, row, "2026-11-15T09:00:00+10:00", event)).status_code == 410


@needs_database
async def test_a_refused_split_changes_nothing(baby_api, monkeypatch):
    await allow_events(baby_api)
    row = await series(baby_api)
    start = "2026-11-15T09:00:00+10:00"

    async def untouched(event, expected):
        response = await split(baby_api, row, start, event, revision=row["revision"])
        assert response.status_code == expected, response.text
        assert await stored(baby_api, event["id"]) is None
        kept = await stored(baby_api, row["id"])
        assert kept.revision == row["revision"] and kept.data == row["data"]

    # Her new details are not valid, and so the old dates stay.
    await untouched(replacement(start, data={**GUAM, "end": "2026-11-15T08:00:00+10:00"}), 422)
    await untouched(replacement(start, kind="question"), 422)
    # The child is not hers.
    await untouched(replacement(start, child_id=str(uuid4())), 404)
    # The limit on repeating events counts the new one.
    monkeypatch.setattr(baby_events, "MAX_SERIES", 1)
    await untouched(replacement(start), 422)
    monkeypatch.setattr(baby_events, "MAX_SERIES", 200)
    # Someone else changed the series first.
    response = await split(baby_api, row, start, replacement(start), revision=row["revision"] + 1)
    assert response.status_code == 409
    # Not one of its dates, and from the first date there's nothing left to keep.
    for at in ("2026-11-16T09:00:00+10:00", "2026-11-01T09:00:00+10:00"):
        response = await split(baby_api, row, at, replacement(at))
        assert response.status_code == 422, response.text
    # Starting a week before the split would list November 8 from both halves; an earlier hour that day is fine.
    await untouched(replacement("2026-11-08T09:00:00+10:00"), 422)
    # A commit that fails leaves neither half.
    event = replacement(start)

    async def broken_commit(self):
        raise RuntimeError("commit failed")

    monkeypatch.setattr("sqlalchemy.ext.asyncio.AsyncSession.commit", broken_commit)
    with pytest.raises(RuntimeError):
        await split(baby_api, row, start, event)
    monkeypatch.undo()
    assert await stored(baby_api, event["id"]) is None
    assert (await stored(baby_api, row["id"])).revision == row["revision"]


@needs_database
async def test_a_split_can_move_the_time_earlier_on_the_same_day(baby_api):
    await allow_events(baby_api)
    row = await series(baby_api)
    start = "2026-11-15T09:00:00+10:00"
    response = await split(baby_api, row, start, replacement("2026-11-15T07:30:00+10:00"))
    assert response.status_code == 200, response.text
    assert await starts(baby_api, "2026-11-08", "2026-11-15") == [
        ("2026-11-08T09:00:00+10:00", row["title"]), ("2026-11-15T07:30:00+10:00", "New name"),
    ]


@needs_database
async def test_a_series_that_does_not_repeat_or_is_not_an_event_cannot_split(baby_api):
    await allow_events(baby_api)
    single, _ = await save(baby_api, "event", occurred_at="2026-11-01T09:00:00+10:00", data=GUAM)
    question, _ = await save(baby_api, "question", occurred_at="2026-11-01T09:00:00+10:00", data={})
    start = "2026-11-15T09:00:00+10:00"
    assert (await split(baby_api, single.json(), start, replacement(start))).status_code == 422
    assert (await split(baby_api, question.json(), start, replacement(start))).status_code == 404


# Family spaces


@pytest.fixture
async def family_series(baby_api, family):
    baby_api.settings.baby_new_kinds_enabled = True
    body = shared.payload("event", occurred_at="2026-11-01T09:00:00+10:00", data={**GUAM, "recurrence": WEEKLY})
    response = await baby_api.client.post(f"{API}/records", headers=records.headers(family), json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def test_the_other_parent_splits_in_the_family_space_and_both_are_stamped(baby_api, family, family_series):
    start = "2026-11-15T09:00:00+10:00"
    event = replacement(start)
    h = records.headers(family, "other")
    response = await split(baby_api, family_series, start, event, headers=h)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["series"]["space_id"] == str(family) and body["event"]["space_id"] == str(family)
    kept, added = await stored(baby_api, family_series["id"]), await stored(baby_api, event["id"])
    assert kept.space_id == added.space_id == family
    assert kept.change_seq and added.change_seq and added.change_seq != kept.change_seq
    assert (await split(baby_api, family_series, start, event, headers=h)).status_code == 200
    response = await split(baby_api, family_series, start, replacement(start),
                           headers={**h, "X-Baby-Generation": "99"})
    assert response.status_code == 409


@pytest.mark.parametrize("client", [None, "2"])
async def test_older_clients_cannot_split_a_family_series(baby_api, family, family_series, client):
    start = "2026-11-15T09:00:00+10:00"
    event = replacement(start)
    headers = {**shared.GEN, **({"X-Baby-Client": client} if client else {})}
    response = await split(baby_api, family_series, start, event, headers=headers)
    assert response.status_code == 404, response.text
    assert await stored(baby_api, event["id"]) is None


@needs_database
async def test_build_32_does_not_have_the_route_even_for_its_own_records(baby_api):
    await allow_events(baby_api)
    row = await series(baby_api)
    start = "2026-11-15T09:00:00+10:00"
    event = replacement(start)
    assert (await split(baby_api, row, start, event, headers=shared.GEN)).status_code == 404
    assert await stored(baby_api, event["id"]) is None


@needs_database
async def test_someone_elses_series_is_unavailable(baby_api):
    await allow_events(baby_api)
    row = await series(baby_api)
    start = "2026-11-15T09:00:00+10:00"
    response = await split(baby_api, row, start, replacement(start), headers={**V2, "X-Test-Owner": "other"})
    assert response.status_code == 404
    # A replay of someone else's id is no way in either.
    event = replacement(start)
    assert (await split(baby_api, row, start, event)).status_code == 200
    theirs = await series_for(baby_api, "other")
    response = await split(baby_api, theirs, start, event, headers={**V2, "X-Test-Owner": "other"})
    # With family on it's simply not theirs to see; with it off the id is refused as used.
    expected = 404 if baby_api.settings.baby_family_enabled else 409
    assert response.status_code == expected and "New name" not in response.text


async def series_for(baby_api, owner):
    saved, _ = await save(baby_api, "event", owner=owner, occurred_at="2026-11-01T09:00:00+10:00",
                          data={**GUAM, "recurrence": WEEKLY})
    assert saved.status_code == 200, saved.text
    return saved.json()


# The rule's first date is kept apart from where this part of the series begins.

def expanded(start, recurrence, first, last, zone="Pacific/Guam"):
    row = BabyRecord(id=uuid4(), title="Event", child_id=None, occurred_at=datetime.fromisoformat(start), revision=1,
                     data={"timezone": zone, "recurrence": recurrence})
    place = ZoneInfo(zone)
    lo, hi = datetime.combine(first, datetime.min.time(), place), datetime.combine(last, datetime.min.time(), place)
    return [item.original.astimezone(place).date().isoformat() for item in occurrences_of(row, lo, hi)]


def test_a_month_end_series_goes_on_from_feb_28_to_march_31():
    rule = {"frequency": "monthly", "anchor": "2027-01-31"}
    assert expanded("2027-02-28T09:00:00+10:00", rule, date(2027, 1, 1), date(2027, 6, 1)) == [
        "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31",
    ]


def test_every_other_month_keeps_its_months_from_the_first_date():
    rule = {"frequency": "monthly", "interval": 2, "anchor": "2027-01-31"}
    assert expanded("2027-09-30T09:00:00+10:00", rule, date(2027, 1, 1), date(2028, 2, 1)) == [
        "2027-09-30", "2027-11-30", "2028-01-31",
    ]


def test_a_leap_day_birthday_goes_on_from_feb_28():
    rule = {"frequency": "yearly", "anchor": "2028-02-29"}
    assert expanded("2029-02-28T09:00:00+10:00", rule, date(2028, 1, 1), date(2033, 1, 1)) == [
        "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29",
    ]


@pytest.mark.parametrize(("start", "anchor"), [
    ("2027-03-15T09:00:00+10:00", "2027-01-31"),  # Not a date the rule gives.
    ("2027-01-31T09:00:00+10:00", "2027-02-28"),  # After the start.
    ("2027-01-31T09:00:00+10:00", "1999-01-31"),  # Outside the calendar years.
])
def test_a_first_date_must_lead_to_the_start(start, anchor):
    with pytest.raises(ValidationError):
        RecordCreate.model_validate({
            "kind": "event", "title": "Rent", "occurred_at": start,
            "data": {**GUAM, "recurrence": {"frequency": "monthly", "anchor": anchor}},
        })


@needs_database
async def test_a_split_keeps_the_rule_through_the_api(baby_api):
    await allow_events(baby_api)
    monthly = {"frequency": "monthly"}
    row = await series(baby_api, "2027-01-31T09:00:00+10:00", monthly)
    start = "2027-02-28T09:00:00+10:00"
    event = replacement(start, data={**GUAM, "recurrence": {**monthly, "anchor": "2027-01-31"}})
    response = await split(baby_api, row, start, event)
    assert response.status_code == 200, response.text
    assert response.json()["event"]["data"]["recurrence"]["anchor"] == "2027-01-31"
    found = await starts(baby_api, "2027-01-01", "2027-04-30")
    assert [at[:10] for at, _ in found] == ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]
    # And it takes another split further on.
    start = "2027-03-31T09:00:00+10:00"
    response = await split(baby_api, response.json()["event"], start, replacement(start, data={**GUAM, "recurrence": monthly}))
    assert response.status_code == 200, response.text
    found = await starts(baby_api, "2027-01-01", "2027-04-30")
    assert [at[:10] for at, _ in found] == ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]


# The fixtures `baby-mobile/lib/events.test.ts` repeats, so the phone's arithmetic can't drift from this.

NEW_YORK = ZoneInfo("America/New_York")


@pytest.mark.parametrize(("start", "day", "expected"), [
    # The second 1:30 AM of Nov 1, 2026 stays the second one each autumn; the first stays the first.
    ("2026-11-01T06:30:00+00:00", date(2027, 11, 7), "2027-11-07T06:30:00+00:00"),
    ("2026-11-01T05:30:00+00:00", date(2027, 11, 7), "2027-11-07T05:30:00+00:00"),
    # On days with no repeated hour it's simply 1:30 AM.
    ("2026-11-01T06:30:00+00:00", date(2026, 11, 2), "2026-11-02T06:30:00+00:00"),
    ("2026-11-01T06:30:00+00:00", date(2027, 7, 1), "2027-07-01T05:30:00+00:00"),
])
def test_the_repeated_hour_keeps_which_one_it_was(start, day, expected):
    first = datetime.fromisoformat(start)
    lo = datetime.combine(day, datetime.min.time(), NEW_YORK)
    hi = datetime.combine(date.fromordinal(day.toordinal() + 1), datetime.min.time(), NEW_YORK)
    found = list(starts_between(first, NEW_YORK, ("daily", 1, None, None), lo, hi))
    assert [moment.astimezone(UTC).isoformat() for moment in found] == [expected]


# Questions and notes for a visit


async def event_for(baby_api, child=None, **changes):
    saved, _ = await save(baby_api, "event", occurred_at="2026-11-10T09:00:00+10:00", child_id=child, data={**GUAM, "category": "appointment"}, **changes)
    assert saved.status_code == 200, saved.text
    return saved.json()


async def child_named(baby_api, name="Noa", owner="owner"):
    response = await baby_api.client.post(f"{API}/children", headers={**V2, "X-Test-Owner": owner}, json={
        "id": str(uuid4()), "name": name, "due_date": "2026-12-10",
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


@needs_database
async def test_a_question_for_one_baby_cannot_sit_on_anothers_visit(baby_api):
    await allow_events(baby_api)
    noa, kai = await child_named(baby_api, "Noa"), await child_named(baby_api, "Kai")
    for_noa = await event_for(baby_api, noa)
    for_family = await event_for(baby_api)

    async def link(child, event):
        return (await save(baby_api, "question", child_id=child, data={"event_id": event["id"]}))[0].status_code

    assert await link(kai, for_noa) == 422
    assert await link(noa, for_noa) == 200
    assert await link(None, for_noa) == 200
    assert await link(kai, for_family) == 200
    # The same goes for a note, and for changing either side of a link that's already there.
    note, _ = await save(baby_api, "journal", child_id=kai, data={"event_id": for_noa["id"]})
    assert note.status_code == 422
    question, _ = await save(baby_api, "question", child_id=noa, data={})
    path = f"{API}/records/{question.json()['id']}"
    moved = await baby_api.client.patch(path, headers=V2, json={"revision": 1, "data": {"event_id": for_noa["id"]}})
    assert moved.status_code == 200, moved.text
    moved = await baby_api.client.patch(path, headers=V2, json={"revision": 2, "child_id": kai})
    assert moved.status_code == 422


@needs_database
async def test_giving_a_visit_to_another_baby_lets_go_of_questions_it_no_longer_fits(baby_api):
    await allow_events(baby_api)
    noa, kai = await child_named(baby_api, "Noa"), await child_named(baby_api, "Kai")
    visit = await event_for(baby_api)
    linked = {}
    for name, child in (("noa", noa), ("kai", kai), ("general", None)):
        saved, _ = await save(baby_api, "question", child_id=child, data={"event_id": visit["id"]})
        assert saved.status_code == 200, saved.text
        linked[name] = saved.json()
    changed = await baby_api.client.patch(f"{API}/records/{visit['id']}", headers=V2, json={"revision": 1, "child_id": noa})
    assert changed.status_code == 200, changed.text
    assert "event_id" in (await stored(baby_api, linked["noa"]["id"])).data
    assert "event_id" in (await stored(baby_api, linked["general"]["id"])).data
    let_go = await stored(baby_api, linked["kai"]["id"])
    assert "event_id" not in let_go.data and let_go.revision == 2


async def linked_rows(baby_api, event, *query, headers=V2):
    response = await baby_api.client.get(f"{API}/records", params={"event_id": event, **dict(query)}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


@needs_database
async def test_the_records_for_one_visit_can_be_read_however_old(baby_api):
    await allow_events(baby_api)
    visit, other = await event_for(baby_api), await event_for(baby_api)
    wanted = []
    for at in range(3):
        saved, _ = await save(baby_api, "question", occurred_at=f"200{at}-01-01T09:00:00Z", data={"event_id": visit["id"]})
        wanted.append(saved.json()["id"])
    note, _ = await save(baby_api, "journal", data={"event_id": visit["id"]})
    await save(baby_api, "question", data={"event_id": other["id"]})
    await save(baby_api, "journal", title="Private", data={})
    found = await linked_rows(baby_api, visit["id"], ("kinds", ["question", "journal"]))
    assert {row["id"] for row in found["items"]} == {*wanted, note.json()["id"]} and found["total"] == 4
    page = await linked_rows(baby_api, visit["id"], ("kind", "question"), ("limit", 2), ("offset", 2))
    assert len(page["items"]) == 1 and page["has_more"] is False and page["total"] == 3
    # Another person asking about the same visit finds nothing.
    assert (await linked_rows(baby_api, visit["id"], headers={**V2, "X-Test-Owner": "other"}))["items"] == []


async def test_a_family_visits_records_are_the_spaces_and_an_older_client_sees_none(baby_api, family, family_series):
    body = shared.payload("question", data={"event_id": family_series["id"]})
    saved = await baby_api.client.post(f"{API}/records", headers=records.headers(family, "other"), json=body)
    assert saved.status_code == 200, saved.text
    found = await linked_rows(baby_api, family_series["id"], headers=records.headers(family))
    assert [row["id"] for row in found["items"]] == [body["id"]]
    assert (await linked_rows(baby_api, family_series["id"], headers=V2))["items"] == []

"""New record kinds, and what build 32 still gets: its kinds, its hashes and its fields."""

import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text

from app.domains.baby.lifecycle import digest
from app.domains.baby.models import BabyRecord
from app.domains.baby.schemas import NEW_KINDS, V1_KINDS, RecordCreate
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
GEN = shared.GEN
V2 = {**GEN, "X-Baby-Client": "2"}
API = "/api/v1/baby"
AT = "2026-11-01T08:00:00+10:00"
LATER = "2026-11-01T09:00:00+10:00"
BUILD_32 = json.loads(
    (Path(__file__).parent / "compatibility" / "baby_build_32_records.json").read_text()
)["records"]
SAMPLES = {
    "event": {
        "end": LATER, "all_day": False, "timezone": "Pacific/Guam", "category": "appointment",
        "location": "Clinic", "attendees": ["Kami"],
        "recurrence": {"frequency": "monthly", "interval": 1, "until": "2027-01-01"},
        "exceptions": [{"original_start": "2026-12-01T08:00:00+10:00", "cancelled": True}],
    },
    "contraction": {"end_at": "2026-11-01T08:01:00+10:00"},
    "kick_session": {"end_at": LATER, "count": 10},
    "pumping": {"side": "both", "amount": 90, "unit": "ml", "duration_minutes": 15},
    "medicine": {"name": "Vitamin D", "dose": "1 drop"},
    "temperature": {"value": 37.1, "unit": "c", "method": "armpit"},
    "growth": {"weight": 3.4, "weight_unit": "kg", "length": 50, "length_unit": "cm"},
    "milestone": {"milestone_id": "cdc-2m-smiles"},
    "custom": {"label": "Tummy time", "value": 5, "unit": "min"},
}


def record(kind, data, **changes):
    return {"kind": kind, "title": kind, "occurred_at": AT, "data": data, **changes}


def validated(kind, data, **changes):
    return RecordCreate.model_validate(record(kind, data, **changes))


def test_kinds_are_the_plan_list():
    assert set(NEW_KINDS) == set(SAMPLES)
    assert len(V1_KINDS) == 8 and not set(V1_KINDS) & set(NEW_KINDS)


@pytest.mark.parametrize("kind", NEW_KINDS)
def test_new_kinds_validate_and_refuse_unknown_fields(kind):
    assert validated(kind, SAMPLES[kind]).data
    with pytest.raises(ValidationError):
        validated(kind, {**SAMPLES[kind], "unknown": 1})


@pytest.mark.parametrize(
    ("kind", "data"),
    [
        ("event", {}),
        ("event", {"timezone": "Mars/Base"}),
        ("event", {"timezone": "UTC", "attendees": ["x"] * 31}),
        ("event", {"timezone": "UTC", "recurrence": {"frequency": "hourly"}}),
        ("event", {"timezone": "UTC", "recurrence": {"frequency": "daily", "interval": 0}}),
        ("event", {"timezone": "UTC", "exceptions": [{"original_start": AT}]}),
        ("event", {"timezone": "UTC", "exceptions": [
            {"original_start": AT, "cancelled": True, "overrides": {"title": "Moved"}},
        ]}),
        ("event", {"timezone": "UTC", "exceptions": [
            {"original_start": AT, "cancelled": True},
            {"original_start": "2026-10-31T22:00:00+00:00", "cancelled": True},
        ]}),
        ("kick_session", {"count": -1}),
        ("kick_session", {"count": 1001}),
        ("pumping", {"amount": 90}),
        ("medicine", {}),
        ("medicine", {"name": "x" * 121}),
        ("temperature", {"value": 37}),
        ("temperature", {"value": 500, "unit": "c"}),
        ("growth", {}),
        ("growth", {"weight": 3.4}),
        ("custom", {"value": float("nan")}),
    ],
)
def test_bad_new_kind_payloads_are_refused(kind, data):
    with pytest.raises(ValidationError):
        validated(kind, data)


@pytest.mark.parametrize(
    ("kind", "field"),
    [("event", "end"), ("contraction", "end_at"), ("kick_session", "end_at"), ("pumping", "end_at")],
)
def test_nothing_ends_before_it_starts_across_offsets(kind, field):
    data = {"timezone": "UTC"} if kind == "event" else {}
    with pytest.raises(ValidationError):
        validated(kind, {**data, field: "2026-10-31T21:59:00+00:00"})  # 07:59 in Guam.
    assert validated(kind, {**data, field: "2026-10-31T22:01:00+00:00"})


def test_feeding_and_diaper_additions_are_stored_only_when_set():
    assert validated("feeding", {"method": "breast", "side": "left"}).data == {
        "method": "breast", "amount": None, "unit": None, "side": "left", "duration_minutes": None,
    }
    assert validated("diaper", {"type": "dirty"}).data == {"type": "dirty"}
    action = {"id": str(uuid4()), "action": "start", "at": AT, "side": "left"}
    feed = validated("feeding", {"method": "breast", "state": "running", "actions": [action]}).data
    assert feed["state"] == "running" and feed["actions"] == [action]
    assert validated("feeding", {"method": "bottle", "contents": "formula"}).data["contents"] == "formula"
    assert validated("diaper", {"type": "both", "color": "yellow"}).data["color"] == "yellow"


@pytest.mark.parametrize(
    "action",
    [
        {"action": "start"},
        {"action": "switch"},
        {"action": "start", "side": "both"},
        {"action": "finish", "side": "left"},
    ],
)
def test_feed_actions_name_a_side_only_when_they_change_one(action):
    with pytest.raises(ValidationError):
        validated("feeding", {"method": "breast", "actions": [{"id": str(uuid4()), "at": AT, **action}]})


def test_too_many_feed_actions_are_refused():
    actions = [{"id": str(uuid4()), "action": "finish", "at": AT} for _ in range(101)]
    with pytest.raises(ValidationError):
        validated("feeding", {"method": "breast", "actions": actions})


def test_fields_an_older_client_kept_do_not_outlive_a_change_of_type():
    action = {"id": str(uuid4()), "action": "start", "at": AT, "side": "left"}
    bottle = validated(
        "feeding",
        {"method": "bottle", "state": "running", "actions": [action], "end_at": LATER, "contents": "formula"},
    ).data
    assert not {"state", "actions", "end_at"} & set(bottle)
    assert "contents" not in validated("feeding", {"method": "breast", "contents": "formula"}).data
    assert "color" not in validated("diaper", {"type": "wet", "color": "green"}).data


@pytest.mark.parametrize("item", BUILD_32, ids=lambda item: item["payload"]["data"].get("method") or item["payload"]["kind"])
def test_build_32_bodies_validate_to_their_original_hash(item):
    # A retry after this upgrade would otherwise be refused as a different save.
    body = RecordCreate.model_validate(item["payload"])
    assert digest(body.model_dump(mode="json")) == item["creation_hash"]


async def allow_new_kinds(baby_api):
    # Migration 055's constraint, whether or not this checkout's chain has it yet.
    async with baby_api.engine.begin() as db:
        await db.execute(text("ALTER TABLE baby_records DROP CONSTRAINT IF EXISTS ck_baby_record_kind"))
        await db.execute(text(f"""ALTER TABLE baby_records ADD CONSTRAINT ck_baby_record_kind
            CHECK (kind IN ({", ".join(f"'{kind}'" for kind in (*V1_KINDS, *NEW_KINDS))}))"""))
    baby_api.settings.baby_new_kinds_enabled = True


@needs_database
async def test_new_kinds_wait_for_the_setting_and_a_current_client(baby_api):
    c = baby_api.client
    body = shared.payload("medicine", data=SAMPLES["medicine"])
    # Off by default: migration 055 may not have run, so nothing reaches the database.
    assert (await c.post(f"{API}/records", headers=V2, json=body)).status_code == 503
    assert (await c.post(f"{API}/records", headers=GEN, json=body)).status_code == 422
    await allow_new_kinds(baby_api)
    assert (await c.post(f"{API}/records", headers=GEN, json=body)).status_code == 422
    other = {**GEN, "X-Baby-Client": "1"}
    assert (await c.post(f"{API}/records", headers=other, json=body)).status_code == 422
    async with baby_api.sessions() as db:
        assert not list(await db.scalars(select(BabyRecord)))
    saved = await c.post(f"{API}/records", headers=V2, json=body)
    assert saved.status_code == 200 and saved.json()["data"]["name"] == "Vitamin D"
    # A lost response is replayed like any other kind.
    assert (await c.post(f"{API}/records", headers=V2, json=body)).json()["id"] == body["id"]


@needs_database
async def test_build_32_never_sees_new_kinds(baby_api):
    c = baby_api.client
    await allow_new_kinds(baby_api)
    ids = {}
    for kind in NEW_KINDS:
        body = shared.payload(kind, title="findme", data=SAMPLES[kind])
        response = await c.post(f"{API}/records", headers=V2, json=body)
        assert response.status_code == 200, kind
        ids[kind] = body["id"]
    journal = shared.payload("journal", title="findme")
    assert (await c.post(f"{API}/records", headers=GEN, json=journal)).status_code == 200

    legacy = (await c.get(f"{API}/records")).json()
    assert [item["id"] for item in legacy["items"]] == [journal["id"]] and legacy["total"] == 1
    assert (await c.get(f"{API}/records", params={"kind": "event"})).json()["total"] == 0
    assert (await c.get(f"{API}/records", params={"kinds": ["event", "journal"]})).json()["total"] == 1
    found = (await c.get(f"{API}/search", params={"q": "findme"})).json()
    assert [item["id"] for item in found["items"]] == [journal["id"]] and found["total"] == 1
    exported = (await c.get(f"{API}/export")).json()
    assert [item["id"] for item in exported["records"]] == [journal["id"]]
    assert exported["format"] == "hafa-baby-v1"

    current = (await c.get(f"{API}/records", headers=V2, params={"limit": 100})).json()
    assert current["total"] == len(NEW_KINDS) + 1
    assert (await c.get(f"{API}/search", headers=V2, params={"q": "findme"})).json()["total"] == len(NEW_KINDS) + 1
    assert len((await c.get(f"{API}/export", headers=V2)).json()["records"]) == len(NEW_KINDS) + 1

    for kind, identifier in ids.items():
        url = f"{API}/records/{identifier}"
        assert (await c.get(url)).status_code == 404, kind
        assert (await c.patch(url, headers=GEN, json={"revision": 1, "title": "x"})).status_code == 404
        assert (await c.delete(url, headers=GEN, params={"revision": 1})).status_code == 404
        assert (await c.get(url, headers=V2)).json()["revision"] == 1
    edited = await c.patch(f"{API}/records/{ids['custom']}", headers=V2, json={"revision": 1, "title": "x"})
    assert edited.status_code == 200 and edited.json()["data"]["label"] == "Tummy time"
    assert (await c.delete(f"{API}/records/{ids['custom']}", headers=V2, params={"revision": 2})).status_code == 204


@needs_database
async def test_build_32_flow_is_unchanged(baby_api):
    c = baby_api.client
    for item in BUILD_32:
        saved = await c.post(f"{API}/records", headers=GEN, json=item["payload"])
        assert saved.status_code == 200, item["payload"]["kind"]
        assert (await c.post(f"{API}/records", headers=GEN, json=item["payload"])).status_code == 200
    async with baby_api.sessions() as db:
        rows = {str(row.id): row for row in await db.scalars(select(BabyRecord))}
    for item in BUILD_32:
        assert rows[item["payload"]["id"]].creation_hash == item["creation_hash"]
    listed = (await c.get(f"{API}/records", params={"limit": 100})).json()
    assert listed["total"] == len(BUILD_32)
    for row in listed["items"]:
        assert not {"state", "actions", "end_at", "contents", "color"} & set(row["data"]) or row["kind"] == "sleep"


@needs_database
async def test_older_clients_keep_additions_they_omit(baby_api):
    c = baby_api.client
    action = {"id": str(uuid4()), "action": "start", "at": AT, "side": "left"}
    feed = shared.payload(
        "feeding", occurred_at=AT,
        data={"method": "breast", "side": "left", "state": "running", "actions": [action]},
    )
    bottle = shared.payload("feeding", data={"method": "bottle", "amount": 4, "unit": "oz", "contents": "formula"})
    diaper = shared.payload("diaper", data={"type": "dirty", "color": "yellow"})
    for body in (feed, bottle, diaper):
        assert (await c.post(f"{API}/records", headers=V2, json=body)).status_code == 200

    async def patched(body, **changes):
        response = await c.patch(f"{API}/records/{body['id']}", headers=GEN, json=changes)
        assert response.status_code == 200
        return response.json()["data"]

    data = await patched(feed, revision=1, data={"method": "breast", "side": "left"})
    assert data["state"] == "running" and data["actions"] == [action]
    assert (await patched(bottle, revision=1, data={"method": "bottle", "amount": 5, "unit": "oz"}))["contents"] == "formula"
    assert (await patched(diaper, revision=1, data={"type": "both"}))["color"] == "yellow"
    # Only an explicit null clears one, and a change of type drops what no longer applies.
    assert "contents" not in await patched(bottle, revision=2, data={"method": "bottle", "contents": None})
    assert "color" not in await patched(diaper, revision=2, data={"type": "dirty", "color": None})
    await patched(diaper, revision=3, data={"type": "dirty", "color": "green"})
    assert "color" not in await patched(diaper, revision=4, data={"type": "wet"})
    # Editing something else leaves stored data alone.
    title = await c.patch(f"{API}/records/{feed['id']}", headers=GEN, json={"revision": 2, "title": "Morning"})
    assert title.json()["data"]["actions"] == [action]


@pytest.mark.parametrize("second", ["2026-11-04T08:00:00Z", "2026-11-04T18:00:00+10:00"])
def test_a_retried_action_is_one_action_and_a_reused_id_is_refused(second):
    identity = str(uuid4())
    tap = {"id": identity, "action": "start", "at": "2026-11-04T08:00:00Z", "side": "left"}
    feed = validated("feeding", {"method": "breast", "actions": [tap, {**tap, "at": second}]})
    assert len(feed.data["actions"]) == 1
    with pytest.raises(ValidationError):
        validated("feeding", {"method": "breast", "actions": [tap, {**tap, "side": "right"}]})


@needs_database
async def test_build_32_chat_neither_retrieves_nor_cites_new_kinds(baby_api):
    from app.domains.baby.chat import message_response, retrieve
    from app.domains.baby.schemas import ChatRequest

    await allow_new_kinds(baby_api)
    body = shared.payload("kick_session", data=SAMPLES["kick_session"])
    assert (await baby_api.client.post(f"{API}/records", headers=V2, json=body)).status_code == 200
    request = ChatRequest(request_id=uuid4(), message="What has happened?")
    async with baby_api.sessions() as db:
        current, _, _ = await retrieve(db, "owner", 1, request)
        old, _, _ = await retrieve(db, "owner", 1, request, legacy=True)
    assert [item["kind"] for item in current] == ["kick_session"] and old == []
    stored = SimpleNamespace(
        id=uuid4(), conversation_id=uuid4(), role="assistant", created_at=None,
        content={"message": "x", "citations": [{"id": "1", "kind": "kick_session"}, {"id": "2", "kind": "journal"}]},
    )
    assert [c["id"] for c in message_response(stored, legacy=True)["citations"]] == ["2"]
    assert len(message_response(stored)["citations"]) == 2

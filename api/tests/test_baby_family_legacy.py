"""F4l real endpoint inventory for build 32/client 2, with the flag on and off."""
import re
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image

from app.domains.baby import storage
from app.domains.baby.models import BabyConversation, BabyMembership
from app.domains.baby.provider import AnswerOutput
from app.domains.baby.runtime import BabyWorker
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_share_integration as native

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


@pytest.fixture(params=[None, "2"], ids=["build32", "client2"])
def legacy_client_headers(request):
    return {**shared.GEN, **({"X-Baby-Client": request.param} if request.param else {})}


@pytest.fixture
def legacy_endpoint_inventory(baby_api):
    baby_api.client._transport.app.include_router(native.router)
    baby_api.client._transport.app.openapi_schema = None
    paths = baby_api.client._transport.app.openapi()["paths"]
    return {(method.upper(), path) for path, methods in paths.items()
            for method in methods if method in {"get", "post", "patch", "delete", "put"}}


@pytest.mark.parametrize("enabled", [False, True], ids=["flag-off", "flag-on"])
async def test_every_endpoint_with_legacy_client(baby_api, family, legacy_client_headers,
                                                legacy_endpoint_inventory, monkeypatch, tmp_path, enabled):
    c, h, executed = baby_api.client, legacy_client_headers, set()
    monkeypatch.setattr(storage, "local_root", lambda: tmp_path)
    baby_api.settings.baby_new_kinds_enabled = True
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    family_actor = "owner" if enabled else "other"
    family_headers = records.headers(family, family_actor)
    hidden_child = {"id": str(uuid4()), "name": "Hidden family child"}
    assert (await c.post("/api/v1/baby/children", headers=family_headers, json=hidden_child)).status_code == 200
    hidden_care = shared.payload("diaper", data={"type": "wet"})
    assert (await c.post("/api/v1/baby/records", headers=family_headers, json=hidden_care)).status_code == 200
    async with baby_api.sessions() as db:
        hidden_conversation = BabyConversation(app_user_id=family_actor, space_id=family, generation=7,
            title="Hidden family conversation", scope="all", context_space_ids=[str(family)])
        db.add(hidden_conversation)
        await db.commit()
        hidden_conversation_id = str(hidden_conversation.id)
    hidden = shared.payload("source", title="Family only", body="Legacy hidden")
    assert (await c.post("/api/v1/baby/records", headers=family_headers, json=hidden)).status_code == 200
    new_kind = shared.payload("contraction")
    assert (await c.post("/api/v1/baby/records", headers=records.headers(personal, generation=1), json=new_kind)).status_code == 200
    calendar = shared.payload("event", data={"timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}})
    assert (await c.post("/api/v1/baby/records", headers=records.headers(personal, generation=1), json=calendar)).status_code == 200
    baby_api.settings.baby_family_enabled = enabled

    async def call(method, path, *, expected=200, headers=None, **kwargs):
        actual_path = path.split("?", 1)[0]
        matching = [(verb, template) for verb, template in legacy_endpoint_inventory
                    if verb == method and re.fullmatch(re.sub(r"\{[^}]+\}", "[^/]+", template), actual_path)]
        assert len(matching) == 1, (method, path, matching)
        executed.add(matching[0])
        response = await c.request(method, path, headers={**h, **(headers or {})}, **kwargs)
        assert response.status_code == expected, (method, path, response.text)
        return response.json() if response.content else None

    for method, path in (("POST", f"/api/v1/baby/family/{family}/leave"),
                         ("DELETE", f"/api/v1/baby/family/{family}/members/other"),
                         ("DELETE", f"/api/v1/baby/family/{family}")):
        await call(method, path, expected=403 if enabled else 404)
    await call("POST", "/api/v1/baby/family", expected=403 if enabled else 404)
    await call("POST", f"/api/v1/baby/records/{uuid4()}/move", expected=403 if enabled else 404,
               json={"space_id": str(personal), "revision": 1})
    await call("GET", "/api/v1/baby/bootstrap")
    await call("POST", "/api/v1/baby/bootstrap")
    await call("POST", "/api/v1/baby/enroll")
    await call("PATCH", "/api/v1/baby/profile", json={"ai_consent": True})
    child_id = str(uuid4())
    await call("POST", "/api/v1/baby/children", json={"id": child_id, "name": "Personal child"})
    children = await call("GET", "/api/v1/baby/children")
    assert {item["id"] for item in children["items"]} == {child_id}
    assert hidden_child["id"] not in str(children)
    await call("PATCH", f"/api/v1/baby/children/{child_id}", json={"revision": 1, "name": "Edited child"})
    source = shared.payload("source", child_id=child_id, data={"source_text": "Legacy original",
        "relevance": {"stage": "pregnancy", "pregnancy_week_min": 20},
        "suggested_category": {"name": "Personal category", "confidence": 1}})
    await call("POST", "/api/v1/baby/records", json=source)
    page = await call("GET", "/api/v1/baby/records")
    ids = {row["id"] for row in page["items"]}
    assert hidden["id"] not in ids
    assert (new_kind["id"] in ids) == (h.get("X-Baby-Client") == "2")
    search = await call("GET", "/api/v1/baby/search?q=Legacy")
    assert {item["id"] for item in search["items"]} == {source["id"]}
    await call("GET", f"/api/v1/baby/records/{source['id']}")
    edited = await call("PATCH", f"/api/v1/baby/records/{source['id']}", json={
        "revision": 1, "data": {"source_text": "Legacy updated"}})
    assert edited["data"]["relevance"]["pregnancy_week_min"] == 20
    assert edited["data"]["suggested_category"]["name"] == "Personal category"
    await call("POST", f"/api/v1/baby/records/{source['id']}/suggested-category", json={"revision": 2, "action": "accept"})
    second = shared.payload("source", data={"suggested_category": {"name": "Personal category", "confidence": 1}})
    await call("POST", "/api/v1/baby/records", json=second)
    await call("POST", "/api/v1/baby/suggested-categories", json={"action": "accept", "items": [{"record_id": second["id"], "revision": 1}]})
    feed = shared.payload("feeding", data={"method": "breast", "side": "left", "state": "running"})
    await call("POST", "/api/v1/baby/records", json=feed)
    await call("POST", f"/api/v1/baby/records/{feed['id']}/feed-action", json={
        "action_id": str(uuid4()), "action": "finish", "at": "2026-10-20T12:10:00+10:00"})
    summary = await call("GET", "/api/v1/baby/care/summary?from=2026-10-20&to=2026-10-20")
    assert summary["feeding"]["count"] == 1 and summary["diapers"]["count"] == 0
    expected_event = 200 if h.get("X-Baby-Client") == "2" else 404
    calendar_page = await call("GET", "/api/v1/baby/events?from=2026-10-20&to=2026-10-20", expected=expected_event)
    if expected_event == 200:
        assert {item["event_id"] for item in calendar_page["items"]} == {calendar["id"]}
    occurrence = "2026-10-21T12:00:00+10:00"
    await call("PUT", f"/api/v1/baby/events/{calendar['id']}/occurrences", expected=expected_event,
               json={"original_start": occurrence, "cancelled": True, "revision": 1})
    await call("DELETE", f"/api/v1/baby/events/{calendar['id']}/occurrences", expected=expected_event,
               params={"original_start": occurrence, "revision": 2})
    await call("POST", f"/api/v1/baby/events/{calendar['id']}/end-series", expected=expected_event,
               json={"from_date": "2026-10-22", "revision": 3})
    await call("POST", f"/api/v1/baby/records/{new_kind['id']}/session-action", expected=expected_event,
               json={"action_id": str(uuid4()), "action": "finish", "at": "2026-10-20T12:01:00+10:00"})
    image = BytesIO()
    Image.new("RGB", (20, 20), "white").save(image, "PNG")
    asset = await call("POST", "/api/v1/baby/attachments", files={"file": ("synthetic.png", image.getvalue(), "image/png")})
    # Bytes are intentionally not parsed as JSON by the common request wrapper.
    response = await c.get(f"/api/v1/baby/attachments/{asset['id']}", headers=h)
    assert response.status_code == 200
    executed.add(("GET", "/api/v1/baby/attachments/{identifier}"))
    await call("GET", f"/api/v1/baby/attachments/{asset['id']}/metadata")
    await call("POST", f"/api/v1/baby/attachments/{asset['id']}/release", expected=204)
    await call("DELETE", f"/api/v1/baby/attachments/{asset['id']}", expected=204)
    capture = {"id": str(uuid4()), "text": "Legacy import original"}
    await call("POST", "/api/v1/baby/imports", json=capture)
    await call("GET", f"/api/v1/baby/imports/{capture['id']}")
    await call("POST", f"/api/v1/baby/imports/{capture['id']}/cancel")
    await call("POST", f"/api/v1/baby/imports/{capture['id']}/retry")

    async def processor(*args, **kwargs):
        return {"title": "Legacy processed", "data": {"status": "ready"}, "status": "ready"}

    assert await BabyWorker(baby_api.sessions, processor=processor).tick()

    class Provider:
        enabled = True
        async def answer(self, **kwargs):
            assert hidden["id"] not in {row["id"] for row in kwargs["context"]}
            return AnswerOutput(message="Legacy answer", citation_ids=[])

    monkeypatch.setattr("app.domains.baby.chat.BabyProvider", Provider)
    answer = await call("POST", "/api/v1/baby/chat", json={"request_id": str(uuid4()), "message": "Summarize my library", "scope": "all"})
    conversations = await call("GET", "/api/v1/baby/conversations")
    assert {row["id"] for row in conversations["items"]} == {answer["conversation_id"]}
    assert hidden_conversation_id not in str(conversations)
    await call("GET", f"/api/v1/baby/conversations/{answer['conversation_id']}")
    credential = await call("POST", "/api/v1/baby/share/session", expected=201, json={"installation_id": str(uuid4())})
    capability = {"Authorization": "Bearer " + credential["token"]}
    await call("POST", "/api/v1/baby/share/captures", expected=202, headers=capability, json=native.capture())
    await call("DELETE", "/api/v1/baby/share/session", expected=204, headers=capability)
    exported = await call("GET", "/api/v1/baby/export")
    assert hidden["id"] not in {row["id"] for row in exported["records"]}
    await call("DELETE", f"/api/v1/baby/records/{feed['id']}?revision=2", expected=204)
    await call("DELETE", f"/api/v1/baby/children/{child_id}?revision=2", expected=204)
    # Existing personal erasure only; family deletion rules belong to the next worker.
    await call("DELETE", "/api/v1/baby/data?generation=1")
    assert executed == legacy_endpoint_inventory, legacy_endpoint_inventory - executed


async def test_family_gate_preserves_first_write_provisioning(baby_api, family):
    from app.domains.baby.models import BabyMembership
    from app.models.identity import AppUser

    async with baby_api.sessions() as db:
        db.add_all([AppUser(id="legacy-first-write"), AppUser(id="legacy-bootstrap")])
        await db.flush()
        db.add_all([BabyMembership(app_user_id="legacy-first-write", generation=4),
                    BabyMembership(app_user_id="legacy-bootstrap", generation=3)])
        await db.commit()
    result = await baby_api.client.post("/api/v1/baby/records", headers={
        "X-Test-Owner": "legacy-first-write", "X-Baby-Generation": "4"}, json=shared.payload())
    assert result.status_code == 200, result.text
    assert (await baby_api.client.get("/api/v1/baby/bootstrap", headers={
        "X-Test-Owner": "legacy-bootstrap", "X-Baby-Client": "3"})).status_code == 409
    result = await baby_api.client.post("/api/v1/baby/bootstrap", headers={
        "X-Test-Owner": "legacy-bootstrap", "X-Baby-Client": "3"})
    assert result.status_code == 200 and len(result.json()["spaces"]) == 1, result.text


async def test_foreign_personal_space_write_guard(baby_api, family):
    from fastapi import HTTPException

    from app.domains.baby.access import access_for
    from app.domains.baby.models import BabySpaceMember

    # Deliberately invalid membership: normal provisioning never grants another personal space.
    async with baby_api.sessions() as db:
        other_personal = (await db.get(BabyMembership, "other")).personal_space_id
        db.add(BabySpaceMember(space_id=other_personal, app_user_id="owner", role="parent"))
        await db.commit()
        with pytest.raises(HTTPException) as error:
            await access_for(db, "owner", client="3", space_id=other_personal, write=True)
        assert error.value.status_code == 403

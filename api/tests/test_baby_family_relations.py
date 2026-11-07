"""F4d same-space references and the personal journal exception."""
from uuid import uuid4

from app.domains.baby.models import BabyMembership, BabyRecord
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_collections_and_suggestions_cannot_cross_readable_spaces(baby_api, family):
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    private = records.headers(personal, generation=1)
    request = shared.payload("source", title="Personal source")
    assert (await c.post("/api/v1/baby/records", headers=private, json=request)).status_code == 200
    collection = shared.payload("collection", data={"record_ids": [request["id"]]})
    result = await c.post("/api/v1/baby/records", headers=records.headers(family), json=collection)
    assert result.status_code == 422
    result = await c.post("/api/v1/baby/records", headers=private, json=collection)
    assert result.status_code == 200
    result = await c.post("/api/v1/baby/records", headers=records.headers(family), json=shared.payload("source", data={
        "suggested_category": {"name": "Private category", "collection_id": collection["id"], "confidence": 1}}))
    assert result.status_code == 422
    result = await c.get("/api/v1/baby/records?uncategorized=true", headers=private)
    assert result.status_code == 200 and result.json()["total"] == 0


async def test_personal_journal_family_child_is_ignored_after_delete_then_cleared_on_edit(baby_api, family):
    c, child = baby_api.client, {"id": str(uuid4()), "name": "Family child"}
    assert (await c.post("/api/v1/baby/children", headers=records.headers(family), json=child)).status_code == 200
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    private = records.headers(personal, generation=1)
    journal = shared.payload(child_id=child["id"])
    result = await c.post("/api/v1/baby/records", headers=private, json=journal)
    assert result.status_code == 200 and result.json()["child_id"] == child["id"]
    care = shared.payload("diaper", child_id=child["id"], data={"type": "wet"})
    result = await c.post("/api/v1/baby/records", headers=private, json=care)
    assert result.status_code == 409 and result.json()["code"] == "moved"
    assert result.json()["record"]["name"] == child["name"]
    result = await c.delete(f"/api/v1/baby/children/{child['id']}?revision=1", headers=records.headers(family, "other"))
    assert result.status_code == 204
    for path in (f"/records/{journal['id']}", "/records", "/search?q=Notes"):
        result = await c.get("/api/v1/baby" + path, headers=private)
        assert result.status_code == 200
        item = result.json() if "items" not in result.json() else result.json()["items"][0]
        assert item["child_id"] is None
    async with baby_api.sessions() as db:
        # Deleting someone else's family child never edits this personal journal.
        assert str((await db.get(BabyRecord, journal["id"])).child_id) == child["id"]
    result = await c.patch(f"/api/v1/baby/records/{journal['id']}", headers=private, json={"revision": 1, "body": "Edited"})
    assert result.status_code == 200 and result.json()["child_id"] is None
    async with baby_api.sessions() as db:
        assert (await db.get(BabyRecord, journal["id"])).child_id is None


async def test_event_links_require_same_space_and_event_kind(baby_api, family, monkeypatch):
    monkeypatch.setattr("app.domains.baby.router.new_kinds_enabled", lambda: True)
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    private = records.headers(personal, generation=1)
    event = shared.payload("event", data={"timezone": "Pacific/Guam"})
    assert (await c.post("/api/v1/baby/records", headers=private, json=event)).status_code == 200
    result = await c.post("/api/v1/baby/records", headers=records.headers(family),
                          json=shared.payload("question", data={"event_id": event["id"]}))
    assert result.status_code == 422
    question = shared.payload("question")
    assert (await c.post("/api/v1/baby/records", headers=records.headers(family), json=question)).status_code == 200
    result = await c.post("/api/v1/baby/records", headers=records.headers(family),
                          json=shared.payload("journal", data={"event_id": question["id"]}))
    assert result.status_code == 422


async def test_queued_routines_and_events_retarget_but_private_sources_do_not(baby_api, family, monkeypatch):
    monkeypatch.setattr("app.domains.baby.router.new_kinds_enabled", lambda: True)
    c, child = baby_api.client, {"id": str(uuid4()), "name": "Family child"}
    assert (await c.post("/api/v1/baby/children", headers=records.headers(family), json=child)).status_code == 200
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    private = records.headers(personal, generation=1)
    for kind, data in (("routine", {"routine_type": "checklist"}), ("event", {"timezone": "Pacific/Guam"}), ("source", {})):
        response = await c.post("/api/v1/baby/records", headers=private,
                                json=shared.payload(kind, child_id=child["id"], data=data))
        assert response.status_code == (200 if kind == "source" else 409), response.text
        if kind == "source":
            assert response.json()["child_id"] is None
            assert response.json()["space_id"] == str(personal)
        else:
            assert response.json().get("detail", response.json())["code"] == "moved"

async def test_linked_personal_source_keeps_original_note_after_child_rewrite(baby_api,family):
    from app.domains.baby.runtime import BabyWorker
    c=baby_api.client
    child={"id":str(uuid4()),"name":"Family child"}
    assert (await c.post("/api/v1/baby/children",headers=records.headers(family),json=child)).status_code==200
    async with baby_api.sessions() as db:
        personal=(await db.get(BabyMembership,"owner")).personal_space_id
    private=records.headers(personal,generation=1)
    body=shared.payload("source",body="",child_id=child["id"],data={"url":"https://example.com/post","source_text":"Parent original note"})
    saved=await c.post("/api/v1/baby/records",headers=private,json=body)
    assert saved.status_code==200 and saved.json()["child_id"] is None
    assert saved.json()["data"]["user_text"]=="Parent original note"
    assert (await c.post("/api/v1/baby/records",headers=private,json=body)).status_code==200
    queued=await c.post("/api/v1/baby/imports",headers=private,json={"id":str(uuid4()),"record_id":body["id"]})
    assert queued.status_code==200,queued.text
    seen=[]
    async def processor(request,*args,**kwargs):
        seen.append(request["text"])
        return {"status":"incomplete","data":{"status":"incomplete"}}
    assert await BabyWorker(baby_api.sessions,processor=processor).tick()
    assert seen==["Parent original note"]

"""F4c child CRUD and detach side effects, via the public API."""
from uuid import uuid4

from app.domains.baby.models import (
    BabyChild,
    BabyImport,
    BabyMembership,
    BabyRecord,
    BabySpaceMember,
)
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_child_create_edit_read_and_detach_all_family_authors(baby_api, family):
    c, identifier = baby_api.client, str(uuid4())
    child = {"id": identifier, "name": "Synthetic child"}
    response = await c.post("/api/v1/baby/children", headers=records.headers(family), json=child)
    assert response.status_code == 200 and response.json()["space_id"] == str(family)
    for owner in ("owner", "other"):
        h = records.headers(family, owner)
        result = await c.get("/api/v1/baby/children", headers=h)
        assert result.status_code == 200 and result.json()["items"][0]["id"] == identifier
        result = await c.post("/api/v1/baby/records", headers=h,
                              json=shared.payload("diaper", child_id=identifier, data={"type": "wet"}))
        assert result.status_code == 200, result.text
    result = await c.patch(f"/api/v1/baby/children/{identifier}", headers=records.headers(family, "other"),
                           json={"revision": 1, "name": "Updated"})
    assert result.status_code == 200 and result.json()["revision"] == 2
    for client in (None, "2"):
        h = {"X-Baby-Client": client} if client else {}
        assert (await c.get("/api/v1/baby/children", headers=h)).json()["items"] == []
    async with baby_api.sessions() as db:
        source = await db.get(BabyRecord, (await c.get("/api/v1/baby/records", headers=records.headers(family))).json()["items"][0]["id"])
        job = BabyImport(id=uuid4(), app_user_id="owner", space_id=family, generation=7,
                         creation_hash="test", consent_epoch=0, request={"child_id": identifier},
                         record_id=source.id)
        db.add(job)
        job_id = job.id
        await db.commit()
    result = await c.delete(f"/api/v1/baby/children/{identifier}?revision=2", headers=records.headers(family, "other"))
    assert result.status_code == 204, result.text
    result = await c.get("/api/v1/baby/records", headers=records.headers(family))
    assert len(result.json()["items"]) == 2
    assert all(row["child_id"] is None and row["revision"] == 2 for row in result.json()["items"])
    async with baby_api.sessions() as db:
        child = await db.get(BabyChild, identifier)
        job = await db.get(BabyImport, job_id)
        assert child.deleted_at and child.change_seq > 0
        assert job.request["child_id"] is None and job.change_seq > 0


async def test_child_replay_after_move_and_parent_only_delete(baby_api, family):
    c, identifier = baby_api.client, str(uuid4())
    request = {"id": identifier, "name": "Synthetic child"}
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    original = records.headers(personal, generation=1)
    assert (await c.post("/api/v1/baby/children", headers=original, json=request)).status_code == 200
    async with baby_api.sessions() as db:
        row = await db.get(BabyChild, identifier)
        row.space_id, row.generation = family, 7
        link = await db.get(BabySpaceMember, (family, "other"))
        link.role = "caregiver"
        await db.commit()
    replay = await c.post("/api/v1/baby/children", headers=original, json=request)
    assert replay.status_code == 200 and replay.json()["generation"] == 7
    result = await c.patch(f"/api/v1/baby/children/{identifier}", headers=original,
                           json={"revision": 1, "name": "Stale destination"})
    assert result.status_code == 409 and result.json()["code"] == "moved"
    result = await c.delete(f"/api/v1/baby/children/{identifier}?revision=1", headers=records.headers(family, "other"))
    assert result.status_code == 403


async def test_caregiver_cannot_create_or_rename_child(baby_api, family):
    c, identifier = baby_api.client, str(uuid4())
    assert (await c.post("/api/v1/baby/children", headers=records.headers(family),
                         json={"id": identifier, "name": "Original"})).status_code == 200
    async with baby_api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, "other"))
        link.role = "caregiver"
        await db.commit()
    h = records.headers(family, "other")
    assert (await c.post("/api/v1/baby/children", headers=h,
                         json={"id": str(uuid4()), "name": "Denied"})).status_code == 403
    assert (await c.patch(f"/api/v1/baby/children/{identifier}", headers=h,
                          json={"revision": 1, "name": "Denied"})).status_code == 403
    result = await c.get("/api/v1/baby/children", headers=h)
    assert [(item["name"], item["revision"]) for item in result.json()["items"]] == [("Original", 1)]

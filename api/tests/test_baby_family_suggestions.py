"""F4h category decisions never use another readable space's categories."""
from app.domains.baby.models import BabyMembership, BabyRecord
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_accept_bulk_dismiss_and_replay_stay_in_target_space(baby_api, family):
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    category = shared.payload("collection", title="Same category name", data={"record_ids": []})
    assert (await c.post("/api/v1/baby/records", headers=records.headers(personal, generation=1), json=category)).status_code == 200
    sources = []
    for _ in range(3):
        source = shared.payload("source", data={"suggested_category": {"name": category["title"], "confidence": 1}})
        assert (await c.post("/api/v1/baby/records", headers=records.headers(family), json=source)).status_code == 200
        sources.append(source)
    result = await c.post("/api/v1/baby/suggested-categories", headers=records.headers(family),
                          json={"action": "accept", "items": [{"record_id": item["id"], "revision": 1} for item in sources[:2]]})
    assert result.status_code == 200, result.text
    target = result.json()["collections"][0]
    assert target["space_id"] == str(family) and target["id"] != category["id"]
    assert len(target["data"]["record_ids"]) == 2
    dismissed = await c.post(f"/api/v1/baby/records/{sources[2]['id']}/suggested-category",
                             headers=records.headers(family), json={"action": "dismiss", "revision": 1})
    assert dismissed.status_code == 200 and dismissed.json()["results"][0]["status"] == "dismissed"
    replay = await c.post(f"/api/v1/baby/records/{sources[2]['id']}/suggested-category",
                          headers=records.headers(family), json={"action": "dismiss", "revision": 1})
    assert replay.status_code == 200 and replay.json()["records"] == []
    async with baby_api.sessions() as db:
        private = await db.get(BabyRecord, category["id"])
        assert private.data["record_ids"] == [] and private.revision == 1
        for source in sources:
            row = await db.get(BabyRecord, source["id"])
            assert row.space_id == family and row.change_seq > 0 and row.revision == 2

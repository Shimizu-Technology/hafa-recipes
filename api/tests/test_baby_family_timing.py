"""F4k timing tips derive child dates only from readable member spaces."""
from datetime import datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.domains.baby.models import BabyMembership, BabySpaceMember
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_family_timing_child_and_legacy_personal_only_resolution(baby_api, family):
    c = baby_api.client
    child_id = str(uuid4())
    today = datetime.now(ZoneInfo("Pacific/Guam")).date()
    child = {"id": child_id, "name": "Family child", "due_date": (today + timedelta(days=140)).isoformat()}
    assert (await c.post("/api/v1/baby/children", headers=records.headers(family), json=child)).status_code == 200
    tip = shared.payload("source", title="Current family tip", data={"relevance": {
        "stage": "pregnancy", "pregnancy_week_min": 19, "pregnancy_week_max": 21}})
    assert (await c.post("/api/v1/baby/records", headers=records.headers(family), json=tip)).status_code == 200
    for suffix in ("", f"&timing_child_id={child_id}"):
        result = await c.get("/api/v1/baby/records?timing=now" + suffix, headers={"X-Baby-Client": "3"})
        assert result.status_code == 200, result.text
        assert result.json()["timing"]["child_id"] == child_id
        assert result.json()["items"][0]["id"] == tip["id"]
    for h in ({}, {"X-Baby-Client": "2"}):
        assert (await c.get("/api/v1/baby/records?timing=now", headers=h)).status_code == 422
        assert (await c.get(f"/api/v1/baby/records?timing=now&timing_child_id={child_id}", headers=h)).status_code == 404
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        (await db.get(BabySpaceMember, (family, "owner"))).status = "removed"
        await db.commit()
    result = await c.get(f"/api/v1/baby/records?timing=now&timing_child_id={child_id}", headers={"X-Baby-Client": "3"})
    assert result.status_code == 404
    # Explicit age/week queries need no child, while hidden family tips remain excluded.
    result = await c.get("/api/v1/baby/records?timing=now&pregnancy_week=20", headers=records.headers(personal, generation=1))
    assert result.status_code == 200 and result.json()["items"] == []

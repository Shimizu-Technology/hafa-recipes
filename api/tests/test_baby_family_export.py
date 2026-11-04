"""F4j exports exactly readable personal/family content, across client levels."""
import pytest

from app.domains.baby.models import BabyMembership, BabySpaceMember
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_export_respects_spaces_and_caregiver_kind_filter(baby_api, family, client):
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        other_personal = (await db.get(BabyMembership, "other")).personal_space_id
    samples = [(personal, 1, "owner", "journal", {}), (other_personal, 1, "other", "journal", {}),
               (family, 7, "other", "source", {}), (family, 7, "other", "diaper", {"type": "wet"})]
    identifiers = []
    for space, generation, actor, kind, data in samples:
        body = shared.payload(kind, data=data)
        assert (await c.post("/api/v1/baby/records", headers=records.headers(space, actor, generation), json=body)).status_code == 200
        identifiers.append(body["id"])
    h = {"X-Baby-Client": client} if client else {}
    result = await c.get("/api/v1/baby/export", headers=h)
    assert result.status_code == 200, result.text
    assert {r["id"] for r in result.json()["records"]} == ({identifiers[0], identifiers[2], identifiers[3]} if client == "3" else {identifiers[0]})
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "owner"))).role = "caregiver"
        await db.commit()
    result = await c.get("/api/v1/baby/export", headers={"X-Baby-Client": "3"})
    assert {r["id"] for r in result.json()["records"]} == {identifiers[0], identifiers[3]}


from tests import test_baby_family_attachments as files  # noqa: E402
from tests import test_baby_family_chat as chats  # noqa: E402

upload = files.upload


async def test_export_hides_unattached_upload_and_lost_chat_context(baby_api, family, upload, monkeypatch):
    c, identifier = baby_api.client, await upload()
    other = {"X-Test-Owner": "other", "X-Baby-Client": "3"}
    assert (await c.get("/api/v1/baby/export", headers=other)).json()["attachments"] == []
    assert (await c.post("/api/v1/baby/records", headers=records.headers(family),
                         json=shared.payload("source", data={"attachment_ids": [identifier]}))).status_code == 200
    assert (await c.get("/api/v1/baby/export", headers=other)).json()["attachments"][0]["id"] == identifier
    await chats.test_conversation_with_lost_family_context_is_hidden_on_list_detail_and_replay(baby_api, family, monkeypatch)
    result = await c.get("/api/v1/baby/export", headers={"X-Baby-Client": "3"})
    assert result.status_code == 200 and result.json()["conversations"] == [] and result.json()["messages"] == []

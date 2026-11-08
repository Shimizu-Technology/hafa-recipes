"""F4g Ask context, uncited-record races and private conversation publication."""
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.access import access_for, touch
from app.domains.baby.models import (
    BabyConversation,
    BabyMembership,
    BabyMessage,
    BabyRecord,
    BabySpaceMember,
)
from app.domains.baby.provider import AnswerOutput
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


@pytest.mark.parametrize("selected_child", [False, True])
@pytest.mark.parametrize("race", ["none", "move", "remove"])
async def test_every_model_record_rechecked_even_without_citation(baby_api, family, monkeypatch, race, selected_child):
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        other_personal = (await db.get(BabyMembership, "other")).personal_space_id
    h = records.headers(personal, generation=1)
    assert (await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": True})).status_code == 200
    visible = shared.payload("source", title="Shared plan", data={"source_text": "FAMILY_ONLY_CONTEXT"})
    hidden = shared.payload("journal", title="Other private journal", body="OTHER_PRIVATE_CONTEXT")
    assert (await c.post("/api/v1/baby/records", headers=records.headers(family), json=visible)).status_code == 200
    assert (await c.post("/api/v1/baby/records", headers=records.headers(other_personal, "other", 1), json=hidden)).status_code == 200
    calls = []

    class Provider:
        enabled = True
        gate = None

        async def answer(self, **kwargs):
            await self.gate()
            context = kwargs["context"]
            assert hidden["id"] not in {row["id"] for row in context}
            calls.append(context)
            if len(calls) == 1:
                assert visible["id"] in {row["id"] for row in context}
                if race != "none":
                    async with baby_api.sessions() as db:
                        access = await access_for(db, "other", client="3", space_id=family, write=True)
                        if race == "move":
                            row = await db.get(BabyRecord, visible["id"])
                            row.space_id, row.generation, row.revision = other_personal, 1, row.revision + 1
                            await touch(row, next(g for g in access.spaces if g.id == other_personal))
                        else:
                            link = await db.get(BabySpaceMember, (family, "owner"))
                            link.status, link.access_version = "removed", 2
                        await db.commit()
                    return AnswerOutput(message="Discard this stale family answer", citation_ids=[])
            return AnswerOutput(message="Current safe answer", citation_ids=[])

    monkeypatch.setattr("app.domains.baby.chat.BabyProvider", Provider)
    body = {"request_id": str(uuid4()), "message": "Summarize everything", "scope": "all"}
    if selected_child:
        child = {"id": str(uuid4()), "name": "Selected baby"}
        assert (await c.post("/api/v1/baby/children", headers=h, json=child)).status_code == 200
        body["child_id"] = child["id"]
    result = await c.post("/api/v1/baby/chat", headers=h, json=body)
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "Current safe answer"
    assert len(calls) == (1 if race == "none" else 2)
    if race != "none":
        assert visible["id"] not in {row["id"] for row in calls[1]}
    async with baby_api.sessions() as db:
        conversation = await db.get(BabyConversation, result.json()["conversation_id"])
        messages = list(await db.scalars(select(BabyMessage)))
        assert conversation.space_id == personal and conversation.change_seq > 0
        assert all(row.space_id == personal and row.change_seq > 0 for row in messages)
        assert str(family) in conversation.context_space_ids if race == "none" else str(family) not in conversation.context_space_ids
    detail = await c.get(f"/api/v1/baby/conversations/{result.json()['conversation_id']}", headers=h)
    assert detail.status_code == 200
    assert (await c.get(f"/api/v1/baby/conversations/{result.json()['conversation_id']}", headers=records.headers(other_personal, "other", 1))).status_code == 404
    assert (await c.post("/api/v1/baby/chat", headers=records.headers(family), json={**body, "request_id": str(uuid4())})).status_code in {403, 422}


async def test_conversation_with_lost_family_context_is_hidden_on_list_detail_and_replay(baby_api, family, monkeypatch):
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    h = records.headers(personal, generation=1)
    await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": True})
    await c.post("/api/v1/baby/records", headers=records.headers(family), json=shared.payload("source"))

    class Provider:
        enabled = True
        async def answer(self, **kwargs):
            return AnswerOutput(message="Shared context answer", citation_ids=[])

    monkeypatch.setattr("app.domains.baby.chat.BabyProvider", Provider)
    body = {"request_id": str(uuid4()), "message": "Summarize everything", "scope": "all"}
    result = await c.post("/api/v1/baby/chat", headers=h, json=body)
    assert result.status_code == 200, result.text
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "owner"))).status = "removed"
        await db.commit()
    assert (await c.get("/api/v1/baby/conversations", headers=h)).json()["items"] == []
    assert (await c.get(f"/api/v1/baby/conversations/{result.json()['conversation_id']}", headers=h)).status_code == 404
    assert (await c.post("/api/v1/baby/chat", headers=h, json=body)).status_code == 404


async def test_uncited_care_aggregate_inputs_are_rechecked(baby_api, family, monkeypatch):
    from datetime import UTC, datetime

    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        other_personal = (await db.get(BabyMembership, "other")).personal_space_id
    h = records.headers(personal, generation=1)
    await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": True})
    feed = shared.payload("feeding", occurred_at=datetime.now(UTC).isoformat(),
                          data={"method": "bottle", "amount": 30, "unit": "ml"})
    assert (await c.post("/api/v1/baby/records", headers=records.headers(family), json=feed)).status_code == 200

    async def no_citable_records(*args, **kwargs):
        return [], {}, None

    monkeypatch.setattr("app.domains.baby.chat.retrieve", no_citable_records)
    calls = []

    class Provider:
        enabled = True
        async def answer(self, **kwargs):
            calls.append(kwargs["context_pack"])
            if len(calls) == 1:
                assert calls[0]["care_with_no_child"]["today_totals"]["feeding"]["count"] == 1
                async with baby_api.sessions() as db:
                    access = await access_for(db, "other", client="3", space_id=family, write=True)
                    row = await db.get(BabyRecord, feed["id"])
                    row.space_id, row.generation, row.revision = other_personal, 1, row.revision + 1
                    await touch(row, next(g for g in access.spaces if g.id == other_personal))
                    await db.commit()
                return AnswerOutput(message="Stale totals", citation_ids=[])
            assert "care_with_no_child" not in calls[1]
            return AnswerOutput(message="Fresh totals", citation_ids=[])

    monkeypatch.setattr("app.domains.baby.chat.BabyProvider", Provider)
    result = await c.post("/api/v1/baby/chat", headers=h,
                          json={"request_id": str(uuid4()), "message": "Today overview", "scope": "all"})
    assert result.status_code == 200 and result.json()["message"] == "Fresh totals", (result.text, calls)
    assert len(calls) == 2


@pytest.mark.parametrize("send_stale_child", [False, True])
async def test_deleted_family_child_does_not_dead_end_other_parents_chat(baby_api, family, monkeypatch, send_stale_child):
    c, child = baby_api.client, {"id": str(uuid4()), "name": "Family child"}
    assert (await c.post("/api/v1/baby/children", headers=records.headers(family), json=child)).status_code == 200
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    h = records.headers(personal, generation=1)
    await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": True})

    class Provider:
        enabled = True
        async def answer(self, **kwargs):
            return AnswerOutput(message="Saved answer", citation_ids=[])

    monkeypatch.setattr("app.domains.baby.chat.BabyProvider", Provider)
    body = {"request_id": str(uuid4()), "message": "Overview", "scope": "all", "child_id": child["id"]}
    first = await c.post("/api/v1/baby/chat", headers=h, json=body)
    assert first.status_code == 200, first.text
    identifier = first.json()["conversation_id"]
    assert (await c.delete(f"/api/v1/baby/children/{child['id']}?revision=1", headers=records.headers(family, "other"))).status_code == 204
    async with baby_api.sessions() as db:
        conversation = await db.get(BabyConversation, identifier)
        assert str(conversation.child_id) == child["id"]  # The deleting parent did not edit another personal space.
        previous = conversation.change_seq
    assert (await c.get(f"/api/v1/baby/conversations/{identifier}", headers=h)).json()["child_id"] is None
    assert (await c.get("/api/v1/baby/conversations", headers=h)).json()["items"][0]["child_id"] is None
    response = await c.post("/api/v1/baby/chat", headers=h, json={**body,
        "request_id": str(uuid4()), "conversation_id": identifier, "child_id": child["id"] if send_stale_child else None})
    assert response.status_code == 200, response.text
    async with baby_api.sessions() as db:
        conversation = await db.get(BabyConversation, identifier)
        assert conversation.child_id is None and conversation.change_seq > previous

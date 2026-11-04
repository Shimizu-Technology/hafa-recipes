"""F2 provisioning races and actual creation journeys on PostgreSQL."""
import ast
import asyncio
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app.domains.baby import models
from app.domains.baby.models import BabyMembership, BabySpace, BabySpaceMember
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from app.models.identity import AppUser
from tests import test_baby_integration as shared
from tests import test_baby_share_integration as native
from tests import test_baby_timing_suggestions as suggestions

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


async def test_concurrent_bootstrap_and_first_write_provision_once(baby_api):
    async with baby_api.sessions() as db:
        db.add_all([AppUser(id="fresh"), AppUser(id="legacy")])
        await db.flush()
        db.add(BabyMembership(app_user_id="legacy", generation=7))
        await db.commit()
    c = baby_api.client
    responses = await asyncio.gather(*(c.post(
        "/api/v1/baby/bootstrap", headers={"X-Test-Owner": "fresh"}
    ) for _ in range(8)))
    assert all(r.status_code == 200 for r in responses)
    assert (await c.post("/api/v1/baby/records", headers={
        "X-Test-Owner": "legacy", "X-Baby-Generation": "7"
    }, json=shared.payload())).status_code == 200
    async with baby_api.sessions() as db:
        for owner, generation in (("fresh", 1), ("legacy", 7)):
            spaces = list(await db.scalars(select(BabySpace).where(BabySpace.created_by == owner)))
            assert len(spaces) == 1 and spaces[0].generation == generation
            member = await db.get(BabyMembership, owner)
            assert member.personal_space_id == spaces[0].id
            assert await db.scalar(select(func.count()).select_from(BabySpaceMember).where(
                BabySpaceMember.app_user_id == owner)) == 1


@pytest.mark.parametrize("journey", ["records_children", "import_worker", "chat", "uploads", "native", "categories"])
async def test_each_creation_journey_stores_personal_space(baby_api, monkeypatch, journey):
    expected = []
    if journey == "records_children":
        await shared.test_ownership_idempotency_revision_child_clear_and_search(baby_api)
        expected = [models.BabyChild, models.BabyRecord]
    elif journey == "import_worker":
        await shared.test_durable_import_restart_retry_cancel_and_user_edits_win(baby_api)
        expected = [models.BabyImport, models.BabyRecord]
    elif journey == "chat":
        await shared.test_grounded_chat_history_idempotency_proposal_and_consent(baby_api, monkeypatch)
        expected = [models.BabyConversation, models.BabyMessage]
    elif journey == "uploads":
        await shared.test_private_attachment_cleanup_and_owner_access(baby_api, monkeypatch)
        expected = [models.BabyAttachment]
    elif journey == "native":
        baby_api.client._transport.app.include_router(native.router)
        capability = await native.session(baby_api.client)
        response = await baby_api.client.post("/api/v1/baby/share/captures",
                                               headers=capability, json=native.capture())
        assert response.status_code == 202, response.text
        expected = [BabyShareCapture, BabyShareCredential, models.BabyRecord]
    else:
        await suggestions.test_accept_bulk_accept_dismiss_and_ownership(baby_api)
        expected = [models.BabyRecord]
    async with baby_api.sessions() as db:
        for model in expected:
            rows = list(await db.scalars(select(model)))
            assert rows, (journey, model)
            for row in rows:
                member = await db.get(BabyMembership, row.app_user_id)
                assert row.space_id is not None and row.space_id == member.personal_space_id


def test_creation_site_inventory_requires_explicit_space():
    names = {"Baby" + name for name in (
        "Record", "Child", "Attachment", "Import", "Conversation", "Message", "ShareCapture", "ShareCredential"
    )}
    sites = []
    for path in Path("api/app").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in names:
                assert "space_id" in {kw.arg for kw in node.keywords}, (path, node.lineno)
                sites.append((str(path), node.lineno))
    assert len(sites) >= 12


async def test_startup_requires_both_markers(baby_api, monkeypatch):
    from app.domains.baby.runtime import verify_baby_schema
    monkeypatch.setattr("app.domains.baby.runtime.get_settings", lambda: baby_api.settings)
    for version in (56, 57):
        async with baby_api.engine.begin() as db:
            await db.execute(text("DELETE FROM schema_migrations WHERE version=:v"), {"v": version})
        with pytest.raises(RuntimeError, match=f"migration{version:03} before deploying F2"):
            await verify_baby_schema(baby_api.sessions)
        async with baby_api.engine.begin() as db:
            await db.execute(text("INSERT INTO schema_migrations VALUES(:v,'test')"), {"v": version})


async def test_erasure_and_reenrollment_keep_personal_fence_in_step(baby_api):
    c = baby_api.client
    response = await c.delete("/api/v1/baby/data?generation=1", headers=shared.GEN)
    assert response.status_code == 200
    for status in ("deleted", "active"):
        async with baby_api.sessions() as db:
            member = await db.get(BabyMembership, "owner")
            space = await db.get(BabySpace, member.personal_space_id)
            assert member.generation == space.generation == 2
            assert member.status == space.status == status
        if status == "deleted":
            assert (await c.post("/api/v1/baby/enroll", headers={"X-Baby-Generation": "2"})).status_code == 200


async def test_get_bootstrap_stays_read_only_and_takes_no_owner_lock(baby_api):
    async with baby_api.sessions() as db:
        db.add(AppUser(id="legacy"))
        await db.flush()
        db.add(BabyMembership(app_user_id="legacy", generation=1))
        await db.commit()
    async with baby_api.sessions() as holder:
        await holder.execute(text("SELECT id FROM app_users WHERE id='legacy' FOR UPDATE"))
        response = await asyncio.wait_for(
            baby_api.client.get("/api/v1/baby/bootstrap", headers={"X-Test-Owner": "legacy"}), 5
        )
        await holder.rollback()
    assert response.status_code == 200
    async with baby_api.sessions() as db:
        assert await db.scalar(
            select(func.count()).select_from(BabySpace).where(BabySpace.created_by == "legacy")
        ) == 0

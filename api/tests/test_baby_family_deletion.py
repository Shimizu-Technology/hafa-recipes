"""F9c exercises the live Recipes erasure route and real private-file cleanup."""
import importlib
from uuid import UUID

import pytest
from sqlalchemy import delete

from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyMembership,
    BabyRecord,
    BabySpace,
    BabySpaceMember,
)
from app.models.identity import AppUser
from app.models.recipe import Recipe
from tests import test_baby_family_records as records
from tests import test_baby_moves as moves
from tests import test_baby_privacy_integration as privacy

baby_api, privacy_api, pytestmark = privacy.baby_api, privacy.privacy_api, privacy.pytestmark


@pytest.fixture
async def family_case(privacy_api):
    api = privacy_api
    api.settings.baby_family_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(
        configured=api.settings, migration_engine=api.engine)
    case = await privacy.seed_private(api)
    async with api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    family = await moves.family_for(api, personal)
    async with api.sessions() as db:
        db.add(BabySpaceMember(space_id=family, app_user_id="other", role="parent"))
        await db.commit()
        source = await db.get(BabyRecord, case.capture["record_id"])
        family_asset = await db.get(BabyAttachment, source.data["attachment_ids"][0])
        family_path = privacy.storage.local_path(family_asset.object_key)
    return api, case, personal, family, family_asset.id, family_path


async def test_recipes_account_delete_retains_shared_history_and_erases_journal_files(family_case):
    api, case, personal, family, family_asset, family_path = family_case
    recipes, _ = await privacy.seed_shared_products(api)
    before = family_path.read_bytes()
    result = await api.client.delete("/api/users/me")
    assert result.status_code == 202, result.text
    async with api.sessions() as db:
        assert await db.get(AppUser, "owner") is None
        assert await db.get(BabySpace, personal) is None
        assert await db.get(BabySpace, family) is not None
        assert await db.get(BabyRecord, case.entry["id"]) is None
        for model, identifier in ((BabyRecord, case.capture["record_id"]), (BabyChild, case.child_id), (BabyAttachment, family_asset)):
            row = await db.get(model, identifier)
            assert row is not None and row.app_user_id is None and row.space_id == family
        assert await db.get(Recipe, recipes["owner"].id) is None
        assert await db.get(Recipe, recipes["other"].id) is not None
    await privacy.complete_cleanup(api, UUID(result.json()["cleanup"]["id"]))
    assert not case.path.exists() and family_path.read_bytes() == before
    response = await api.client.get(f"/api/v1/baby/attachments/{family_asset}", headers=records.headers(family, "other", 1))
    assert response.status_code == 200 and response.content == before


async def test_recipes_delete_with_no_baby_data_still_works(privacy_api):
    api = privacy_api
    recipes, _ = await privacy.seed_shared_products(api)
    async with api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        await db.execute(delete(BabySpace).where(BabySpace.id == personal))
        await db.execute(delete(BabyMembership).where(BabyMembership.app_user_id == "owner"))
        await db.commit()
    result = await api.client.delete("/api/users/me")
    assert result.status_code == 202, result.text
    async with api.sessions() as db:
        assert await db.get(AppUser, "owner") is None and await db.get(AppUser, "other") is not None
        assert await db.get(Recipe, recipes["owner"].id) is None
        assert await db.get(Recipe, recipes["other"].id) is not None


@pytest.mark.parametrize("action", ["leave", "remove"])
async def test_family_exit_preserves_personal_and_invalidates_context(family_case, action):
    api, case, personal, family, asset, path = family_case
    c = api.client
    h = records.headers(personal, generation=1)
    chat = await c.post("/api/v1/baby/chat", headers=h, json={"message": "Summarize everything", "scope": "all"})
    assert chat.status_code == 200, chat.text
    conversation = chat.json()["conversation_id"]
    if action == "leave":
        result = await c.post(f"/api/v1/baby/family/{family}/leave", headers=records.headers(family, generation=1))
    elif action == "remove":
        result = await c.delete(f"/api/v1/baby/family/{family}/members/owner", headers=records.headers(family, "other", 1))
    elif action == "data":
        result = await c.delete("/api/v1/baby/data?generation=1", headers=h)
    else:
        result = await c.delete(f"/api/v1/baby/family/{family}", headers=records.headers(family, generation=1))
    assert result.status_code == 200, result.text
    async with api.sessions() as db:
        assert await db.get(BabyConversation, conversation) is None
        assert (await db.get(BabyRecord, case.entry["id"]) is not None) == (action != "data")
        assert (await db.get(BabySpace, personal) is not None) == (action != "data")
        assert (await db.get(BabyRecord, case.capture["record_id"]) is not None) == (action != "family")
    assert (await c.get(f"/api/v1/baby/records/{case.capture['record_id']}", headers=records.headers(family, generation=1))).status_code in {403, 404, 409}


async def test_last_parent_must_delete_family_and_memberless_personal_is_swept(family_case):
    api, case, personal, family, asset, path = family_case
    async with api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        orphan = BabySpace(kind="personal", generation=1, created_by=None)
        db.add(orphan)
        await db.commit()
        orphan_id = orphan.id
    result = await api.client.post(f"/api/v1/baby/family/{family}/leave", headers=records.headers(family, generation=1))
    assert result.status_code == 409
    result = await api.client.delete("/api/users/me")
    assert result.status_code == 202, result.text
    async with api.sessions() as db:
        assert await db.get(BabySpace, family) is None and await db.get(BabySpace, orphan_id) is None
        assert await db.get(AppUser, "other") is not None
    await privacy.complete_cleanup(api, UUID(result.json()["cleanup"]["id"]))
    assert not path.exists() and not case.path.exists()


async def test_other_parent_prevents_family_deletion(family_case):
    api, case, personal, family, asset, path = family_case
    result = await api.client.delete(f"/api/v1/baby/family/{family}", headers=records.headers(family, generation=1))
    assert result.status_code == 409, result.text
    async with api.sessions() as db:
        assert await db.get(BabySpace, family) is not None


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_data_erasure_never_exits_family(family_case, client):
    api, case, personal, family, asset, path = family_case
    h = records.headers(personal, generation=1)
    h.pop("X-Baby-Client")
    if client:
        h["X-Baby-Client"] = client
    result = await api.client.delete("/api/v1/baby/data?generation=1", headers=h)
    assert result.status_code == (409 if client == "3" else 200), result.text
    if client == "3":
        assert result.json()["detail"]["code"] == "family_exit_required"
    async with api.sessions() as db:
        assert (await db.get(BabySpaceMember, (family, "owner"))).status == "active"
        assert await db.get(BabyRecord, case.capture["record_id"]) is not None


@pytest.mark.parametrize("action", ["leave", "remove", "account"])
async def test_exit_retires_unattached_family_upload(family_case, action):
    from io import BytesIO
    from uuid import uuid4

    from PIL import Image

    api, case, personal, family, asset, path = family_case
    png = BytesIO()
    Image.new("RGB", (16, 16), "blue").save(png, "PNG")
    identifier = uuid4()
    h = records.headers(family, generation=1)
    uploaded = await api.client.post("/api/v1/baby/attachments", headers={**h, "Idempotency-Key": str(identifier)},
        files={"file": ("unattached.png", png.getvalue(), "image/png")})
    assert uploaded.status_code == 200, uploaded.text
    async with api.sessions() as db:
        unattached_path = privacy.storage.local_path((await db.get(BabyAttachment, identifier)).object_key)
    assert unattached_path.is_file()
    if action == "leave":
        result = await api.client.post(f"/api/v1/baby/family/{family}/leave", headers=h)
    elif action == "remove":
        result = await api.client.delete(f"/api/v1/baby/family/{family}/members/owner", headers=records.headers(family, "other", 1))
    else:
        result = await api.client.delete("/api/users/me")
    assert result.status_code in {200, 202}, result.text
    async with api.sessions() as db:
        assert (await db.get(BabyAttachment, identifier)).state == "deleted"
        assert (await db.get(BabyAttachment, asset)).state == "ready"
        from sqlalchemy import select

        from app.models.deletion import DeletionCleanupJob

        jobs = list(await db.scalars(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued")))
    for job in jobs:
        await privacy.complete_cleanup(api, job.id)
    assert not unattached_path.exists() and path.is_file()


async def test_account_delete_cancels_surviving_family_source(family_case):
    api, case, personal, family, asset, path = family_case
    result = await api.client.delete("/api/users/me")
    assert result.status_code == 202, result.text
    async with api.sessions() as db:
        source = await db.get(BabyRecord, case.capture["record_id"])
        assert source.data["status"] == "cancelled"
        assert source.change_seq > 0


async def test_pre_contract_null_space_chat_does_not_break_recipes_deletion(privacy_api):
    api = privacy_api
    from uuid import uuid4
    async with api.sessions() as db:
        db.add(BabyConversation(id=uuid4(), app_user_id="owner", generation=1, space_id=None, title="Legacy chat"))
        await db.commit()
    result = await api.client.delete("/api/users/me")
    assert result.status_code == 202, result.text

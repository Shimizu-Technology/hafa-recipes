"""Private erasure acceptance through real PostgreSQL, API routes and file cleanup.

Reuse the disposable Baby API fixture. Only external AI/Clerk/shared S3 calls
are replaced; Baby bytes live on disk and the durable cleanup worker removes
them through the production adapter path.
"""

from io import BytesIO
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import func, select

from app import deletion_cleanup as cleanup
from app.config import Settings
from app.domains.baby import storage
from app.domains.baby.models import (
    BabyAIAdmission,
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMembership,
    BabyMessage,
    BabyRecord,
)
from app.domains.baby.provider import AnswerOutput, BabyProvider
from app.domains.baby.runtime import BabyWorker
from app.domains.workouts.models import WorkoutRecord
from app.models.deletion import DeletedAuthIdentity, DeletionCleanupJob
from app.models.identity import AppUser, ClerkIdentity
from app.models.recipe import Recipe
from app.routers.users import router as users_router
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)
PRIVATE_MODELS = (BabyChild, BabyRecord, BabyAttachment, BabyImport, BabyConversation, BabyMessage)


def headers(owner="owner", generation=1):
    return {"X-Test-Owner": owner, "X-Baby-Generation": str(generation)}


@pytest.fixture
async def privacy_api(baby_api, monkeypatch, tmp_path):
    # This is the same ASGI application and dependency overrides as the existing
    # integration fixture, extended with the real shared account-delete route.
    baby_api.client._transport.app.include_router(users_router)
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            environment="test",
            baby_local_storage_dir=str(tmp_path),
        ),
    )
    monkeypatch.setattr(cleanup, "AsyncSessionLocal", baby_api.sessions)
    monkeypatch.setattr(
        cleanup,
        "settings",
        Settings(
            database_url="postgresql://localhost/hafa_baby_disposable_test",
            database_use_ssl=False,
            openai_api_key="test-only",
            environment="test",
            clerk_development_issuer="https://example.test",
            clerk_development_secret_key="test-only",
        ),
    )
    deleted_subjects, shared_prefixes = [], []

    class ClerkBoundary:
        def __init__(self, *args, **kwargs):
            pass

        async def delete_user(self, subject):
            deleted_subjects.append(subject)
            return True

    class SharedStorageBoundary:
        is_enabled = True

        async def delete_prefix(self, prefix):
            shared_prefixes.append(prefix)

    async def answer(self, **kwargs):
        await self.gate()
        return AnswerOutput(message="Synthetic saved note", citation_ids=[])

    monkeypatch.setattr(cleanup, "ClerkBackendClient", ClerkBoundary)
    monkeypatch.setattr(cleanup, "storage_service", SharedStorageBoundary())
    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(BabyProvider, "answer", answer)
    async with baby_api.engine.begin() as connection:
        await connection.run_sync(
            lambda sync: WorkoutRecord.__table__.create(sync, checkfirst=True)
        )
    return SimpleNamespace(
        **vars(baby_api),
        root=tmp_path,
        deleted_subjects=deleted_subjects,
        shared_prefixes=shared_prefixes,
    )


async def seed_private(api, owner="owner"):
    c, h = api.client, headers(owner)
    child_id, asset_id = str(uuid4()), str(uuid4())
    child = await c.post(
        "/api/v1/baby/children", headers=h, json={"id": child_id, "name": "Synthetic child"}
    )
    assert child.status_code == 200, child.text
    assert (
        await c.patch(
            "/api/v1/baby/profile",
            headers=h,
            json={"display_name": "Synthetic caregiver", "ai_consent": True},
        )
    ).status_code == 200
    png = BytesIO()
    Image.new("RGB", (16, 16), "white").save(png, "PNG")
    uploaded = await c.post(
        "/api/v1/baby/attachments",
        headers={**h, "Idempotency-Key": asset_id},
        files={"file": ("private.png", png.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    entry = await c.post(
        "/api/v1/baby/records",
        headers=h,
        json=shared.payload(
            child_id=child_id,
            data={"attachment_ids": [asset_id]},
        ),
    )
    assert entry.status_code == 200, entry.text
    capture = await c.post(
        "/api/v1/baby/imports",
        headers=h,
        json={
            "id": str(uuid4()),
            "text": "Synthetic capture text",
            "child_id": child_id,
            "attachment_ids": [asset_id],
        },
    )
    assert capture.status_code == 200, capture.text
    chat = await c.post(
        "/api/v1/baby/chat",
        headers=h,
        json={
            "request_id": str(uuid4()),
            "message": "Find my saved note",
            "scope": "journal",
            "record_id": entry.json()["id"],
            "child_id": child_id,
        },
    )
    assert chat.status_code == 200, chat.text
    async with api.sessions() as db:
        asset = await db.get(BabyAttachment, UUID(asset_id))
        path = api.root / asset.object_key
        assert path.is_file()
    read = await c.get(f"/api/v1/baby/attachments/{asset_id}", headers=h)
    assert read.status_code == 200 and read.content == path.read_bytes()
    assert read.headers["Cache-Control"] == "private, no-store"
    return SimpleNamespace(
        owner=owner,
        child_id=child_id,
        asset_id=asset_id,
        entry=entry.json(),
        capture=capture.json(),
        conversation_id=chat.json()["conversation_id"],
        path=path,
        original_bytes=read.content,
    )


async def seed_shared_products(api):
    async with api.sessions() as db:
        recipe, workout = {}, {}
        for owner in ("owner", "other"):
            recipe[owner] = Recipe(
                user_id=owner,
                source_url="manual://privacy-test",
                source_type="manual",
                extracted={"title": "Synthetic recipe"},
            )
            workout[owner] = WorkoutRecord(
                app_user_id=owner, generation=1, content={"title": "Synthetic workout"}
            )
            db.add_all([recipe[owner], workout[owner]])
        await db.commit()
        return recipe, workout


async def assert_owner_erased(api, owner, *, membership_remains):
    async with api.sessions() as db:
        for model in PRIVATE_MODELS:
            assert (
                await db.scalar(
                    select(func.count()).select_from(model).where(model.app_user_id == owner)
                )
                == 0
            )
        member = await db.get(BabyMembership, owner)
        if membership_remains:
            assert member.status == "deleted" and member.generation == 2
            assert member.profile == {} and member.consent_epoch >= 2
        else:
            assert member is None


async def complete_cleanup(api, job_id):
    # A new worker instance recovers persisted intent; no daemon or network.
    worker = cleanup.DurableDeletionCleanupWorker()
    assert await worker.claim_next_job() == job_id
    await worker.execute_claimed_job(job_id)
    async with api.sessions() as db:
        job = await db.get(DeletionCleanupJob, job_id)
        assert job.status == "completed" and job.completed_at is not None
        assert job.storage_prefixes == [] and job.clerk_identities == []
    assert await cleanup.DurableDeletionCleanupWorker().claim_next_job() is None


async def test_child_delete_retains_private_bytes_records_import_and_conversation(privacy_api):
    api, c = privacy_api, privacy_api.client
    case, other = await seed_private(api), await seed_private(api, "other")
    deleted = await c.delete(f"/api/v1/baby/children/{case.child_id}?revision=1", headers=headers())
    assert deleted.status_code == 204, deleted.text
    async with api.sessions() as db:
        child = await db.get(BabyChild, UUID(case.child_id))
        assert child.deleted_at is not None and child.name == ""
        records = list(
            await db.scalars(select(BabyRecord).where(BabyRecord.app_user_id == "owner"))
        )
        assert len(records) == 2 and all(
            r.child_id is None and r.deleted_at is None for r in records
        )
        assert all(r.data["attachment_ids"] == [case.asset_id] and r.revision == 2 for r in records)
        job = await db.get(BabyImport, UUID(case.capture["id"]))
        assert job.status == "queued" and job.request["child_id"] is None
        assert job.request["attachment_ids"] == [case.asset_id]
        conversation = await db.get(BabyConversation, UUID(case.conversation_id))
        assert conversation.child_id is None and conversation.record_id == UUID(case.entry["id"])
        assert (
            await db.scalar(
                select(func.count())
                .select_from(BabyMessage)
                .where(BabyMessage.app_user_id == "owner")
            )
            == 2
        )
        assert (await db.get(BabyAttachment, UUID(case.asset_id))).state == "ready"
        assert (
            await db.scalar(
                select(func.count())
                .select_from(DeletionCleanupJob)
                .where(DeletionCleanupJob.status == "queued")
            )
            == 0
        )
        assert (await db.get(BabyChild, UUID(other.child_id))).deleted_at is None
    assert case.path.read_bytes() == case.original_bytes
    assert (
        await c.get(f"/api/v1/baby/attachments/{case.asset_id}", headers=headers())
    ).content == case.original_bytes
    assert (
        await c.get(f"/api/v1/baby/attachments/{case.asset_id}", headers=headers("other"))
    ).status_code == 404

    # Processing the detached capture must not reattach its removed child.
    async def process(request, assets, provider, **kwargs):
        await kwargs["gate"]()
        assert request["child_id"] is None
        return {
            "title": "Processed",
            "data": {
                "source_text": "Synthetic capture text",
                "attachment_ids": request["attachment_ids"],
                "status": "ready",
            },
            "status": "ready",
        }

    assert await BabyWorker(api.sessions, processor=process).tick()
    source = (await c.get(f"/api/v1/baby/records/{case.capture['record_id']}")).json()
    assert source["child_id"] is None and source["data"]["attachment_ids"] == [case.asset_id]
    assert other.path.read_bytes() == other.original_bytes


async def test_export_and_product_erasure_complete_private_file_cleanup_preserve_shared_data(
    privacy_api,
):
    api, c = privacy_api, privacy_api.client
    case, other = await seed_private(api), await seed_private(api, "other")
    recipes, workouts = await seed_shared_products(api)
    exported = await c.get("/api/v1/baby/export")
    assert exported.status_code == 200
    data = exported.json()
    assert data["profile"]["display_name"] == "Synthetic caregiver"
    assert [x["id"] for x in data["children"]] == [case.child_id]
    assert {x["id"] for x in data["records"]} == {case.entry["id"], case.capture["record_id"]}
    assert [x["id"] for x in data["attachments"]] == [case.asset_id]
    assert set(data["attachments"][0]) == {"id", "name", "mime_type", "size"}
    assert [x["id"] for x in data["conversations"]] == [case.conversation_id]
    assert len(data["messages"]) == 2
    assert "baby-private/" not in exported.text and "object_key" not in exported.text
    assert other.asset_id not in exported.text and other.entry["id"] not in exported.text
    async with api.sessions() as db:
        db.add(
            BabyAIAdmission(
                app_user_id="owner", generation=1, capability="baby_chat", reserved_microusd=123
            )
        )
        await db.commit()
    erased = await c.delete("/api/v1/baby/data?generation=1", headers=headers())
    assert erased.status_code == 200 and erased.json()["generation"] == 2
    await assert_owner_erased(api, "owner", membership_remains=True)
    async with api.sessions() as db:
        assert await db.get(AppUser, "owner") is not None
        for owner in ("owner", "other"):
            assert await db.get(Recipe, recipes[owner].id) is not None
            assert await db.get(WorkoutRecord, workouts[owner].id) is not None
        admission = await db.scalar(
            select(BabyAIAdmission).where(BabyAIAdmission.app_user_id == "owner")
        )
        assert admission.reserved_microusd == 123
        queued = list(
            await db.scalars(
                select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued")
            )
        )
        assert len(queued) == 1 and queued[0].kind == "baby_media"
        assert queued[0].storage_prefixes == [str(case.path.parent.relative_to(api.root)) + "/"]
        job_id = queued[0].id
    assert case.path.is_file()  # Metadata is erased before eventual byte cleanup.
    for suffix in ("", "/metadata"):
        assert (await c.get(f"/api/v1/baby/attachments/{case.asset_id}{suffix}")).status_code == 409
    assert (await c.get("/api/v1/baby/bootstrap")).json()["active"] is False
    assert (
        await c.post("/api/v1/baby/records", headers=headers(), json=shared.payload())
    ).status_code == 409
    assert (
        await c.post(
            "/api/v1/baby/imports", headers=headers(), json={"id": str(uuid4()), "text": "Stale"}
        )
    ).status_code == 409
    assert (await c.post("/api/v1/baby/enroll", headers=headers(generation=2))).status_code == 200
    assert (await c.get(f"/api/v1/baby/attachments/{case.asset_id}")).status_code == 404
    assert (
        await c.post("/api/v1/baby/records", headers=headers(), json=shared.payload())
    ).status_code == 409

    async def process_other(request, assets, provider, **kwargs):
        assert request["id"] == other.capture["id"]  # Erased owner never executes.
        await kwargs["gate"]()
        return {
            "title": "Other source",
            "data": {
                "source_text": "Other capture",
                "attachment_ids": [other.asset_id],
                "status": "ready",
            },
            "status": "ready",
        }

    worker = BabyWorker(api.sessions, processor=process_other)
    assert await worker.tick() is True
    assert await worker.tick() is False
    await complete_cleanup(api, job_id)
    assert not case.path.parent.exists() and other.path.read_bytes() == other.original_bytes
    assert api.deleted_subjects == [] and api.shared_prefixes == []


async def test_whole_account_erasure_cascades_baby_and_cleans_only_owned_private_files(privacy_api):
    api, c = privacy_api, privacy_api.client
    case, other = await seed_private(api), await seed_private(api, "other")
    recipes, workouts = await seed_shared_products(api)
    async with api.sessions() as db:
        db.add(
            ClerkIdentity(
                app_user_id="owner",
                issuer="https://example.test",
                clerk_user_id="different-subject",
            )
        )
        db.add(
            BabyAIAdmission(
                app_user_id="owner", generation=1, capability="baby_chat", reserved_microusd=321
            )
        )
        await db.commit()
    deleted = await c.delete("/api/users/me")
    assert deleted.status_code == 202, deleted.text
    await assert_owner_erased(api, "owner", membership_remains=False)
    async with api.sessions() as db:
        assert await db.get(AppUser, "owner") is None and await db.get(AppUser, "other") is not None
        assert await db.get(Recipe, recipes["owner"].id) is None
        assert await db.get(WorkoutRecord, workouts["owner"].id) is None
        assert await db.get(Recipe, recipes["other"].id) is not None
        assert await db.get(WorkoutRecord, workouts["other"].id) is not None
        assert await db.scalar(select(func.count()).select_from(ClerkIdentity)) == 0
        tombstone = await db.scalar(select(DeletedAuthIdentity))
        assert tombstone.clerk_user_id_hash == cleanup.hash_auth_identity(
            "https://example.test", "different-subject"
        )
        admission = await db.scalar(select(BabyAIAdmission))
        assert admission.app_user_id is None and admission.reserved_microusd == 321
        job = await db.scalar(
            select(DeletionCleanupJob).where(DeletionCleanupJob.kind == "account")
        )
        assert job.status == "queued" and job.clerk_target_count == 1
        assert str(case.path.parent.relative_to(api.root)) + "/" in job.storage_prefixes
        assert all(other.asset_id not in prefix for prefix in job.storage_prefixes)
        job_id = job.id
    assert case.path.is_file()
    assert (await c.get(f"/api/v1/baby/attachments/{case.asset_id}")).status_code == 404
    await complete_cleanup(api, job_id)
    assert not case.path.parent.exists() and other.path.read_bytes() == other.original_bytes
    assert api.deleted_subjects == ["different-subject"]
    assert f"thumbnails/{recipes['owner'].id}/" in api.shared_prefixes
    assert "chat-images/owner/" in api.shared_prefixes
    # The surviving owner remains private and usable after the other account's erase.
    assert (
        await c.get(f"/api/v1/baby/attachments/{other.asset_id}", headers=headers("other"))
    ).content == other.original_bytes

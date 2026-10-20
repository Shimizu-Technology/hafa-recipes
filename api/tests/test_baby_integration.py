"""Disposable PostgreSQL acceptance for ownership, recovery and privacy fences."""

import asyncio
import importlib
import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import Base as SharedBase
from app.domains.baby import attachments, security
from app.domains.baby.models import (
    BabyAttachment,
    BabyImport,
    BabyRecord,
)
from app.domains.baby.provider import AnswerOutput, BabyProvider
from app.domains.baby.router import router
from app.domains.baby.runtime import BabyWorker, schema_complete
from app.models.deletion import DeletionCleanupJob
from app.models.identity import AppUser
from tests.database_safety import require_disposable_test_database

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.050_add_baby_domain")
GEN = {"X-Baby-Generation": "1"}


@pytest.fixture
async def baby_api(monkeypatch):
    require_disposable_test_database(DATABASE_URL)
    engine = create_async_engine(DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(SharedBase.metadata.create_all)
            await connection.execute(
                text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
            )
            await connection.execute(
                text("INSERT INTO schema_migrations VALUES (33,'test baseline')")
            )
        settings = SimpleNamespace(
            baby_api_enabled=True, environment="test", deletion_cleanup_max_attempts=20
        )
        await migration.run_migration(configured=settings, migration_engine=engine)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add_all([AppUser(id="owner"), AppUser(id="other")])
            await db.commit()
        app = FastAPI()
        app.include_router(router)

        async def database():
            async with sessions() as db:
                yield db

        async def identity(request: Request):
            return ClerkUser(
                id=request.headers.get("X-Test-Owner", "owner"),
                clerk_user_id="different-subject",
                clerk_issuer="https://example.test",
                clerk_environment="test",
            )

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = identity
        monkeypatch.setattr(security, "get_settings", lambda: settings)
        # Provider gates use fresh independent sessions, just like production.
        monkeypatch.setattr("app.db.database.AsyncSessionLocal", sessions)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.get("/api/v1/baby/bootstrap")).status_code == 409
            await client.post("/api/v1/baby/bootstrap")
            await client.post("/api/v1/baby/bootstrap", headers={"X-Test-Owner": "other"})
            yield SimpleNamespace(
                client=client, sessions=sessions, engine=engine, settings=settings
            )
    finally:
        try:
            async with engine.begin() as connection:
                await connection.execute(text("DROP SCHEMA public CASCADE"))
                await connection.execute(text("CREATE SCHEMA public"))
        finally:
            await engine.dispose()


def payload(kind="journal", **changes):
    return {
        "id": str(uuid4()),
        "kind": kind,
        "title": "Notes",
        "body": "Original text",
        "occurred_at": "2026-10-20T12:00:00+10:00",
        "data": {},
        **changes,
    }


async def test_ownership_idempotency_revision_child_clear_and_search(baby_api):
    c = baby_api.client
    child_id = str(uuid4())
    child = await c.post(
        "/api/v1/baby/children", headers=GEN, json={"id": child_id, "name": "Baby Shimizu"}
    )
    assert child.status_code == 200, child.text
    request = payload(
        "source",
        child_id=child_id,
        data={
            "source_text": "Hospital packing passports inside old saved video",
            "topics": ["Labor"],
        },
    )
    first, replay = await asyncio.gather(
        *(c.post("/api/v1/baby/records", headers=GEN, json=request) for _ in range(2))
    )
    assert first.status_code == replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    conflict = await c.post(
        "/api/v1/baby/records", headers=GEN, json={**request, "body": "Different"}
    )
    assert conflict.status_code == 409
    identifier = request["id"]
    assert (
        await c.get(f"/api/v1/baby/records/{identifier}", headers={"X-Test-Owner": "other"})
    ).status_code == 404
    assert (await c.get("/api/v1/baby/search", params={"q": "passports"})).json()["total"] == 1
    assert (await c.get("/api/v1/baby/search", params={"q": "%"})).json()["total"] == 0
    edits = await asyncio.gather(
        *(
            c.patch(
                f"/api/v1/baby/records/{identifier}",
                headers=GEN,
                json={"revision": 1, "body": text},
            )
            for text in ("Edited a", "Edited b")
        )
    )
    assert sorted(item.status_code for item in edits) == [200, 409]
    deleted = await c.delete(f"/api/v1/baby/children/{child_id}?revision=1", headers=GEN)
    assert deleted.status_code == 204
    saved = (await c.get(f"/api/v1/baby/records/{identifier}")).json()
    assert saved["child_id"] is None and saved["revision"] == 3
    assert (
        await c.post("/api/v1/baby/records", headers=GEN, json=payload(child_id=child_id))
    ).status_code == 404
    async with baby_api.engine.connect() as connection:
        assert await schema_complete(connection)
    await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)


async def test_generation_tombstone_export_and_stale_writes(baby_api):
    c = baby_api.client
    source = payload()
    await c.post("/api/v1/baby/records", headers=GEN, json=source)
    exported = await c.get("/api/v1/baby/export")
    assert exported.status_code == 200 and exported.json()["records"][0]["body"] == "Original text"
    assert (await c.patch("/api/v1/baby/profile", headers=GEN, json={"ai_consent": True})).json()[
        "ai_consent"
    ] is True
    erased = await c.delete("/api/v1/baby/data?generation=1", headers=GEN)
    assert erased.status_code == 200 and erased.json()["generation"] == 2
    assert (await c.delete("/api/v1/baby/data?generation=1", headers=GEN)).status_code == 200
    boot = (await c.get("/api/v1/baby/bootstrap")).json()
    assert (
        boot["active"] is False
        and boot["generation"] == 2
        and boot["profile"]["ai_consent"] is False
    )
    assert (await c.post("/api/v1/baby/records", headers=GEN, json=payload())).status_code == 409
    assert (
        await c.post("/api/v1/baby/enroll", headers={"X-Baby-Generation": "2"})
    ).status_code == 200
    assert (await c.post("/api/v1/baby/records", headers=GEN, json=payload())).status_code == 409
    assert (await c.get("/api/v1/baby/records")).json()["total"] == 0
    assert (await c.post("/api/v1/baby/records", json=payload())).status_code == 422


async def test_durable_import_restart_retry_cancel_and_user_edits_win(baby_api):
    c = baby_api.client
    body = {"id": str(uuid4()), "text": "Breastfeeding reference text", "topics": ["Feeding"]}
    created = await c.post("/api/v1/baby/imports", headers=GEN, json=body)
    assert created.status_code == 200, created.text
    assert (await c.post("/api/v1/baby/imports", headers=GEN, json=body)).json()[
        "record_id"
    ] == created.json()["record_id"]
    calls = []

    async def processor(request, assets, provider, **kwargs):
        calls.append(request["id"])
        await kwargs["gate"]()
        return {
            "title": "Processed",
            "data": {"source_text": "Searchable older evidence", "status": "ready"},
            "status": "ready",
        }

    worker = BabyWorker(baby_api.sessions, processor=processor)
    async with baby_api.sessions() as db:
        row = await db.get(BabyImport, body["id"])
        row.status, row.lease_until = "processing", datetime.now(UTC) - timedelta(minutes=1)
        await db.commit()
    assert await worker.tick()
    assert (await c.get(f"/api/v1/baby/imports/{body['id']}")).json()["status"] == "ready"
    assert calls == [body["id"]]
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyRecord)) == 1
    second = {"id": str(uuid4()), "url": "https://example.com/source"}
    created = (await c.post("/api/v1/baby/imports", headers=GEN, json=second)).json()
    await c.post(f"/api/v1/baby/imports/{second['id']}/cancel", headers=GEN)
    assert await worker.tick() is False
    assert (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()["data"][
        "url"
    ] == second["url"]
    await c.post(f"/api/v1/baby/imports/{second['id']}/retry", headers=GEN)

    async def edit_during_processing(request, assets, provider, **kwargs):
        record = (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()
        await c.patch(
            f"/api/v1/baby/records/{created['record_id']}",
            headers=GEN,
            json={"revision": record["revision"], "body": "My edit wins"},
        )
        return {"title": "AI title", "data": {"source_text": "AI contents"}, "status": "ready"}

    worker.processor = edit_during_processing
    await worker.tick()
    result = (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()
    assert result["body"] == "My edit wins" and result["title"] != "AI title"
    assert (await c.get(f"/api/v1/baby/imports/{second['id']}")).json()["status"] == "incomplete"


async def test_consent_revocation_fences_worker_completion(baby_api):
    c = baby_api.client
    await c.patch("/api/v1/baby/profile", headers=GEN, json={"ai_consent": True})
    body = {"id": str(uuid4()), "text": "Original saved text"}
    created = (await c.post("/api/v1/baby/imports", headers=GEN, json=body)).json()

    async def revoke(request, assets, provider, **kwargs):
        await c.patch("/api/v1/baby/profile", headers=GEN, json={"ai_consent": False})
        return {
            "title": "Should not save",
            "data": {"source_text": "Private result"},
            "status": "ready",
        }

    await BabyWorker(baby_api.sessions, processor=revoke).tick()
    result = (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()
    assert result["data"]["source_text"] == body["text"]
    assert result["data"]["status"] == "cancelled"
    assert (await c.get(f"/api/v1/baby/imports/{body['id']}")).json()["status"] == "cancelled"


async def test_private_attachment_cleanup_and_owner_access(baby_api, monkeypatch):
    from PIL import Image

    raw = BytesIO()
    Image.new("RGB", (30, 30), "white").save(raw, "PNG")
    objects = {}

    class S3:
        def put_object(self, **kwargs):
            objects[kwargs["Key"]] = kwargs["Body"]

        def get_object(self, **kwargs):
            return {"Body": BytesIO(objects[kwargs["Key"]])}

    monkeypatch.setattr(
        attachments,
        "storage_service",
        SimpleNamespace(is_enabled=True, bucket_name="test", client=S3()),
    )
    c = baby_api.client
    identifier = str(uuid4())
    uploaded = await c.post(
        "/api/v1/baby/attachments",
        headers={**GEN, "Idempotency-Key": identifier},
        files={"file": ("photo.png", raw.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["mime_type"] == "image/webp"
    assert not any(key in uploaded.json() for key in ("url", "object_key", "payload"))
    replay = await c.post(
        "/api/v1/baby/attachments",
        headers={**GEN, "Idempotency-Key": identifier},
        files={"file": ("photo.png", raw.getvalue(), "image/png")},
    )
    assert replay.json()["id"] == identifier
    meta = await c.get(f"/api/v1/baby/attachments/{identifier}/metadata")
    assert meta.json() == uploaded.json()
    assert meta.headers["cache-control"] == "private, no-store"
    assert (
        await c.get(
            f"/api/v1/baby/attachments/{identifier}/metadata", headers={"X-Test-Owner": "other"}
        )
    ).status_code == 404
    assert (
        await c.get(f"/api/v1/baby/attachments/{identifier}", headers={"X-Test-Owner": "other"})
    ).status_code == 404
    read = await c.get(f"/api/v1/baby/attachments/{identifier}")
    assert read.status_code == 200 and read.headers["cache-control"] == "private, no-store"
    entry = (
        await c.post(
            "/api/v1/baby/records", headers=GEN, json=payload(data={"attachment_ids": [identifier]})
        )
    ).json()
    assert (
        await c.delete(f"/api/v1/baby/attachments/{identifier}", headers=GEN)
    ).status_code == 204
    assert (await c.get(f"/api/v1/baby/attachments/{identifier}")).status_code == 404
    assert (await c.get(f"/api/v1/baby/attachments/{identifier}/metadata")).status_code == 404
    saved = (await c.get(f"/api/v1/baby/records/{entry['id']}")).json()
    assert saved["data"]["attachment_ids"] == []
    async with baby_api.sessions() as db:
        cleanup = list(
            await db.scalars(
                select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued")
            )
        )
        assert len(cleanup) == 1 and cleanup[0].storage_prefixes[0].startswith("baby-private/")


async def test_grounded_chat_history_idempotency_proposal_and_consent(baby_api, monkeypatch):
    c = baby_api.client
    source = (
        await c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload("source", data={"source_text": "Hospital packing passports for labor"}),
        )
    ).json()
    calls = []

    async def answer(self, **kwargs):
        calls.append(kwargs)
        await self.gate()
        return AnswerOutput(
            message="Your saved reference mentions passports.",
            citation_ids=[source["id"]],
            proposal={
                "kind": "question",
                "title": "Ask my doctor",
                "body": "What should I bring?",
                "data": {},
            },
        )

    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(BabyProvider, "answer", answer)
    body = {
        "request_id": str(uuid4()),
        "message": "What hospital packing advice did I save?",
        "scope": "library",
    }
    assert (await c.post("/api/v1/baby/chat", headers=GEN, json=body)).status_code == 403
    await c.patch("/api/v1/baby/profile", headers=GEN, json={"ai_consent": True})
    response = await c.post("/api/v1/baby/chat", headers=GEN, json=body)
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["citations"] == [
        {
            "id": source["id"],
            "title": "Notes",
            "excerpt": "Original text\n\nHospital packing passports for labor",
            "kind": "source",
        }
    ]
    assert value["proposal"]["kind"] == "question"
    replay = await c.post("/api/v1/baby/chat", headers=GEN, json=body)
    assert replay.status_code == 200 and len(calls) == 1
    assert (await c.get("/api/v1/baby/records")).json()["total"] == 1  # Proposal is not saved.
    history = (await c.get(f"/api/v1/baby/conversations/{value['conversation_id']}")).json()
    assert [item["role"] for item in history["messages"]] == ["user", "assistant"]
    assert (
        await c.get(
            f"/api/v1/baby/conversations/{value['conversation_id']}",
            headers={"X-Test-Owner": "other"},
        )
    ).status_code == 404


async def test_deleted_record_and_child_ids_cannot_resurrect_by_offline_replay(baby_api):
    c = baby_api.client
    request = payload()
    created = (await c.post("/api/v1/baby/records", headers=GEN, json=request)).json()
    assert (
        await c.delete(f"/api/v1/baby/records/{created['id']}?revision=1", headers=GEN)
    ).status_code == 204
    assert (await c.post("/api/v1/baby/records", headers=GEN, json=request)).status_code == 410
    assert (await c.get("/api/v1/baby/records")).json()["total"] == 0
    child = {"id": str(uuid4()), "name": "Child"}
    await c.post("/api/v1/baby/children", headers=GEN, json=child)
    await c.delete(f"/api/v1/baby/children/{child['id']}?revision=1", headers=GEN)
    assert (await c.post("/api/v1/baby/children", headers=GEN, json=child)).status_code == 410
    assert (await c.get("/api/v1/baby/children")).json()["items"] == []


async def test_process_existing_source_preserves_one_record(baby_api):
    c = baby_api.client
    created = (
        await c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload(
                "source", body="My own note", data={"source_text": "Existing source text"}
            ),
        )
    ).json()
    response = await c.post(
        "/api/v1/baby/imports",
        headers=GEN,
        json={"id": str(uuid4()), "record_id": created["id"], "text": "Existing source text"},
    )
    assert response.status_code == 200 and response.json()["record_id"] == created["id"]

    async def processor(*args, **kwargs):
        return {
            "title": "Organized",
            "data": {
                "source_text": "Existing source text",
                "summary": "Source summary",
                "status": "ready",
            },
            "status": "ready",
        }

    await BabyWorker(baby_api.sessions, processor=processor).tick()
    records = (await c.get("/api/v1/baby/records")).json()
    assert records["total"] == 1
    assert records["items"][0]["body"] == "My own note"


async def test_local_private_storage_and_durable_budget_fence(baby_api, monkeypatch, tmp_path):
    from app.ai_governance import ai_request_context
    from app.domains.baby import budget, storage
    from app.domains.baby.models import BabyAIAdmission
    from app.domains.workouts.budget import BudgetError

    c = baby_api.client
    configured = SimpleNamespace(environment="test", baby_local_storage_dir=str(tmp_path))
    monkeypatch.setattr(storage, "get_settings", lambda: configured)
    key = attachments.attachment_prefix(uuid4(), "owner", 1) + "asset"
    storage.put(key, b"private", "text/plain")
    assert storage.read(key, 7) == b"private"
    assert (tmp_path / key).stat().st_mode & 0o777 == 0o600
    await storage.delete_private_prefix(key.removesuffix("asset"))
    assert not (tmp_path / key).exists()
    configured.environment = "production"
    with pytest.raises(RuntimeError):
        storage.local_root()
    await c.patch("/api/v1/baby/profile", headers=GEN, json={"ai_consent": True})
    async with baby_api.sessions() as db:
        db.add(
            BabyAIAdmission(
                app_user_id="owner",
                generation=1,
                capability="baby_chat",
                reserved_microusd=budget.OWNER_DAILY_CAP,
                created_at=datetime.now(UTC),
            )
        )
        await db.commit()
    with ai_request_context(user_id="owner", job_id=None):
        with pytest.raises(BudgetError) as blocked:
            await budget.reserve("baby_chat", "gpt-5.6-luna", sessions=baby_api.sessions)
        assert blocked.value.code == "workouts_ai_budget_exceeded"
    await c.delete("/api/v1/baby/data?generation=1", headers=GEN)
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission)) == 1


async def test_account_erasure_anonymizes_cost_without_releasing_global_budget(
    baby_api, monkeypatch
):
    from app.ai_governance import ai_request_context
    from app.domains.baby import budget
    from app.domains.baby.models import BabyAIAdmission
    from app.domains.workouts.budget import BudgetError

    await baby_api.client.patch(
        "/api/v1/baby/profile", headers={**GEN, "X-Test-Owner": "other"}, json={"ai_consent": True}
    )
    async with baby_api.sessions() as db:
        db.add(
            BabyAIAdmission(
                app_user_id="owner",
                generation=1,
                capability="baby_chat",
                reserved_microusd=budget.GLOBAL_DAILY_CAP,
                created_at=datetime.now(UTC),
            )
        )
        await db.commit()
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
        admission = await db.scalar(select(BabyAIAdmission))
        assert admission.app_user_id is None
        assert admission.reserved_microusd == budget.GLOBAL_DAILY_CAP
    with ai_request_context(user_id="other", job_id=None):
        with pytest.raises(BudgetError) as blocked:
            await budget.reserve("baby_chat", "gpt-5.6-luna", sessions=baby_api.sessions)
        assert blocked.value.code == "workouts_ai_budget_exceeded"


@pytest.mark.parametrize("reason,expected", [("exhausted", "failed"), ("consent", "cancelled")])
async def test_terminal_queue_recovery_updates_saved_source(baby_api, reason, expected):
    c = baby_api.client
    job = (
        await c.post(
            "/api/v1/baby/imports",
            headers=GEN,
            json={"id": str(uuid4()), "text": "Original preserved"},
        )
    ).json()
    async with baby_api.sessions() as db:
        row = await db.get(BabyImport, UUID(job["id"]))
        if reason == "exhausted":
            row.attempts = 5
        else:
            row.consent_epoch += 1
        await db.commit()
    await BabyWorker(baby_api.sessions).tick()
    source = (await c.get("/api/v1/baby/records/" + job["record_id"])).json()
    assert source["data"]["status"] == expected
    assert source["revision"] == 2
    assert (await c.get("/api/v1/baby/imports/" + job["id"])).json()["status"] == expected


async def media_fixture(
    baby_api, *, state="ready", size=1024, age=timedelta(), cleanup_status="completed", attempts=1
):
    identifier = uuid4()
    created = datetime.now(UTC) - age
    intent = attachments.cleanup_job(
        "owner", [attachments.attachment_prefix(identifier, "owner", 1)]
    )
    intent.id = uuid4()
    intent.status = cleanup_status
    intent.attempt_count = attempts
    intent.completed_at = datetime.now(UTC) if cleanup_status in {"completed", "failed"} else None
    intent.storage_prefixes = [] if cleanup_status == "completed" else intent.storage_prefixes
    intent.last_error = "Unavailable" if cleanup_status == "failed" else None
    intent.created_at = created
    intent.updated_at = created
    row = BabyAttachment(
        id=identifier,
        app_user_id="owner",
        generation=1,
        name="Private image",
        mime_type="image/webp",
        size=size,
        object_key=attachments.attachment_prefix(identifier, "owner", 1) + "asset",
        byte_hash="a" * 64,
        state=state,
        created_at=created,
        cleanup_job_id=intent.id,
    )
    async with baby_api.sessions() as db:
        db.add(intent)
        await db.flush()
        db.add(row)
        await db.commit()
    return identifier


async def attachment_states(baby_api, *identifiers):
    async with baby_api.sessions() as db:
        return {
            row.id: row.state
            for row in await db.scalars(
                select(BabyAttachment).where(BabyAttachment.id.in_(identifiers))
            )
        }


async def test_media_retirement_preserves_shared_records_and_active_imports(baby_api):
    c = baby_api.client
    shared = await media_fixture(baby_api)
    unique = await media_fixture(baby_api)
    processing = await media_fixture(baby_api)
    first = (
        await c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload(data={"attachment_ids": list(map(str, [shared, unique, processing]))}),
        )
    ).json()
    second = (
        await c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload(data={"attachment_ids": [str(shared)]}),
        )
    ).json()
    capture = (
        await c.post(
            "/api/v1/baby/imports",
            headers=GEN,
            json={"id": str(uuid4()), "attachment_ids": [str(processing)]},
        )
    ).json()
    # Simulate removing the file from the source while its capture is active.
    source = (await c.get(f"/api/v1/baby/records/{capture['record_id']}")).json()
    assert (
        await c.patch(
            f"/api/v1/baby/records/{source['id']}",
            headers=GEN,
            json={"revision": source["revision"], "data": {"attachment_ids": []}},
        )
    ).status_code == 200
    assert (
        await c.patch(
            f"/api/v1/baby/records/{first['id']}",
            headers=GEN,
            json={"revision": 1, "data": {"attachment_ids": []}},
        )
    ).status_code == 200
    assert await attachment_states(baby_api, shared, unique, processing) == {
        shared: "ready",
        unique: "deleted",
        processing: "ready",
    }
    assert (
        await c.delete(f"/api/v1/baby/records/{second['id']}?revision=1", headers=GEN)
    ).status_code == 204
    assert (await attachment_states(baby_api, shared))[shared] == "deleted"
    assert (
        await c.post(f"/api/v1/baby/attachments/{processing}/release", headers=GEN)
    ).status_code == 204
    assert (await attachment_states(baby_api, processing))[processing] == "ready"
    await c.post(f"/api/v1/baby/imports/{capture['id']}/cancel", headers=GEN)
    assert (
        await c.post(f"/api/v1/baby/attachments/{processing}/release", headers=GEN)
    ).status_code == 204
    assert (
        await c.post(f"/api/v1/baby/attachments/{processing}/release", headers=GEN)
    ).status_code == 204
    assert (await attachment_states(baby_api, processing))[processing] == "deleted"
    async with baby_api.sessions() as db:
        queued = list(
            await db.scalars(
                select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued")
            )
        )
        assert len(queued) == 3  # Exactly one durable cleanup per retired file.


async def test_release_is_private_generation_fenced_and_never_unlinks(baby_api):
    c = baby_api.client
    identifier = await media_fixture(baby_api)
    record = (
        await c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload(data={"attachment_ids": [str(identifier)]}),
        )
    ).json()
    assert (
        await c.post(
            f"/api/v1/baby/attachments/{identifier}/release",
            headers={**GEN, "X-Test-Owner": "other"},
        )
    ).status_code == 204
    assert (
        await c.post(f"/api/v1/baby/attachments/{identifier}/release", headers=GEN)
    ).status_code == 204
    assert (await attachment_states(baby_api, identifier))[identifier] == "ready"
    saved = (await c.get(f"/api/v1/baby/records/{record['id']}")).json()
    assert saved["revision"] == 1 and saved["data"]["attachment_ids"] == [str(identifier)]
    assert (
        await c.post(
            f"/api/v1/baby/attachments/{identifier}/release", headers={"X-Baby-Generation": "2"}
        )
    ).status_code == 409
    assert (
        await c.post(f"/api/v1/baby/attachments/{uuid4()}/release", headers=GEN)
    ).status_code == 204


async def quota_upload(baby_api, monkeypatch, identifier=None):
    from PIL import Image

    raw = BytesIO()
    Image.new("RGB", (10, 10), "white").save(raw, "PNG")

    class S3:
        def put_object(self, **kwargs):
            pass

    monkeypatch.setattr(
        attachments,
        "storage_service",
        SimpleNamespace(is_enabled=True, bucket_name="test", client=S3()),
    )
    return await baby_api.client.post(
        "/api/v1/baby/attachments",
        headers={**GEN, "Idempotency-Key": str(identifier or uuid4())},
        files={"file": ("image.png", raw.getvalue(), "image/png")},
    )


@pytest.mark.parametrize(
    "status,age,attempts,reclaimed",
    [
        ("completed", timedelta(hours=2), 1, True),
        ("completed", timedelta(minutes=30), 1, False),
        ("completed", timedelta(hours=2), 0, False),
        ("failed", timedelta(hours=2), 1, False),
        ("processing", timedelta(hours=2), 1, False),
        ("queued", timedelta(hours=2), 1, False),
    ],
)
async def test_pending_quota_reconciles_only_expired_verified_completed_cleanup(
    baby_api,
    monkeypatch,
    status,
    age,
    attempts,
    reclaimed,
):
    monkeypatch.setattr(attachments, "MAX_TOTAL_BYTES", 1024)
    identifier = await media_fixture(
        baby_api,
        state="pending",
        size=attachments.MAX_TOTAL_BYTES,
        age=age,
        cleanup_status=status,
        attempts=attempts,
    )
    uploaded = await quota_upload(baby_api, monkeypatch)
    assert uploaded.status_code == (200 if reclaimed else 429), uploaded.text
    assert (await attachment_states(baby_api, identifier))[identifier] == (
        "deleted" if reclaimed else "pending"
    )


@pytest.mark.parametrize("reference", ["none", "record", "import", "terminal"])
async def test_quota_reclaims_abandoned_ready_uploads_but_preserves_live_references(
    baby_api,
    monkeypatch,
    reference,
):
    monkeypatch.setattr(attachments, "MAX_TOTAL_BYTES", 1024)
    c = baby_api.client
    identifier = await media_fixture(
        baby_api,
        size=attachments.MAX_TOTAL_BYTES,
        age=timedelta(days=8) if reference != "terminal" else timedelta(hours=1),
    )
    if reference == "record":
        assert (
            await c.post(
                "/api/v1/baby/records",
                headers=GEN,
                json=payload(data={"attachment_ids": [str(identifier)]}),
            )
        ).status_code == 200
    if reference in {"import", "terminal"}:
        capture = (
            await c.post(
                "/api/v1/baby/imports",
                headers=GEN,
                json={"id": str(uuid4()), "attachment_ids": [str(identifier)]},
            )
        ).json()
        # Remove the source reference while its import still protects the file.
        assert (
            await c.patch(
                f"/api/v1/baby/records/{capture['record_id']}",
                headers=GEN,
                json={"revision": 1, "data": {"attachment_ids": []}},
            )
        ).status_code == 200
        if reference == "terminal":
            await c.post(f"/api/v1/baby/imports/{capture['id']}/cancel", headers=GEN)
    uploaded = await quota_upload(baby_api, monkeypatch)
    released = reference in {"none", "terminal"}
    assert uploaded.status_code == (200 if released else 429), uploaded.text
    assert (await attachment_states(baby_api, identifier))[identifier] == (
        "deleted" if released else "ready"
    )


async def test_quota_reconciliation_commits_each_bounded_batch_even_if_still_full(
    baby_api, monkeypatch
):
    monkeypatch.setattr(attachments, "MAX_TOTAL_BYTES", 1024)
    identifiers = []
    for index in range(101):
        identifiers.append(
            await media_fixture(
                baby_api,
                state="pending",
                size=1 if index < 100 else attachments.MAX_TOTAL_BYTES,
                age=timedelta(days=3) - timedelta(seconds=index),
            )
        )
    first = await quota_upload(baby_api, monkeypatch)
    assert first.status_code == 429
    states = await attachment_states(baby_api, *identifiers)
    assert list(states.values()).count("deleted") == 100
    second = await quota_upload(baby_api, monkeypatch)
    assert second.status_code == 200, second.text
    assert (await attachment_states(baby_api, identifiers[-1]))[identifiers[-1]] == "deleted"


async def test_current_upload_replay_retains_even_an_old_unreferenced_asset(baby_api, monkeypatch):
    first = await quota_upload(baby_api, monkeypatch)
    assert first.status_code == 200
    identifier = UUID(first.json()["id"])
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, identifier)
        row.created_at = datetime.now(UTC) - timedelta(days=8)
        receipt = await db.get(DeletionCleanupJob, row.cleanup_job_id)
        receipt.updated_at = row.created_at
        await db.commit()
    replay = await quota_upload(baby_api, monkeypatch, identifier)
    assert replay.status_code == 200 and replay.json()["id"] == str(identifier)
    assert (await attachment_states(baby_api, identifier))[identifier] == "ready"
    another = await quota_upload(baby_api, monkeypatch)
    assert another.status_code == 200
    assert (await attachment_states(baby_api, identifier))[identifier] == "ready"


async def test_release_and_record_save_serialize_without_dangling_media(baby_api):
    c = baby_api.client
    identifier = await media_fixture(baby_api)
    save, released = await asyncio.gather(
        c.post(
            "/api/v1/baby/records",
            headers=GEN,
            json=payload(data={"attachment_ids": [str(identifier)]}),
        ),
        c.post(f"/api/v1/baby/attachments/{identifier}/release", headers=GEN),
    )
    assert released.status_code == 204
    state = (await attachment_states(baby_api, identifier))[identifier]
    assert (save.status_code, state) in {(200, "ready"), (409, "deleted")}


async def test_capture_url_with_whitespace_text_saves_bookmark(baby_api):
    response = await baby_api.client.post(
        "/api/v1/baby/imports", headers=GEN,
        json={"id": str(uuid4()), "url": "https://example.com", "text": "  \n  "},
    )
    assert response.status_code == 200, response.text
    saved = await baby_api.client.get(f"/api/v1/baby/records/{response.json()['record_id']}")
    assert saved.json()["title"] == "Saved source"
    assert saved.json()["data"]["url"] == "https://example.com"


async def test_migration_advisory_lock_wait_is_bounded_and_recoverable(baby_api):
    from sqlalchemy.exc import DBAPIError

    async with baby_api.engine.begin() as holder:
        await holder.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
        with pytest.raises(DBAPIError, match="lock timeout"):
            await asyncio.wait_for(migration.run_migration(
                configured=baby_api.settings, migration_engine=baby_api.engine,
            ), timeout=8)
    await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)

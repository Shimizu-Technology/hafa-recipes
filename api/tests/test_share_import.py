"""Scoped share capability and durable enqueue contract."""

import asyncio
import importlib
import os
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import Base
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob
from app.models.share_import import ShareImportCredential, ShareImportReceipt
from app.routers.share_import import router
from app.share_credentials import SCOPE, issue_token, parse_token, validate_credential
from app.widget_credentials import utc_now


def test_capability_validation():
    identifier = uuid4()
    token, digest = issue_token(identifier)
    assert parse_token(token) == (identifier, digest)
    for bad in ("clerk.jwt.token", token.replace("hfs_v1", "hfw_v1"), "x" * 257, token + ".extra"):
        assert parse_token(bad) is None
    credential = ShareImportCredential(
        token_hash=digest, scope=SCOPE, expires_at=utc_now() + timedelta(days=1)
    )
    validate_credential(credential, digest)
    for field, value in [
        ("scope", "recipe:edit"),
        ("expires_at", utc_now() - timedelta(seconds=1)),
        ("revoked_at", utc_now()),
    ]:
        old = getattr(credential, field)
        setattr(credential, field, value)
        with pytest.raises(HTTPException):
            validate_credential(credential, digest)
        setattr(credential, field, old)


@pytest.fixture
async def sharing_db(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL required")
    assert "test" in url.rsplit("/", 1)[-1]
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
        )
        await conn.execute(text("INSERT INTO schema_migrations VALUES(31, 'test prior')"))
    migration = importlib.import_module("migrations.032_add_share_import_credentials")
    monkeypatch.setattr(migration, "engine", engine)
    await migration.run_migration()
    await migration.run_migration()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        db.add_all([AppUser(id="stable_owner"), AppUser(id="other_owner")])
        await db.commit()

    async def normalize(url):
        return url

    monkeypatch.setattr("app.services.video.VideoService.normalize_url", normalize)
    try:
        yield factory
    finally:
        await engine.dispose()


def app_for(factory):
    app = FastAPI()
    app.include_router(router)

    async def db_override():
        async with factory() as db:
            yield db

    async def user_override():
        return ClerkUser(
            id="stable_owner",
            clerk_user_id="clerk_subject",
            clerk_issuer="test",
            clerk_environment="test",
            first_name="Owner",
        )

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_current_user] = user_override
    return app


@pytest.mark.asyncio
async def test_enqueue_replay_rotate_revoke_and_delete(sharing_db):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(sharing_db)), base_url="https://test"
    ) as client:
        installation = str(uuid4())
        response = await client.post(
            "/api/share/credentials", json={"installation_id": installation}
        )
        assert response.status_code == 201, response.text
        first = response.json()
        assert first["is_public"] is False
        headers = {"Authorization": "Bearer " + first["token"]}
        capture = {"capture_id": str(uuid4()), "url": "https://example.com/recipe"}
        accepted = await client.post("/api/share/imports", json=capture, headers=headers)
        assert accepted.status_code == 202, accepted.text
        assert accepted.json()["job_id"]
        replay = await client.post("/api/share/imports", json=capture, headers=headers)
        assert replay.status_code == 202 and replay.json()["replayed"]
        assert (
            await client.post(
                "/api/share/imports",
                json={**capture, "url": "https://example.com/other"},
                headers=headers,
            )
        ).status_code == 409
        assert (
            await client.post(
                "/api/share/imports", json={**capture, "url": "file:///etc/passwd"}, headers=headers
            )
        ).status_code == 422
        assert (
            await client.post(
                "/api/share/credentials", json={"installation_id": installation, "is_public": True}
            )
        ).status_code == 409
        rotated = await client.post(
            "/api/share/credentials", json={"installation_id": installation}
        )
        assert rotated.status_code == 201
        assert (
            await client.post("/api/share/imports", json=capture, headers=headers)
        ).status_code == 401
        new_headers = {"Authorization": "Bearer " + rotated.json()["token"]}
        assert (await client.delete("/api/share/session", headers=new_headers)).status_code == 204
        assert (
            await client.post("/api/share/imports", json=capture, headers=new_headers)
        ).status_code == 401
        async with sharing_db() as db:
            job = await db.scalar(select(ExtractionJob))
            assert job.user_id == "stable_owner" and job.requested_is_public is False
            assert await db.scalar(select(func.count()).select_from(ShareImportReceipt)) == 1
            await db.execute(delete(ExtractionJob))
            await db.execute(delete(AppUser).where(AppUser.id == "stable_owner"))
            await db.commit()
            assert await db.scalar(select(func.count()).select_from(ShareImportCredential)) == 0
            assert await db.scalar(select(func.count()).select_from(ShareImportReceipt)) == 0


@pytest.mark.asyncio
async def test_caller_cannot_change_scope_and_limit(sharing_db):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(sharing_db)), base_url="https://test"
    ) as client:
        issue = await client.post("/api/share/credentials", json={"installation_id": str(uuid4())})
        headers = {"Authorization": "Bearer " + issue.json()["token"]}
        payload = {
            "capture_id": str(uuid4()),
            "url": "https://example.com/recipe",
            "user_id": "other_owner",
        }
        assert (
            await client.post("/api/share/imports", json=payload, headers=headers)
        ).status_code == 422
        async with sharing_db() as db:
            db.add_all(
                [
                    ShareImportReceipt(
                        app_user_id="stable_owner", capture_id=uuid4(), url="https://example.com"
                    )
                    for _ in range(30)
                ]
            )
            await db.commit()
        payload.pop("user_id")
        assert (
            await client.post("/api/share/imports", json=payload, headers=headers)
        ).status_code == 429


def test_production_migration_requires_verified_restore_point(monkeypatch):
    from types import SimpleNamespace

    migration = importlib.import_module("migrations.032_add_share_import_credentials")
    monkeypatch.setattr(
        migration,
        "settings",
        SimpleNamespace(environment="production", migration_032_restore_point=None),
    )
    with pytest.raises(RuntimeError, match="MIGRATION_032_RESTORE_POINT"):
        migration._require_restore_point(applied=False)
    migration._require_restore_point(applied=True)


@pytest.mark.asyncio
async def test_committed_jobs_without_receipts_consume_budget_and_can_replay(sharing_db):
    """Simulate termination after durable enqueue but before receipt commit."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(sharing_db)), base_url="https://test"
    ) as client:
        issue = await client.post("/api/share/credentials", json={"installation_id": str(uuid4())})
        headers = {"Authorization": "Bearer " + issue.json()["token"]}
        captures = [uuid4() for _ in range(30)]
        async with sharing_db() as db:
            db.add_all([
                ExtractionJob(user_id="stable_owner", url=f"https://example.com/{capture}",
                              idempotency_key=f"share:{capture}", requested_display_name="Owner")
                for capture in captures
            ])
            await db.commit()
        fresh = await client.post("/api/share/imports", headers=headers,
                                  json={"capture_id": str(uuid4()), "url": "https://example.com/new"})
        assert fresh.status_code == 429
        replay = await client.post("/api/share/imports", headers=headers,
                                   json={"capture_id": str(captures[0]), "url": f"https://example.com/{captures[0]}"})
        assert replay.status_code == 202, replay.text
        async with sharing_db() as db:
            assert await db.scalar(select(func.count()).select_from(ExtractionJob)) == 30
            assert await db.scalar(select(func.count()).select_from(ShareImportReceipt)) == 1
        # Its receipt and job are one accepted capture, not two budget entries.
        async with sharing_db() as db:
            await db.execute(delete(ExtractionJob).where(ExtractionJob.idempotency_key == f"share:{captures[-1]}"))
            await db.commit()
        fresh = await client.post("/api/share/imports", headers=headers,
                                  json={"capture_id": str(uuid4()), "url": "https://example.com/new"})
        assert fresh.status_code == 202, fresh.text


@pytest.mark.asyncio
async def test_concurrent_submissions_during_receipt_gap_cannot_exceed_limit(sharing_db, monkeypatch):
    from app.routers import share_import
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(sharing_db)), base_url="https://test"
    ) as client:
        issue = await client.post("/api/share/credentials", json={"installation_id": str(uuid4())})
        headers = {"Authorization": "Bearer " + issue.json()["token"]}
        async with sharing_db() as db:
            db.add_all([ShareImportReceipt(app_user_id="stable_owner", capture_id=uuid4(),
                                          url="https://example.com/prior") for _ in range(29)])
            await db.commit()
        enqueued = asyncio.Event()
        release_receipt = asyncio.Event()
        original = share_import.start_extraction_job
        async def delayed_enqueue(*args, **kwargs):
            result = await original(*args, **kwargs)
            enqueued.set()
            await release_receipt.wait()
            return result
        monkeypatch.setattr(share_import, "start_extraction_job", delayed_enqueue)
        first = asyncio.create_task(client.post("/api/share/imports", headers=headers,
                                                json={"capture_id": str(uuid4()), "url": "https://example.com/first"}))
        try:
            await asyncio.wait_for(enqueued.wait(), 5)
            second = await asyncio.wait_for(client.post("/api/share/imports", headers=headers,
                                                       json={"capture_id": str(uuid4()), "url": "https://example.com/second"}), 5)
            assert second.status_code == 429
        finally:
            release_receipt.set()
            result = await first
        assert result.status_code == 202, result.text
        async with sharing_db() as db:
            assert await db.scalar(select(func.count()).select_from(ShareImportReceipt)) == 30

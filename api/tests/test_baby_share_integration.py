"""Disposable PostgreSQL acceptance of restricted original capture and admission."""

import asyncio
import importlib
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from sqlalchemy import func, select, text

from app.auth import ClerkUser, get_current_user
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyImport, BabyRecord
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from app.domains.baby.share_router import (
    CaptureRequest,
    drain_deferred_captures,
    parse_token,
    router,
)
from tests import test_baby_integration as shared

pytestmark = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)


@pytest.fixture
async def baby_api(shared_baby_api):
    fixture = shared_baby_api
    app = fixture.client._transport.app
    app.include_router(router)

    async def identity(request: Request):
        # A restricted capability must not authenticate ordinary application APIs.
        if request.headers.get("authorization", "").startswith("Bearer hfbs_"):
            raise HTTPException(401, "Not a Clerk credential")
        return ClerkUser(
            id=request.headers.get("X-Test-Owner", "owner"),
            clerk_user_id="issuer-subject-not-owner",
            clerk_issuer="https://example.test",
            clerk_environment="test",
        )

    app.dependency_overrides[get_current_user] = identity
    migration = importlib.import_module("migrations.051_add_baby_share")
    await migration.run_migration(configured=fixture.settings, migration_engine=fixture.engine)
    yield fixture


shared_baby_api = shared.baby_api


async def session(c, **headers):
    response = await c.post(
        "/api/v1/baby/share/session",
        headers={**shared.GEN, **headers},
        json={"installation_id": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": "Bearer " + response.json()["token"]}


def capture(**changes):
    return {
        "capture_id": str(uuid4()),
        "occurred_at": "2026-10-21T07:50:00.123Z",
        "url": "http://example.com/source",
        "text": "Caption\nWith instructions preserved",
        **changes,
    }


async def test_capability_only_saves_original_replays_and_cannot_read_or_borrow(baby_api):
    c = baby_api.client
    capability = await session(c)
    body = capture()
    a, b = await asyncio.gather(
        *(c.post("/api/v1/baby/share/captures", headers=capability, json=body) for _ in range(2))
    )
    assert a.status_code == b.status_code == 202, (a.text, b.text)
    assert a.json()["record_id"] == b.json()["record_id"] == body["capture_id"]
    assert a.json()["status"] == "saved" and a.json()["import_id"] is None
    source = await c.get("/api/v1/baby/records/" + body["capture_id"])
    assert source.json()["data"]["source_text"] == body["text"]
    assert source.json()["data"]["url"] == body["url"]
    # Canonical host outbox save after a lost direct response replays exactly.
    host = CaptureRequest(**body).original_record().model_dump(mode="json")
    replay = await c.post("/api/v1/baby/records", headers=shared.GEN, json=host)
    assert replay.status_code == 200 and replay.json()["id"] == body["capture_id"]
    assert (
        await c.post(
            "/api/v1/baby/share/captures", headers=capability, json={**body, "text": "changed"}
        )
    ).status_code == 409
    assert (await c.get("/api/v1/baby/records", headers=capability)).status_code == 401
    assert (
        await c.patch(
            "/api/v1/baby/profile", headers={**capability, **shared.GEN}, json={"ai_consent": True}
        )
    ).status_code == 401
    other = await session(c, **{"X-Test-Owner": "other"})
    assert (
        await c.post("/api/v1/baby/share/captures", headers=other, json=body)
    ).status_code == 409
    for token in [
        "Bearer hfws_v1." + str(uuid4()) + "." + "a" * 43,
        "Bearer clerk-jwt",
        "Bearer hfbs_v1.bad.token",
    ]:
        assert (
            await c.post(
                "/api/v1/baby/share/captures", headers={"Authorization": token}, json=capture()
            )
        ).status_code == 401
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyRecord)) == 1
        assert await db.scalar(select(func.count()).select_from(BabyImport)) == 0


async def test_both_permissions_required_and_older_profile_patch_preserves_opt_in(baby_api):
    c = baby_api.client
    capability = await session(c)
    for flags in [{"ai_consent": True}, {"ai_consent": False, "auto_process_shares": True}]:
        assert (
            await c.patch("/api/v1/baby/profile", headers=shared.GEN, json=flags)
        ).status_code == 200
        result = await c.post("/api/v1/baby/share/captures", headers=capability, json=capture())
        assert result.json()["status"] == "saved"
    await c.patch(
        "/api/v1/baby/profile",
        headers=shared.GEN,
        json={"ai_consent": True, "auto_process_shares": True},
    )
    older = await c.patch(
        "/api/v1/baby/profile", headers=shared.GEN, json={"display_name": "Older client"}
    )
    assert older.json()["auto_process_shares"] is True
    body = capture()
    result = await c.post("/api/v1/baby/share/captures", headers=capability, json=body)
    assert result.status_code == 202 and result.json()["status"] == "queued", result.text
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, body["capture_id"])
        assert job.request["automatic"] is True
        assert job.request["text"] == body["text"] and job.request["url"] == body["url"]


async def test_original_survives_active_and_daily_limits_then_deferred_admission(baby_api):
    c = baby_api.client
    capability = await session(c)
    await c.patch(
        "/api/v1/baby/profile",
        headers=shared.GEN,
        json={"ai_consent": True, "auto_process_shares": True},
    )
    for _ in range(5):
        assert (
            await c.post("/api/v1/baby/share/captures", headers=capability, json=capture())
        ).json()["status"] == "queued"
    body = capture()
    deferred = await c.post("/api/v1/baby/share/captures", headers=capability, json=body)
    assert deferred.status_code == 202 and deferred.json()["status"] == "deferred", deferred.text
    assert (await c.get("/api/v1/baby/records/" + body["capture_id"])).json()["data"][
        "status"
    ] == "saved"
    async with baby_api.sessions() as db:
        jobs = list(await db.scalars(select(BabyImport)))
        for job in jobs:
            job.status = "ready"
        await db.commit()
        assert await drain_deferred_captures(db) == 1
        assert (await db.get(BabyImport, body["capture_id"])).request["automatic"] is True
        for _ in range(24):
            db.add(
                BabyImport(
                    id=uuid4(),
                    app_user_id="owner",
                    generation=1,
                    consent_epoch=0,
                    creation_hash="a" * 64,
                    request={},
                    status="ready",
                    record_id=uuid4(),
                    attempts=0,
                    created_at=now(),
                    updated_at=now(),
                )
            )
        await db.commit()
    daily_body = capture()
    daily = await c.post("/api/v1/baby/share/captures", headers=capability, json=daily_body)
    assert daily.json()["status"] == "deferred", daily.text
    await c.patch("/api/v1/baby/profile", headers=shared.GEN, json={"auto_process_shares": False})
    async with baby_api.sessions() as db:
        assert await drain_deferred_captures(db) == 0
        receipt = await db.get(BabyShareCapture, daily_body["capture_id"])
        assert receipt.status == "saved" and await db.get(BabyImport, receipt.id) is None
        assert await db.get(BabyRecord, receipt.record_id) is not None


async def test_expiry_exact_revocation_generation_and_missing_additive_schema(baby_api):
    c = baby_api.client
    capability = await session(c)
    parsed = parse_token(capability["Authorization"].removeprefix("Bearer "))
    async with baby_api.sessions() as db:
        row = await db.get(BabyShareCredential, parsed[0])
        row.expires_at = now() - timedelta(seconds=1)
        await db.commit()
    assert (
        await c.post("/api/v1/baby/share/captures", headers=capability, json=capture())
    ).status_code == 401
    capability, other = await session(c), await session(c)
    assert (await c.delete("/api/v1/baby/share/session", headers=capability)).status_code == 204
    assert (
        await c.post("/api/v1/baby/share/captures", headers=capability, json=capture())
    ).status_code == 401
    assert (
        await c.post("/api/v1/baby/share/captures", headers=other, json=capture())
    ).status_code == 202
    await c.delete("/api/v1/baby/data?generation=1", headers=shared.GEN)
    assert (
        await c.post("/api/v1/baby/share/captures", headers=other, json=capture())
    ).status_code == 409
    async with baby_api.engine.begin() as db:
        await db.execute(text("DROP TABLE baby_share_captures"))
        await db.execute(text("DROP TABLE baby_share_credentials"))
    assert (
        await c.post(
            "/api/v1/baby/share/session", headers=shared.GEN, json={"installation_id": str(uuid4())}
        )
    ).status_code == 503
    async with baby_api.sessions() as db:
        assert await drain_deferred_captures(db) == 0
    assert (await c.get("/api/v1/baby/bootstrap")).status_code == 200


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1/a", "https://localhost/a", "ftp://example.com/a", "https://u:p@example.com"],
)
def test_private_links_refused(url):
    with pytest.raises(ValueError):
        CaptureRequest(**capture(url=url))

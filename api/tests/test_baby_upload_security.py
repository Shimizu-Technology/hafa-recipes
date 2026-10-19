"""Upload admission authenticates before receiving bytes or taking bounded slots."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Request

from app import auth
from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.domains.baby import security


@pytest.fixture
async def upload_api(monkeypatch):
    app = FastAPI()
    router = APIRouter(route_class=security.BabyUploadRoute)

    @router.post("/upload")
    async def upload(request: Request):
        return {"size": len(await request.body())}

    app.include_router(router)
    monkeypatch.setattr(security, "get_settings", lambda: SimpleNamespace(baby_api_enabled=True))
    monkeypatch.setattr(security, "_upload_owners", set())

    async def database():
        yield None

    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield app, client
    assert not security._upload_owners


def owner_override(app):
    async def identity(request: Request):
        return ClerkUser(
            id=request.headers.get("X-Owner", "stable-owner"),
            clerk_user_id="different-clerk-subject",
            clerk_issuer="https://issuer.test",
            clerk_environment="test",
        )

    app.dependency_overrides[get_current_user] = identity


@pytest.mark.parametrize("token", [None, "invalid"])
async def test_unauthenticated_upload_never_reads_body_or_takes_slot(
    upload_api, monkeypatch, token
):
    _, client = upload_api
    consumed, verified = [], []

    async def reject(value):
        verified.append(value)
        raise HTTPException(401, "Invalid token")

    async def body():
        consumed.append(True)
        yield b"never read"

    monkeypatch.setattr(auth, "verify_clerk_token_async", reject)
    headers = {"Authorization": "Bearer " + token} if token else {}
    response = await client.post("/upload", headers=headers, content=body())
    assert response.status_code == 401
    assert consumed == []
    assert verified == ([token] if token else [])
    assert not security._upload_owners


async def test_stable_owner_slots_allow_other_owners_and_bound_process_buffers(
    upload_api, monkeypatch
):
    app, client = upload_api
    owner_override(app)
    monkeypatch.setattr(security, "MAX_CONCURRENT_UPLOADS", 2)
    entered, finish = asyncio.Event(), asyncio.Event()

    async def held_body():
        entered.set()
        await finish.wait()
        yield b"first"

    first = asyncio.create_task(client.post("/upload", content=held_body()))
    await asyncio.wait_for(entered.wait(), timeout=2)
    assert security._upload_owners == {"stable-owner"}
    consumed = []

    async def rejected_body():
        consumed.append(True)
        yield b"not read"

    try:
        same = await client.post("/upload", content=rejected_body())
        assert same.status_code == 429 and not consumed
        other = await client.post("/upload", headers={"X-Owner": "other"}, content=b"other")
        assert other.status_code == 200
        other_entered = asyncio.Event()

        async def other_body():
            other_entered.set()
            await finish.wait()
            yield b"second"

        second = asyncio.create_task(
            client.post("/upload", headers={"X-Owner": "other"}, content=other_body())
        )
        try:
            await asyncio.wait_for(other_entered.wait(), timeout=2)
            assert security._upload_owners == {"stable-owner", "other"}
            capped = await client.post(
                "/upload", headers={"X-Owner": "third"}, content=rejected_body()
            )
            assert capped.status_code == 429 and not consumed
        finally:
            finish.set()
            assert (await second).status_code == 200
    finally:
        finish.set()
        assert (await first).status_code == 200


async def test_account_fence_rejects_before_receiving_body(upload_api):
    app, client = upload_api
    owner_override(app)
    consumed = []

    async def body():
        consumed.append(True)
        yield b"never read"

    response = await client.post(
        "/upload", headers={"X-Hafa-Account-ID": "old-owner"}, content=body()
    )
    assert response.status_code == 409 and not consumed


async def test_authenticated_timeout_and_body_bounds_release_slots(upload_api, monkeypatch):
    app, client = upload_api
    owner_override(app)
    assert security.UPLOAD_TIMEOUT_SECONDS == 90
    monkeypatch.setattr(security, "UPLOAD_TIMEOUT_SECONDS", 0.01)

    async def slow_body():
        await asyncio.Event().wait()
        yield b"never"

    assert (await client.post("/upload", content=slow_body())).status_code == 408
    assert not security._upload_owners
    monkeypatch.setattr(security.BabyUploadRoute, "max_body_bytes", 8)
    assert (await client.post("/upload", content=b"123456789")).status_code == 413

    async def chunked():
        yield b"12345"
        yield b"6789"

    assert (await client.post("/upload", content=chunked())).status_code == 413
    assert (await client.post("/upload", content=b"12345678")).status_code == 200


async def test_cancelled_authenticated_upload_releases_owner_slot(upload_api):
    app, client = upload_api
    owner_override(app)
    entered = asyncio.Event()

    async def body():
        entered.set()
        await asyncio.Event().wait()
        yield b"never"

    pending = asyncio.create_task(client.post("/upload", content=body()))
    await asyncio.wait_for(entered.wait(), timeout=2)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert not security._upload_owners
    assert (await client.post("/upload", content=b"recovered")).status_code == 200

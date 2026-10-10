"""Real PG ASGI response guards; synthetic backpressure, not physical network QA."""

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import JSONResponse

from app.auth import get_current_user
from app.domains.workouts import export_response_gate as gate
from app.domains.workouts.router import User
from tests.test_workouts_data_integration import DATABASE_URL, data_api, settings  # noqa: F401
from tests.test_workouts_export_snapshots import snapshots  # noqa: F401

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


async def receive():
    return {"type": "http.request", "body": b"", "more_body": False}


def route_for(api, monkeypatch, app):
    monkeypatch.setattr(gate, "get_settings", settings)

    class BoundRoute(gate.ExportReadRoute):
        session_factory = api.sessions

    async def endpoint():
        return None

    route = BoundRoute("/export-response-fixture", endpoint, methods=["GET"])
    route.app = app
    return route


def scope():
    return {"type": "http", "method": "GET", "path": "/export-response-fixture", "headers": []}


async def available(api):
    async with api.sessions.begin() as db:
        return await db.scalar(
            text("SELECT pg_try_advisory_xact_lock(:slot)"), {"slot": gate.RESPONSE_LOCK}
        )


async def test_cross_replica_one_response_through_blocked_final_send(snapshots, monkeypatch):  # noqa: F811
    api = snapshots
    entered, resume = asyncio.Event(), asyncio.Event()
    calls = []

    async def app(current_scope, current_receive, current_send):
        calls.append("handler/decrypt")
        await JSONResponse({"private": "fixture"})(current_scope, current_receive, current_send)

    first, second = route_for(api, monkeypatch, app), route_for(api, monkeypatch, app)
    first_messages, second_messages = [], []

    async def blocked_send(message):
        first_messages.append(message)
        if message["type"] == "http.response.body":
            entered.set()
            await resume.wait()

    async def record(message):
        second_messages.append(message)

    pending = asyncio.create_task(first.handle(scope(), receive, blocked_send))
    await asyncio.wait_for(entered.wait(), 5)
    assert not await available(api)
    await asyncio.wait_for(second.handle(scope(), receive, record), 1)
    assert second_messages[0]["status"] == 429
    assert second_messages[1]["body"] == b'{"detail":"export_snapshot_busy"}'
    assert dict(second_messages[0]["headers"])[b"retry-after"] == b"2"
    assert dict(second_messages[0]["headers"])[b"cache-control"] == b"no-store"
    assert calls == ["handler/decrypt"]
    # Exercise a real unrelated persisted Recipes endpoint while the export
    # response is blocked. Its routes never acquire any export advisory slot.
    from app.models.recipe import Recipe
    from app.routers.recipes import router as recipes_router

    api.app.include_router(recipes_router)
    async with api.sessions.begin() as db:
        db.add(
            Recipe(
                user_id="owner",
                source_url="manual://export-slot-fixture",
                source_type="manual",
                extracted={"title": "Recipe fixture"},
            )
        )
    recipe_count = await asyncio.wait_for(api.client.get("/api/recipes/count"), 1)
    assert recipe_count.status_code == 200
    assert recipe_count.json() == {"count": 1}
    resume.set()
    await asyncio.wait_for(pending, 5)
    assert await available(api)
    await second.handle(scope(), receive, record)
    assert len(calls) == 2


async def test_cancelled_asgi_send_releases_guard(snapshots, monkeypatch):  # noqa: F811
    api = snapshots
    entered = asyncio.Event()

    async def app(current_scope, current_receive, current_send):
        await JSONResponse({"private": "fixture"})(current_scope, current_receive, current_send)

    route = route_for(api, monkeypatch, app)

    async def blocked(message):
        if message["type"] == "http.response.body":
            entered.set()
            await asyncio.Event().wait()

    pending = asyncio.create_task(route.handle(scope(), receive, blocked))
    await asyncio.wait_for(entered.wait(), 5)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert await available(api)


async def test_errored_asgi_send_releases_guard(snapshots, monkeypatch):  # noqa: F811
    api = snapshots

    async def app(current_scope, current_receive, current_send):
        await JSONResponse({"private": "fixture"})(current_scope, current_receive, current_send)

    route = route_for(api, monkeypatch, app)

    async def fail(message):
        if message["type"] == "http.response.body":
            raise ConnectionError("Synthetic client disconnect")

    with pytest.raises(ConnectionError):
        await route.handle(scope(), receive, fail)
    assert await available(api)


async def test_backpressure_deadline_releases_without_second_error_body(snapshots, monkeypatch):  # noqa: F811
    api = snapshots
    monkeypatch.setattr(gate, "RESPONSE_SECONDS", 0.05)

    async def app(current_scope, current_receive, current_send):
        await JSONResponse({"private": "fixture"})(current_scope, current_receive, current_send)

    route = route_for(api, monkeypatch, app)
    messages = []

    async def blocked(message):
        messages.append(message)
        if message["type"] == "http.response.body":
            await asyncio.Event().wait()

    with pytest.raises(TimeoutError):
        await route.handle(scope(), receive, blocked)
    assert len([message for message in messages if message["type"] == "http.response.start"]) == 1
    assert await available(api)


async def test_guard_database_failure_fixed503_no_handler(snapshots, monkeypatch):  # noqa: F811
    api = snapshots
    calls = []

    async def app(*args):
        calls.append("unexpected")

    route = route_for(api, monkeypatch, app)

    class FailedSession:
        async def connection(self, **kwargs):
            raise SQLAlchemyError("Private owner/source/credentials must not leak")

        async def close(self):
            return None

    route.session_factory = FailedSession
    messages = []

    async def record(message):
        messages.append(message)

    await route.handle(scope(), receive, record)
    assert messages[0]["status"] == 503
    assert messages[1]["body"] == b'{"detail":"export_snapshot_unavailable"}'
    assert dict(messages[0]["headers"])[b"cache-control"] == b"no-store"
    assert not calls


async def test_default_off_normal404_no_guard_database_or_auth(snapshots, monkeypatch):  # noqa: F811
    api = snapshots

    class ForbiddenSession:
        def __init__(self):
            raise AssertionError("Disabled guard touched DB")

    class BoundRoute(gate.ExportReadRoute):
        session_factory = ForbiddenSession

    async def endpoint(current_user: User):
        raise AssertionError("Disabled route authenticated or decrypted")

    api.app.router.routes.append(BoundRoute("/export-dormant-fixture", endpoint, methods=["GET"]))
    monkeypatch.setattr(
        gate, "get_settings", lambda: settings().model_copy(update={"workouts_api_enabled": False})
    )
    from app.domains.workouts import security

    monkeypatch.setattr(security, "get_settings", gate.get_settings)

    def forbidden_auth():
        raise AssertionError("Disabled route authenticated")

    api.app.dependency_overrides[get_current_user] = forbidden_auth
    result = await api.client.get("/export-dormant-fixture")
    assert result.status_code == 404
    assert result.json() == {"detail": "Not found"}


async def test_existing_auth_fails_before_private_handler_and_releases_slot(snapshots, monkeypatch):  # noqa: F811
    api = snapshots
    monkeypatch.setattr(gate, "get_settings", settings)

    class BoundRoute(gate.ExportReadRoute):
        session_factory = api.sessions

    async def endpoint(current_user: User):
        raise AssertionError("Anonymous request decrypted private export")

    api.app.router.routes.append(BoundRoute("/export-auth-fixture", endpoint, methods=["GET"]))

    def unauthenticated():
        raise HTTPException(401, "Not authenticated")

    api.app.dependency_overrides[get_current_user] = unauthenticated
    result = await api.client.get("/export-auth-fixture")
    assert result.status_code == 401
    assert result.json() == {"detail": "Not authenticated"}
    assert result.headers["cache-control"] == "no-store"
    assert await available(api)

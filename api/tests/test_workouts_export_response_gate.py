"""Real PG ASGI response guards; synthetic backpressure, not physical network QA."""

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import JSONResponse

from app.auth import get_current_user
from app.domains.workouts import export_response_gate as gate
from app.domains.workouts.router import User
from app.request_context import RequestContextMiddleware
from app.request_limits import PastedTextBodyLimitMiddleware
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


def composed_app(route):
    """Include the shared API's real user middleware around the guarded route."""
    app = FastAPI()
    app.router.routes.append(route)
    app.add_middleware(CORSMiddleware, allow_origins=["https://browser.test"])
    app.add_middleware(PastedTextBodyLimitMiddleware)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/api/recipes/count")
    async def recipe_count():
        return {"count": 0}

    return app


def composed_scope():
    return scope() | {
        "http_version": "1.1",
        "scheme": "http",
        "query_string": b"",
        "headers": [(b"x-request-id", b"outer_send"), (b"origin", b"https://browser.test")],
    }


@pytest.mark.parametrize("ending", ["complete", "cancel", "deadline", "error"])
async def test_composed_middleware_retains_slot_until_outer_send_and_recovers(
    snapshots,  # noqa: F811
    monkeypatch,
    ending,
):
    api = snapshots
    # Guard admission and the independent lock probe use two connections. Open
    # them before simulating a slow response; a cold-pool connection timeout is
    # covered separately and is not a successful private-response admission.
    async with api.engine.connect() as first_connection, api.engine.connect() as second_connection:
        await first_connection.execute(text("SELECT 1"))
        await second_connection.execute(text("SELECT 1"))
    entered, release = asyncio.Event(), asyncio.Event()
    calls, first_messages, denied_messages = [], [], []
    if ending == "deadline":
        monkeypatch.setattr(gate, "RESPONSE_SECONDS", 1)

    async def endpoint(current_scope, current_receive, current_send):
        calls.append("private handler")
        await JSONResponse({"private": "fixture"})(current_scope, current_receive, current_send)

    first = composed_app(route_for(api, monkeypatch, endpoint))
    second = composed_app(route_for(api, monkeypatch, endpoint))

    async def blocked_send(message):
        first_messages.append(message)
        if message["type"] == "http.response.body":
            entered.set()
            await release.wait()
            if ending == "error":
                raise OSError("synthetic outer send failure")

    async def record(message):
        denied_messages.append(message)

    pending = asyncio.create_task(first(composed_scope(), receive, blocked_send))
    try:
        await asyncio.wait_for(entered.wait(), 5)
        assert first_messages[0]["status"] == 200, first_messages
        # Let any intermediate relay complete. With the former call_next
        # middleware this released the slot while the outer body stayed blocked.
        for _ in range(5):
            await asyncio.sleep(0)
        assert not await available(api), (first_messages, calls)
        await asyncio.wait_for(second(composed_scope(), receive, record), 1)
        assert denied_messages[0]["status"] == 429
        assert calls == ["private handler"]
        headers = dict(denied_messages[0]["headers"])
        assert headers[b"cache-control"] == b"no-store" and headers[b"retry-after"] == b"2"
        assert headers[b"x-request-id"] == b"outer_send"
        assert headers[b"access-control-allow-origin"] == b"https://browser.test"
        if ending == "cancel":
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
        elif ending == "deadline":
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(pending, 2)
        else:
            release.set()
            if ending == "error":
                with pytest.raises(OSError, match="synthetic outer send failure"):
                    await pending
            else:
                await pending
        assert [m["status"] for m in first_messages if m["type"] == "http.response.start"] == [200]
        assert b"export_snapshot_unavailable" not in b"".join(
            m.get("body", b"") for m in first_messages
        )
        assert await available(api)
        denied_messages.clear()
        await second(composed_scope(), receive, record)
        assert denied_messages[0]["status"] == 200 and calls == ["private handler"] * 2
    finally:
        release.set()
        if not pending.done():
            pending.cancel()
            try:
                await pending
            except asyncio.CancelledError:
                pass


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

"""Actual ASGI ingress; optional socket test requires explicit runtime authorization."""

import asyncio
import json
import os
import socket
import threading
from types import SimpleNamespace

import httpx
import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import ClientDisconnect

from app.domains.workouts import security
from app.request_context import RequestContextMiddleware
from app.request_limits import PastedTextBodyLimitMiddleware

PATH = "/api/v1/workouts/imports"


@pytest.fixture
def fixture(monkeypatch):
    configured = SimpleNamespace(workouts_api_enabled=True)
    gate = threading.Lock()
    monkeypatch.setattr(security, "get_settings", lambda: configured)
    monkeypatch.setattr(security, "_import_ingress", gate)
    calls = []
    router = APIRouter(route_class=security.WorkoutsImportRoute)

    async def auth():
        calls.append("auth/db")

    @router.post(PATH)
    async def upload(payload: dict, request: Request, _=Depends(auth)):
        calls.append("handler")
        if request.headers.get("x-fixture-error") == "handled":
            raise HTTPException(503, "fixture unavailable")
        if request.headers.get("x-fixture-error") == "unhandled":
            raise RuntimeError("fixture failure")
        if request.headers.get("x-fixture-error") == "timeout":
            raise TimeoutError("handler timeout")
        return {"received": len(payload["text"])}

    app = FastAPI()
    app.include_router(router)
    # The same middleware composition as main must retain the route permit
    # through the outermost final send, not an intermediate call_next channel.
    app.add_middleware(CORSMiddleware, allow_origins=["http://test"])
    app.add_middleware(PastedTextBodyLimitMiddleware)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/api/recipes/count")
    async def legacy():
        return {"count": 0}

    return SimpleNamespace(app=app, configured=configured, gate=gate, calls=calls)


def scope(headers=()):
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "path": PATH,
        "raw_path": PATH.encode(),
        "query_string": b"",
        "scheme": "http",
        "server": ("test", 80),
        "client": ("127.0.0.1", 1000),
        "headers": [(b"content-type", b"application/json"), *headers],
    }


def receiver(body=b'{"text":"fixture"}'):
    used = False

    async def receive():
        nonlocal used
        if not used:
            used = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return receive


async def call(app, receive=None, headers=(), send=None):
    messages = []

    async def record(message):
        messages.append(message)

    await app(scope(headers), receive or receiver(), send or record)
    return messages


def status(messages):
    return next(m["status"] for m in messages if m["type"] == "http.response.start")


async def unread():
    raise AssertionError("Rejected bulk ingress must not read any body")


async def test_busy_rejects_before_body_auth_or_db_and_does_not_queue(fixture):
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow_receive():
        entered.set()
        await release.wait()
        return {"type": "http.request", "body": b'{"text":"first"}', "more_body": False}

    first = asyncio.create_task(call(fixture.app, slow_receive))
    await asyncio.wait_for(entered.wait(), 1)
    denied = await asyncio.wait_for(call(fixture.app, unread), 1)
    assert status(denied) == 429
    assert json.loads(denied[1]["body"]) == {"detail": "workouts_import_busy"}
    assert dict(denied[0]["headers"])[b"retry-after"] == b"2"
    assert dict(denied[0]["headers"])[b"cache-control"] == b"no-store"
    assert fixture.calls == [] and fixture.gate.locked()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixture.app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/recipes/count")).status_code == 200
    release.set()
    assert status(await first) == 200
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


async def test_permit_is_held_until_final_response_send_finishes(fixture):
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow_send(message):
        if message["type"] == "http.response.body":
            entered.set()
            await release.wait()

    first = asyncio.create_task(call(fixture.app, send=slow_send))
    await asyncio.wait_for(entered.wait(), 1)
    assert status(await call(fixture.app, unread)) == 429
    release.set()
    await first
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


async def test_master_off_precedes_busy_body_auth_db_even_with_large_content_length(fixture):
    fixture.gate.acquire()
    fixture.configured.workouts_api_enabled = False
    result = await call(fixture.app, unread, [(b"content-length", b"9999999999")])
    assert status(result) == 404 and fixture.calls == []
    assert fixture.gate.locked()  # Rejected request must not release another lease.
    fixture.gate.release()


@pytest.mark.parametrize("where", ["receive", "send"])
async def test_cancellation_releases_without_unlocking_another_request(fixture, where):
    entered = asyncio.Event()

    async def blocked_receive():
        entered.set()
        await asyncio.Event().wait()

    async def blocked_send(message):
        if message["type"] == "http.response.body":
            entered.set()
            await asyncio.Event().wait()

    pending = asyncio.create_task(
        call(
            fixture.app,
            receive=blocked_receive if where == "receive" else None,
            send=blocked_send if where == "send" else None,
        )
    )
    await asyncio.wait_for(entered.wait(), 1)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


@pytest.mark.parametrize(
    "error", ["handled", "unhandled", "invalid_json", "content_length", "chunked_limit"]
)
async def test_errors_release_and_leave_normal_import_usable(fixture, error):
    if error == "unhandled":
        with pytest.raises(RuntimeError, match="fixture failure"):
            await call(fixture.app, headers=[(b"x-fixture-error", b"unhandled")])
    elif error == "handled":
        assert status(await call(fixture.app, headers=[(b"x-fixture-error", b"handled")])) == 503
    elif error == "invalid_json":
        assert status(await call(fixture.app, receiver(b"{"))) == 422
    elif error == "content_length":
        assert status(await call(fixture.app, unread, [(b"content-length", b"3145729")])) == 413
    else:
        chunks = iter([b"x" * (3 * 1024 * 1024), b"x"])

        async def chunked():
            data = next(chunks)
            return {"type": "http.request", "body": data, "more_body": True}

        assert status(await call(fixture.app, chunked)) == 413
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


async def test_stalled_body_deadline_returns_safe_408_and_releases(fixture, monkeypatch):
    monkeypatch.setattr(security, "IMPORT_INGRESS_SECONDS", 0.03)

    async def stalled():
        await asyncio.Event().wait()

    response = await call(fixture.app, stalled)
    assert status(response) == 408 and fixture.calls == []
    assert json.loads(response[1]["body"]) == {"detail": "workouts_import_timeout"}
    assert dict(response[0]["headers"])[b"cache-control"] == b"no-store"
    assert dict(response[0]["headers"])[b"retry-after"] == b"2"
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


async def test_after_response_start_deadline_aborts_without_second_headers_or_error_body(
    fixture, monkeypatch
):
    monkeypatch.setattr(security, "IMPORT_INGRESS_SECONDS", 0.03)
    messages = []

    async def blocked(message):
        messages.append(message)
        if message["type"] == "http.response.body":
            await asyncio.Event().wait()

    with pytest.raises(TimeoutError):
        await call(fixture.app, send=blocked)
    assert [m["status"] for m in messages if m["type"] == "http.response.start"] == [200]
    assert b"workouts_import_timeout" not in b"".join(m.get("body", b"") for m in messages)
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


async def test_unrelated_handler_timeout_is_not_replaced_with_ingress_408(fixture):
    with pytest.raises(TimeoutError, match="handler timeout"):
        await call(fixture.app, headers=[(b"x-fixture-error", b"timeout")])
    assert not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


async def test_disconnected_receive_releases_without_queuing_a_handler(fixture):
    async def disconnected():
        return {"type": "http.disconnect"}

    with pytest.raises(ClientDisconnect):
        await call(fixture.app, disconnected)
    assert fixture.calls == [] and not fixture.gate.locked()
    assert status(await call(fixture.app)) == 200


@pytest.mark.skipif(
    os.environ.get("WORKOUTS_INGRESS_SOCKET_TEST") != "1",
    reason="Explicit socket runtime authorization required",
)
async def test_real_socket_expect_continue_busy_and_disconnect_recovery(fixture):
    import uvicorn

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(fixture.app, log_level="critical", access_log=False, lifespan="off")
    )
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    first_writer = second_writer = None
    try:
        for _ in range(200):
            if server.started:
                break
            await asyncio.sleep(0.01)
        assert server.started
        _, first_writer = await asyncio.open_connection("127.0.0.1", port)
        first_writer.write(
            f"POST {PATH} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{{".encode()
        )
        await first_writer.drain()
        for _ in range(200):
            if fixture.gate.locked():
                break
            await asyncio.sleep(0.01)
        assert fixture.gate.locked()
        reader, second_writer = await asyncio.open_connection("127.0.0.1", port)
        second_writer.write(
            f"POST {PATH} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 3000000\r\nExpect: 100-continue\r\n\r\n".encode()
        )
        await second_writer.drain()
        headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
        assert headers.startswith(b"HTTP/1.1 429") and b"retry-after: 2" in headers.lower()
        # No 100 Continue and no body sent; close the incomplete first connection.
        first_writer.close()
        await first_writer.wait_closed()
        first_writer = None
        for _ in range(200):
            if not fixture.gate.locked():
                break
            await asyncio.sleep(0.01)
        assert not fixture.gate.locked()
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"http://127.0.0.1:{port}{PATH}", json={"text": "recovered"}
            )
        assert response.status_code == 200
    finally:
        for writer in [first_writer, second_writer]:
            if writer:
                writer.close()
                await writer.wait_closed()
        server.should_exit = True
        try:
            await asyncio.wait_for(serving, 5)
        finally:
            if not serving.done():
                serving.cancel()
            listener.close()

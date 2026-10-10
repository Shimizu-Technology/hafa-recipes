"""Tracing/header compatibility with the composed shared API middleware."""

import asyncio
import re

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.ai_governance import ai_request_context, current_ai_context
from app.request_context import RequestContextMiddleware
from app.request_limits import MAX_PASTED_RECIPE_BODY_BYTES, PastedTextBodyLimitMiddleware


@pytest.fixture
def context_app():
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware, allow_origins=["https://browser.test"], expose_headers=["X-Request-ID"]
    )
    app.add_middleware(PastedTextBodyLimitMiddleware)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/api/recipes/context")
    @app.get("/api/v1/workouts/context")
    async def context():
        await asyncio.sleep(0)
        value = current_ai_context()
        return JSONResponse(
            {"request_id": value.request_id, "route": value.route},
            headers={"Cache-Control": "private, max-age=60", "X-Request-ID": "discard-this"},
        )

    @app.get("/api/recipes/handled")
    @app.get("/api/v1/workouts/handled")
    async def handled():
        raise HTTPException(409, "fixture conflict", headers={"Retry-After": "2"})

    @app.get("/api/recipes/unhandled")
    async def unhandled():
        raise RuntimeError("fixture failure")

    @app.get("/api/recipes/validate")
    async def validate(value: int):
        return {"value": value}

    return app


@pytest.mark.parametrize("supplied", ["safe_ID-123", "", "bad id", "x" * 65, "caf\xe9"])
async def test_safe_identity_context_and_headers_preserve_legacy_semantics(context_app, supplied):
    with ai_request_context(request_id="outside", route="outer"):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=context_app), base_url="https://api.test"
        ) as client:
            response = await client.get(
                "/api/recipes/context", headers={"X-Request-ID": supplied.encode("latin-1")}
            )
        request_id = response.headers["X-Request-ID"]
        assert request_id == response.json()["request_id"]
        if supplied == "safe_ID-123":
            assert request_id == supplied
        else:
            assert re.fullmatch(r"[a-f0-9]{32}", request_id)
        assert response.json()["route"] == "/api/recipes/context"
        assert response.headers["Cache-Control"] == "private, max-age=60"
        assert current_ai_context().request_id == "outside"
        assert current_ai_context().route == "outer"


async def test_concurrent_requests_keep_separate_context_and_workouts_no_store(context_app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=context_app), base_url="https://api.test"
    ) as client:
        responses = await asyncio.gather(
            *(
                client.get("/api/v1/workouts/context", headers={"X-Request-ID": f"request_{i}"})
                for i in range(3)
            )
        )
    assert [r.json()["request_id"] for r in responses] == [f"request_{i}" for i in range(3)]
    assert all(r.headers["Cache-Control"] == "no-store" for r in responses)


async def test_handled_validation_body_limit_cors_and_unhandled_error_semantics(context_app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=context_app, raise_app_exceptions=False),
        base_url="https://api.test",
        headers={"X-Request-ID": "error_request", "Origin": "https://browser.test"},
    ) as client:
        handled = await client.get("/api/recipes/handled")
        assert handled.status_code == 409 and handled.json() == {"detail": "fixture conflict"}
        assert handled.headers["X-Request-ID"] == "error_request"
        assert handled.headers["Retry-After"] == "2"
        assert handled.headers["Access-Control-Allow-Origin"] == "https://browser.test"
        assert "cache-control" not in handled.headers
        private = await client.get("/api/v1/workouts/handled")
        assert private.status_code == 409 and private.headers["Cache-Control"] == "no-store"
        invalid = await client.get("/api/recipes/validate?value=invalid")
        assert invalid.status_code == 422 and invalid.headers["X-Request-ID"] == "error_request"
        limited = await client.post(
            "/api/extract/text", headers={"Content-Length": str(MAX_PASTED_RECIPE_BODY_BYTES + 1)}
        )
        assert limited.status_code == 413 and limited.json() == {"detail": "Request body too large"}
        assert limited.headers["X-Request-ID"] == "error_request"
        # ServerErrorMiddleware remains exterior to user middleware, as before:
        # an unhandled error remains an ordinary 500, not a second private body.
        unhandled = await client.get("/api/recipes/unhandled")
        assert unhandled.status_code == 500 and unhandled.text == "Internal Server Error"
        assert "x-request-id" not in unhandled.headers


@pytest.mark.parametrize("kind", ["lifespan", "websocket"])
async def test_non_http_scopes_pass_through_without_new_context(kind):
    seen = []

    async def downstream(scope, receive, send):
        seen.append((scope, current_ai_context().request_id))

    with ai_request_context(request_id="outside"):
        scope = {"type": kind}
        await RequestContextMiddleware(downstream)(scope, None, None)
    assert seen == [(scope, "outside")]


async def test_actual_app_keeps_default_off_headers_and_direct_asgi_middleware():
    from app.main import app

    assert any(m.cls is RequestContextMiddleware for m in app.user_middleware)
    # This regression must not silently move back behind a call_next relay.
    from starlette.middleware.base import BaseHTTPMiddleware

    assert not any(issubclass(m.cls, BaseHTTPMiddleware) for m in app.user_middleware)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://api.test"
    ) as client:
        assert (await client.get("/up", headers={"X-Request-ID": "legacy_up"})).headers[
            "X-Request-ID"
        ] == "legacy_up"
        private = await client.get(
            "/api/v1/workouts/export", headers={"X-Request-ID": "disabled_export"}
        )
        assert private.status_code == 404
        assert private.headers["X-Request-ID"] == "disabled_export"
        assert private.headers["Cache-Control"] == "no-store"

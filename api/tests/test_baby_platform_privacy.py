"""Baby private routes cannot leak journals through shared telemetry hooks."""

import logging
from uuid import uuid4

import pytest

from app.ai_governance import ai_request_context
from app.config import Settings
from app.domains.workouts.privacy import (
    WorkoutsAccessLogFilter,
    redact_workouts_event,
    redact_workouts_transaction,
)


def test_baby_request_and_background_failures_drop_private_content(capsys):
    from app.services.video import _media_log

    private = {
        "event_id": "safe-id",
        "level": "error",
        "request": {"url": "https://api.example/api/v1/baby/records?query=private"},
        "exception": {"values": [{"value": "journal text and SQL parameters"}]},
        "breadcrumbs": [{"message": "photo URL"}],
        "contexts": {"trace": "baby details"},
    }
    expected = {
        "event_id": "safe-id",
        "level": "error",
        "message": "Baby request failed",
        "tags": {"product": "baby"},
    }
    assert redact_workouts_event(private) == expected
    assert redact_workouts_transaction(private) is None
    with ai_request_context(route="/api/v1/baby/imports"):
        assert redact_workouts_event({"exception": private["exception"]}) == {
            "message": "Baby request failed", "tags": {"product": "baby"}
        }
        _media_log("private caption and provider error")
    assert capsys.readouterr().out == ""
    log = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s",
                            ("GET", "/api/v1/baby/attachments/private-id"), None)
    assert not WorkoutsAccessLogFilter().filter(log)


def test_baby_is_dormant_without_affecting_shared_products():
    settings = Settings(database_url="postgresql://test:test@localhost/hafa_test",
                        openai_api_key="test", environment="test")
    assert not settings.baby_api_enabled
    assert not settings.baby_worker_enabled
    assert not settings.baby_ai_enabled


@pytest.mark.parametrize("bad", ["../", "0", "-1", "01", "2147483648", "1/extra"])
def test_cleanup_cannot_expand_beyond_one_baby_attachment(bad):
    from app.deletion_cleanup import is_allowed_cleanup_prefix

    identifier = uuid4()
    owner = "a" * 64
    assert is_allowed_cleanup_prefix(f"baby-private/{owner}/1/{identifier}/")
    assert not is_allowed_cleanup_prefix(f"baby-private/{owner}/{bad}/{identifier}/")
    assert not is_allowed_cleanup_prefix(f"baby-private/{owner}/1/")
    assert not is_allowed_cleanup_prefix(f"baby-private/user-id/1/{identifier}/")


@pytest.mark.parametrize('enabled', [False, True])
async def test_baby_discovery_matches_installed_route_capability(monkeypatch, enabled):
    from app.routers import platform

    monkeypatch.setattr(platform, 'get_settings', lambda: Settings(database_url='postgresql://localhost/test', openai_api_key='test', environment='test', baby_api_enabled=enabled))
    product = next(item for item in (await platform.platform_info()).products if item.id == 'baby')
    assert product.api_path == '/api/v1/baby'
    assert product.available is enabled


async def test_baby_cleanup_locks_exact_attachment_before_deleting(monkeypatch):
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    from app import deletion_cleanup as cleanup

    identifier = uuid4()
    prefix = f'baby-private/{"a" * 64}/1/{identifier}/'
    events = []

    class Session:
        @asynccontextmanager
        async def begin(self):
            yield self

    @asynccontextmanager
    async def session():
        yield Session()

    async def lock(db, attachment_id):
        assert attachment_id == identifier
        events.append('lock')

    async def erase(value):
        assert value == prefix
        assert events == ['lock']
        events.append('delete')

    monkeypatch.setattr(cleanup, 'AsyncSessionLocal', session)
    monkeypatch.setattr(cleanup, 'acquire_recipe_media_lock', lock)
    from app.domains.baby import storage

    monkeypatch.setattr(storage, 'delete_private_prefix', erase)
    monkeypatch.setattr(cleanup, 'storage_service', SimpleNamespace(is_enabled=True))
    await cleanup.DurableDeletionCleanupWorker()._delete_storage_prefixes([prefix])
    assert events == ['lock', 'delete']


async def test_disabled_baby_routes_do_not_authenticate_or_query_shared_database():
    import httpx

    from app.auth import get_current_user
    from app.db import get_db
    from app.main import app

    def forbidden():
        raise AssertionError('Disabled Baby reached a shared dependency')

    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_current_user] = forbidden
    app.dependency_overrides[get_db] = forbidden
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://api.example') as client:
            for path in ('bootstrap', 'records', 'children', 'conversations', 'export'):
                assert (await client.get('/api/v1/baby/' + path)).status_code == 404
            assert (await client.post('/api/v1/baby/bootstrap', content='invalid-json')).status_code == 404
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

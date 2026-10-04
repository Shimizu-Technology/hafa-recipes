"""Lock-target and TLS checks without contacting a remote database."""

import ssl
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from app import nutrition_repair_lock as locks
from app.nutrition_backfill import database_fingerprint


def test_neon_lock_uses_direct_same_database_without_changing_approved_fingerprint(monkeypatch):
    engine = SimpleNamespace(
        url=make_url(
            "postgresql+asyncpg://owner:test-password@ep-test-123-pooler.us-east-2.aws.neon.tech:5432/hafa?command_timeout=30"
        )
    )
    before = database_fingerprint(engine)
    calls = []
    monkeypatch.setattr(
        locks, "create_async_engine", lambda url, **kwargs: calls.append((url, kwargs))
    )
    locks.create_lock_engine(engine)
    url, kwargs = calls[0]
    assert url.host == "ep-test-123.us-east-2.aws.neon.tech"
    assert url == engine.url.set(host=url.host)
    assert engine.url.host.endswith("-pooler.us-east-2.aws.neon.tech")
    assert database_fingerprint(engine) == before
    assert kwargs["poolclass"] is NullPool
    assert kwargs["isolation_level"] == "AUTOCOMMIT"
    assert kwargs["connect_args"]["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert kwargs["connect_args"]["ssl"].check_hostname is True
    assert (
        kwargs["connect_args"]["server_settings"]["application_name"]
        == "hafa-nutrition-repair-lock"
    )


@pytest.mark.parametrize("host", ["db-pooler.example.com", "neon.tech", "unrecognized.neon.tech"])
def test_unknown_remote_lock_routes_fail_closed(host):
    engine = SimpleNamespace(url=make_url(f"postgresql+asyncpg://owner:test@{host}/hafa"))
    with pytest.raises(locks.NutritionBackfillBlocked):
        locks.direct_lock_url(engine)


async def test_connection_failure_during_acquisition_still_disposes_direct_engine(monkeypatch):
    from contextlib import asynccontextmanager

    dispose = AsyncMock()

    @asynccontextmanager
    async def connect():
        raise RuntimeError("test connection failure")
        yield

    engine = SimpleNamespace(connect=connect, dispose=dispose)
    monkeypatch.setattr(locks, "create_lock_engine", lambda data: engine)
    with pytest.raises(RuntimeError, match="test connection failure"):
        async with locks.dedicated_lock_session(None):
            pytest.fail("Failed connection cannot yield a lock session")
    dispose.assert_awaited_once()

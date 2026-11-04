"""Expand-only migrations keep the preceding release working."""
import importlib
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.mark.parametrize("baby_api,version", [(55, 56), (56, 57)], indirect=["baby_api"])
async def test_restore_guard_atomic_rollback_and_rerun(baby_api, monkeypatch, request, version):
    name = {56: "migrations.056_add_baby_spaces", 57: "migrations.057_add_baby_push"}[version]
    migration = importlib.import_module(name)
    monkeypatch.delenv(f"MIGRATION_{version:03}_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(configured=SimpleNamespace(
            baby_api_enabled=True, environment="production"
        ), migration_engine=baby_api.engine)

    def fail_at_marker(conn, cursor, statement, parameters, context, executemany):
        if "INSERT INTO schema_migrations" in statement:
            raise RuntimeError("injected marker failure")

    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", fail_at_marker)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", fail_at_marker)
    async with baby_api.engine.connect() as db:
        table = "baby_spaces" if version == 56 else "baby_push_devices"
        assert await db.scalar(text("SELECT to_regclass(:table)"), {"table": table}) is None
    for _ in range(2):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    # Previous-release bootstrap and writes work against the expanded database.
    assert (await baby_api.client.get("/api/v1/baby/bootstrap")).status_code == 200
    assert (await baby_api.client.post("/api/v1/baby/records", headers=shared.GEN,
                                      json=shared.payload())).status_code == 200


async def test_notification_queue_persists_and_bounds_unknown_retry(baby_api):
    space, notification = uuid4(), uuid4()
    async with baby_api.engine.begin() as db:
        await db.execute(text("""INSERT INTO baby_spaces(id,kind,generation,created_by)
            VALUES(:id,'personal',1,'owner')"""), {"id": space})
        await db.execute(text("""INSERT INTO baby_notifications
            (id,space_id,app_user_id,idempotency_key,collapse_id,kind,due_at)
            VALUES(:id,:space,'owner','reminder/owner/1','same-on-retry','feed',now())"""),
            {"id": notification, "space": space})
    async with baby_api.engine.connect() as db:
        assert await db.scalar(text("SELECT status FROM baby_notifications WHERE id=:id"),
                               {"id": notification}) == "queued"
    for assignments in ("status='delivered'", "unknown_retries=2", "attempts=-1"):
        with pytest.raises(IntegrityError):
            async with baby_api.engine.begin() as db:
                await db.execute(text(f"UPDATE baby_notifications SET {assignments}"))
    with pytest.raises(IntegrityError):
        async with baby_api.engine.begin() as db:
            await db.execute(text("""INSERT INTO baby_notifications
                (id,space_id,app_user_id,idempotency_key,collapse_id,kind,due_at)
                VALUES(:id,:space,'owner','reminder/owner/1','same-on-retry','feed',now())"""),
                {"id": uuid4(), "space": space})

"""055 keeps old startup usable and never enables new request kinds."""
import importlib
from types import SimpleNamespace

import pytest
from sqlalchemy import event, text

from app.domains.baby.runtime import schema_complete
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.055_expand_baby_record_kinds")


async def rewind(engine):
    async with engine.begin() as db:
        await db.execute(text("DELETE FROM schema_migrations WHERE version=55"))
        await db.execute(text("ALTER TABLE baby_records DROP CONSTRAINT ck_baby_record_kind"))
        await db.execute(text("""ALTER TABLE baby_records ADD CONSTRAINT ck_baby_record_kind
            CHECK (kind IN ('source','journal','feeding','sleep','diaper','routine','question','collection'))"""))


async def test_atomic_widen_rerun_and_old_api(baby_api):
    await rewind(baby_api.engine)
    for _ in range(2):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.connect() as db:
        assert await schema_complete(db)
        definition = await db.scalar(text("""SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conname='ck_baby_record_kind' AND convalidated"""))
        assert all("'" + kind + "'" in definition for kind in migration.KINDS)
    for kind in migration.KINDS[8:]:
        response = await baby_api.client.post(
            "/api/v1/baby/records", headers=shared.GEN, json=shared.payload(kind)
        )
        assert response.status_code == 422
    assert (await baby_api.client.post(
        "/api/v1/baby/records", headers=shared.GEN, json=shared.payload()
    )).status_code == 200


async def test_validation_failure_rolls_back_entire_swap(baby_api):
    await rewind(baby_api.engine)

    def fail_validation(conn, cursor, statement, parameters, context, executemany):
        if "VALIDATE CONSTRAINT ck_baby_record_kind" in statement:
            raise RuntimeError("injected validation failure")

    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", fail_validation)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", fail_validation)
    async with baby_api.engine.connect() as db:
        assert await schema_complete(db)
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=55)"))
        definition = await db.scalar(text("""SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conname='ck_baby_record_kind' AND convalidated"""))
        assert "'event'" not in definition


async def test_production_requires_restore_point(baby_api, monkeypatch):
    await rewind(baby_api.engine)
    monkeypatch.delenv("MIGRATION_055_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(
            configured=SimpleNamespace(baby_api_enabled=True, environment="production"),
            migration_engine=baby_api.engine,
        )

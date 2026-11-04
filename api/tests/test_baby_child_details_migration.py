"""Migration 059 keeps the running release working, before and after it applies."""
import importlib
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from app.domains.baby.runtime import schema_complete
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.059_add_baby_child_details")
CHILDREN = "/api/v1/baby/children"
AFTER_058 = pytest.mark.parametrize("baby_api", [58], indirect=True)


async def details_column(engine):
    async with engine.connect() as db:
        return (await db.execute(text("""SELECT udt_name, is_nullable, column_default FROM information_schema.columns
            WHERE table_name='baby_children' AND column_name='details'"""))).first()


async def without_details(engine):
    # The shared fixture adds this column, because the ORM maps it once J1b lands.
    async with engine.begin() as db:
        await db.execute(text("ALTER TABLE baby_children DROP COLUMN IF EXISTS details"))


@AFTER_058
async def test_requires_restore_point_in_production_and_rolls_back_whole(baby_api, monkeypatch):
    await without_details(baby_api.engine)
    monkeypatch.delenv("MIGRATION_059_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(configured=SimpleNamespace(
            baby_api_enabled=True, environment="production"), migration_engine=baby_api.engine)
    assert await details_column(baby_api.engine) is None

    def fail_at_marker(conn, cursor, statement, parameters, context, executemany):
        if "INSERT INTO schema_migrations" in statement:
            raise RuntimeError("injected marker failure")

    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", fail_at_marker)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", fail_at_marker)
    assert await details_column(baby_api.engine) is None


@AFTER_058
async def test_running_api_keeps_working_after_it_applies(baby_api):
    c, before, after = baby_api.client, str(uuid4()), str(uuid4())
    assert (await c.post(CHILDREN, headers=shared.GEN, json={"id": before, "name": "Before"})).status_code == 200
    for _ in range(2):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    column = await details_column(baby_api.engine)
    assert column[:2] == ("jsonb", "NO") and column[2].startswith("'{}'")
    async with baby_api.engine.connect() as db:
        assert await schema_complete(db)
    # Old code doesn't know the column: writes rely on the default, and rows it wrote already have it.
    assert (await c.post(CHILDREN, headers=shared.GEN, json={"id": after, "name": "After"})).status_code == 200
    result = await c.patch(f"{CHILDREN}/{before}", headers=shared.GEN, json={"revision": 1, "birth_date": "2026-11-01"})
    assert result.status_code == 200 and result.json()["revision"] == 2
    assert (await c.post("/api/v1/baby/bootstrap")).status_code == 200
    async with baby_api.engine.connect() as db:
        stored = (await db.execute(text("SELECT details FROM baby_children"))).scalars().all()
    assert stored == [{}, {}]


@AFTER_058
async def test_a_wrong_shaped_column_stops_it_rather_than_a_later_api_start(baby_api):
    await without_details(baby_api.engine)
    async with baby_api.engine.begin() as db:
        await db.execute(text("ALTER TABLE baby_children ADD COLUMN details JSONB"))
    with pytest.raises(RuntimeError, match="details"):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.connect() as db:
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=59)"))


async def test_refuses_to_run_before_058(baby_api):
    await without_details(baby_api.engine)
    with pytest.raises(RuntimeError, match="Baby058 must precede Baby059"):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    assert await details_column(baby_api.engine) is None
    async with baby_api.engine.connect() as db:
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=59)"))

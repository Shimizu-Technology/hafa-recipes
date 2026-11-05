"""Real 058 migration, atomic failure recovery and old-code compatibility."""
import importlib
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from app.domains.baby.runtime import schema_complete
from tests import test_baby_integration as shared

baby_api, pytestmark = shared.baby_api, shared.pytestmark
migration = importlib.import_module("migrations.058_contract_baby_spaces")


async def test_contract_restore_point_atomic_failure_and_idempotence(baby_api, monkeypatch):
    monkeypatch.delenv("MIGRATION_058_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(configured=SimpleNamespace(baby_api_enabled=True, environment="production"),
                                      migration_engine=baby_api.engine)
    def interrupt(conn, cursor, statement, *args):
        if "INSERT INTO schema_migrations" in statement:
            raise RuntimeError("Synthetic failure after all DDL")
    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(RuntimeError, match="Synthetic failure"):
            await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", interrupt)
    async with baby_api.engine.connect() as db:
        assert await db.scalar(text("SELECT is_nullable FROM information_schema.columns WHERE table_name='baby_records' AND column_name='space_id'")) == "YES"
        assert await db.scalar(text("SELECT is_nullable FROM information_schema.columns WHERE table_name='baby_records' AND column_name='app_user_id'")) == "NO"
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=58)"))
        assert await schema_complete(db)
    for _ in range(2):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.connect() as db:
        await migration.verify_contract(db)
        for table in migration.SPACE_TABLES:
            assert await db.scalar(text("""SELECT is_nullable FROM information_schema.columns
                WHERE table_schema='public' AND table_name=:table AND column_name='space_id'"""),
                {"table": table}) == "NO"
    created = await baby_api.client.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload())
    assert created.status_code == 200, created.text
    assert (await baby_api.client.get("/api/v1/baby/bootstrap")).status_code == 200


async def test_contract_refuses_unbackfilled_rows_without_partial_ddl(baby_api):
    async with baby_api.engine.begin() as db:
        await db.execute(text("""INSERT INTO baby_children(id,app_user_id,generation,name,creation_hash,revision)
            VALUES(:id,'owner',1,'Synthetic','x',1)"""), {"id": uuid4()})
    with pytest.raises(RuntimeError, match="zero null space IDs: baby_children"):
        await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.connect() as db:
        assert await db.scalar(text("SELECT is_nullable FROM information_schema.columns WHERE table_name='baby_children' AND column_name='space_id'")) == "YES"
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=58)"))


async def test_only_creator_rows_survive_account_deletion(baby_api):
    c = baby_api.client
    child = await c.post("/api/v1/baby/children", headers=shared.GEN, json={"name": "Synthetic"})
    record = await c.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload())
    asset = await shared.media_fixture(baby_api)
    job = await c.post("/api/v1/baby/imports", headers=shared.GEN, json={"id": str(uuid4()), "text": "Synthetic"})
    await migration.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.begin() as db:
        await db.execute(text("DELETE FROM app_users WHERE id='owner'"))
        for table, identifier in (("baby_children", child.json()["id"]), ("baby_records", record.json()["id"]),
                                  ("baby_attachments", asset)):
            row = (await db.execute(text(f"SELECT app_user_id FROM {table} WHERE id=:id"), {"id": identifier})).one()
            assert row.app_user_id is None
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM baby_imports WHERE id=:id)"), {"id": job.json()["id"]})
        for table in ("baby_imports", "baby_conversations", "baby_messages", "baby_share_captures", "baby_share_credentials"):
            assert await db.scalar(text("SELECT is_nullable FROM information_schema.columns WHERE table_name=:table AND column_name='app_user_id'"), {"table": table}) == "NO"
        assert await schema_complete(db)

"""Migration 060: indexes only, in one transaction, and nothing running depends on them."""
import importlib
import os

import pytest
from sqlalchemy import select, text

from app.domains.baby.models import BABY_TABLES, BabyRecord
from app.domains.baby.runtime import schema_complete
from app.domains.baby.schema import ALLOWED_FORMS
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
INDEXES = {
    "ix_baby_notifications_receipts_due", "ix_baby_notification_prefs_enabled",
    "ix_baby_records_owner_event_link", "ix_baby_records_space_event_link",
}


def migration():
    return importlib.import_module("migrations.060_add_baby_reminder_indexes")


async def present(api):
    async with api.engine.connect() as connection:
        rows = await connection.execute(text(
            "SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indisvalid AND i.relname = ANY(:names)"
        ), {"names": list(INDEXES)})
        return {row[0] for row in rows}


async def schema_ok(api):
    async with api.engine.connect() as connection:
        return await schema_complete(connection, tables=BABY_TABLES, allowed_forms=ALLOWED_FORMS)


@pytest.mark.parametrize("baby_api", [59], indirect=True)
async def test_it_adds_the_indexes_and_schema_complete_is_true_before_and_after(baby_api):
    assert await present(baby_api) == set()
    assert await schema_ok(baby_api) is True
    await migration().run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    assert await present(baby_api) == INDEXES
    assert await schema_ok(baby_api) is True
    # Rerunning changes nothing and records one version.
    await migration().run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.connect() as connection:
        assert await connection.scalar(text("SELECT count(*) FROM schema_migrations WHERE version = 60")) == 1


def test_no_model_maps_them_so_the_running_code_cannot_require_them():
    mapped = {index.name for table in BABY_TABLES for index in table.indexes}
    assert not mapped & INDEXES


@pytest.mark.parametrize("baby_api", [57], indirect=True)
async def test_it_needs_059_first(baby_api):
    with pytest.raises(RuntimeError, match="Baby059 must precede Baby060"):
        await migration().run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    assert await present(baby_api) == set()


@pytest.mark.parametrize("baby_api", [59], indirect=True)
async def test_it_is_all_or_nothing(baby_api, monkeypatch):
    module = migration()
    monkeypatch.setattr(module, "DDL", (*module.DDL[:2], "CREATE INDEX deliberately broken"))
    with pytest.raises(Exception, match="syntax error"):
        await module.run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    assert await present(baby_api) == set()
    async with baby_api.engine.connect() as connection:
        assert await connection.scalar(text("SELECT count(*) FROM schema_migrations WHERE version = 60")) == 0


@pytest.mark.parametrize("baby_api", [59], indirect=True)
async def test_production_needs_a_named_restore_point(baby_api, monkeypatch):
    monkeypatch.setattr(baby_api.settings, "environment", "production")
    monkeypatch.delenv("MIGRATION_060_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="MIGRATION_060_RESTORE_POINT"):
        await migration().run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    assert await present(baby_api) == set()


@pytest.mark.parametrize("baby_api", [59], indirect=True)
async def test_event_link_lookups_use_the_new_indexes_for_owner_and_space_scopes(baby_api):
    await migration().run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.engine.begin() as connection:
        space = await connection.scalar(text("SELECT personal_space_id FROM baby_memberships WHERE app_user_id = 'owner'"))
        await connection.execute(text("""
            INSERT INTO baby_records (id, app_user_id, space_id, generation, revision, kind, title, body, data, occurred_at, creation_hash, created_at, updated_at, change_seq)
            SELECT gen_random_uuid(), 'owner', :space, 1, 1, 'question', 'q', '',
                   jsonb_build_object('event_id', md5(n::text)), now(), md5(n::text), now(), now(), n
            FROM generate_series(1, 4000) n"""), {"space": space})
        await connection.execute(text("ANALYZE baby_records"))
    event = "c4ca4238a0b923820dcc509a6f75849b"
    scopes = {
        "ix_baby_records_owner_event_link": BabyRecord.app_user_id == "owner",
        "ix_baby_records_space_event_link": BabyRecord.space_id == space,
    }
    for name, scope in scopes.items():
        query = select(BabyRecord.id).where(
            scope, BabyRecord.generation == 1, BabyRecord.deleted_at.is_(None),
            BabyRecord.data["event_id"].as_string().in_([event]),
        )
        statement = query.compile(baby_api.engine.sync_engine, compile_kwargs={"literal_binds": True})
        async with baby_api.engine.connect() as connection:
            plan = "\n".join(row[0] for row in await connection.exec_driver_sql("EXPLAIN " + str(statement)))
        assert name in plan, plan


@pytest.mark.parametrize("baby_api", [59], indirect=True)
async def test_the_running_api_keeps_working_while_it_applies(baby_api):
    c = baby_api.client
    assert (await c.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload())).status_code == 200
    await migration().run_migration(configured=baby_api.settings, migration_engine=baby_api.engine)
    assert (await c.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload())).status_code == 200
    assert (await c.get("/api/v1/baby/records", headers=shared.GEN)).json()["total"] == 2

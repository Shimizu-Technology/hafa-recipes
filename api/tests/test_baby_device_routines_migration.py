"""Migration 061: one new table, in one transaction, and nothing running depends on it."""
import importlib
import os

import pytest
from sqlalchemy import text

from app.domains.baby.models import BABY_TABLES
from app.domains.baby.runtime import schema_complete
from app.domains.baby.schema import ALLOWED_FORMS
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
TABLE = "baby_device_routines"


def migration():
    return importlib.import_module("migrations.061_add_baby_device_routines")


async def present(api):
    async with api.engine.connect() as connection:
        return await connection.scalar(text(f"SELECT to_regclass('public.{TABLE}') IS NOT NULL"))


async def schema_ok(api):
    async with api.engine.connect() as connection:
        return await schema_complete(connection, tables=BABY_TABLES, allowed_forms=ALLOWED_FORMS)


async def run(api):
    await migration().run_migration(configured=api.settings, migration_engine=api.engine)


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_it_adds_the_table_and_schema_complete_is_true_before_and_after(baby_api):
    assert not await present(baby_api)
    assert await schema_ok(baby_api) is True
    await run(baby_api)
    assert await present(baby_api)
    assert await schema_ok(baby_api) is True
    await run(baby_api)
    async with baby_api.engine.connect() as connection:
        assert await connection.scalar(text("SELECT count(*) FROM schema_migrations WHERE version = 61")) == 1


def test_no_model_maps_it_so_the_running_code_cannot_require_it():
    assert TABLE not in {table.name for table in BABY_TABLES}


@pytest.mark.parametrize("baby_api", [59], indirect=True)
async def test_it_needs_060_first(baby_api):
    with pytest.raises(RuntimeError, match="Baby060 must precede Baby061"):
        await run(baby_api)
    assert not await present(baby_api)


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_it_is_all_or_nothing(baby_api, monkeypatch):
    module = migration()
    monkeypatch.setattr(module, "DDL", (*module.DDL, "CREATE INDEX deliberately broken"))
    with pytest.raises(Exception, match="syntax error"):
        await run(baby_api)
    assert not await present(baby_api)


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_production_needs_a_named_restore_point(baby_api, monkeypatch):
    monkeypatch.setattr(baby_api.settings, "environment", "production")
    monkeypatch.delenv("MIGRATION_061_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="MIGRATION_061_RESTORE_POINT"):
        await run(baby_api)
    assert not await present(baby_api)


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_a_phone_going_takes_its_row_with_it(baby_api):
    await run(baby_api)
    async with baby_api.engine.begin() as connection:
        device = await connection.scalar(text(
            "INSERT INTO baby_push_devices (id, app_user_id, installation_id, token, platform) "
            "VALUES (gen_random_uuid(), 'owner', 'phone-1', 'ExponentPushToken[a]', 'ios') RETURNING id"
        ))
        await connection.execute(text(f"INSERT INTO {TABLE} (device_id) VALUES (:id)"), {"id": device})
        await connection.execute(text("DELETE FROM baby_push_devices WHERE id = :id"), {"id": device})
        assert await connection.scalar(text(f"SELECT count(*) FROM {TABLE}")) == 0


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_the_running_api_keeps_working_while_it_applies(baby_api):
    c = baby_api.client
    assert (await c.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload())).status_code == 200
    await run(baby_api)
    assert (await c.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload())).status_code == 200

"""The assembled additive migrations coexist without changing Recipes schema."""

import importlib
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.domains.workouts.automation_runtime import verify_automation_schema
from app.domains.workouts.connection_runtime import verify_connections_schema
from app.domains.workouts.optional_runtime import verify_optional_workouts_schema
from app.domains.workouts.runtime import verify_workouts_schema
from tests.test_workouts_automation_integration import automation_api  # noqa: F401
from tests.test_workouts_data_integration import DATABASE_URL, data_api, settings  # noqa: F401


async def legacy_columns(engine):
    async with engine.connect() as connection:
        return (
            await connection.execute(
                text(
                    "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name NOT LIKE 'workouts_%' ORDER BY table_name,column_name"
                )
            )
        ).all()


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_optional_full_chain_replays_and_keeps_legacy_schema(automation_api):  # noqa: F811
    api = automation_api
    configured = settings(workouts_health_sync_enabled=True)
    before = await legacy_columns(api.engine)
    for _ in range(2):
        for module in (
            "036_add_workouts_health",
            "037_add_workouts_connections_sharing",
            "038_add_workouts_library_organization",
            "039_add_workouts_measurements",
            "040_add_workouts_ai_admission",
            "041_add_workouts_recipe_grant_epochs",
            "042_add_workouts_import_usage",
            "043_add_workouts_export_snapshots",
            "044_add_workouts_activity_log",
        ):
            await importlib.import_module("migrations." + module).run_migration(
                configured=configured, migration_engine=api.engine
            )
    assert await legacy_columns(api.engine) == before
    await verify_workouts_schema(api.sessions, settings=configured)
    await verify_automation_schema(api.sessions, settings=configured)
    await verify_connections_schema(api.sessions, settings=configured)
    await verify_optional_workouts_schema(configured=configured, target_engine=api.engine)
    async with api.engine.connect() as connection:
        assert list(
            (
                await connection.execute(
                    text("SELECT version FROM workouts_schema_migrations ORDER BY version")
                )
            ).scalars()
        ) == [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44]
        assert await connection.scalar(text("SELECT max(version) FROM schema_migrations")) == 33


async def test_disabled_optional_readiness_never_opens_database():
    class ForbiddenEngine:
        def connect(self):
            raise AssertionError("Dormant product must not open its database")

    await verify_optional_workouts_schema(
        configured=SimpleNamespace(workouts_api_enabled=False), target_engine=ForbiddenEngine()
    )

import pytest

from app.plan_quantities import scaled_plan_quantity


@pytest.mark.parametrize(
    "quantity,target,base,expected,unscaled",
    [
        ("2", 8, 4, "4", False),
        ("1 1/2", 2, 4, "3/4", False),
        ("½", 8, 4, "1", False),
        ("1½", 8, 4, "3", False),
        ("0.25", 6, 4, "3/8", False),
        ("0", 6, 4, "0", False),
        (None, 8, 4, None, False),
        ("to taste", 8, 4, "to taste", True),
        ("2-3", 8, 4, "2-3", True),
        ("1/0", 8, 4, "1/0", True),
        ("2", 8, None, "2", True),
        ("2", None, 4, "2", False),
    ],
)
def test_plan_scaling_never_invents_an_unknown_amount(quantity, target, base, expected, unscaled):
    assert scaled_plan_quantity(quantity, target, base) == (expected, unscaled)


@pytest.mark.asyncio
async def test_planned_servings_migration_is_additive_idempotent_and_restore_gated(monkeypatch):
    import os
    from importlib import import_module
    from types import SimpleNamespace
    from uuid import uuid4

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from tests.database_safety import require_disposable_test_database

    url = os.environ.get("TEST_DATABASE_URL")
    require_disposable_test_database(url)
    assert url and url.endswith("/hafa_impl_recipes_test")
    async_url = url.replace("postgresql://", "postgresql+asyncpg://")
    admin = create_async_engine(async_url)
    schema = f"r10_migration_{uuid4().hex}"
    async with admin.begin() as db:
        assert await db.scalar(text("select current_database()")) == "hafa_impl_recipes_test"
        await db.execute(text(f"CREATE SCHEMA {schema}"))
    isolated = create_async_engine(
        async_url, connect_args={"server_settings": {"search_path": schema}}
    )
    try:
        async with isolated.begin() as db:
            await db.execute(
                text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT)")
            )
            await db.execute(
                text("CREATE TABLE meal_plan_entries(id INTEGER PRIMARY KEY, servings VARCHAR(20))")
            )
            await db.execute(text("INSERT INTO meal_plan_entries VALUES(1,'8')"))
        migration = import_module("migrations.053_add_planned_servings")
        monkeypatch.delenv("MIGRATION_053_RESTORE_POINT", raising=False)
        with pytest.raises(RuntimeError, match="restore point"):
            await migration.run_migration(
                configured=SimpleNamespace(environment="production"), migration_engine=isolated
            )
        for _ in range(2):
            await migration.run_migration(
                configured=SimpleNamespace(environment="development"), migration_engine=isolated
            )
        async with isolated.begin() as db:
            assert tuple(
                (
                    await db.execute(
                        text("SELECT servings, planned_servings FROM meal_plan_entries")
                    )
                ).one()
            ) == ("8", None)
            assert (
                await db.scalar(text("SELECT count(*) FROM schema_migrations WHERE version=53"))
                == 1
            )
            with pytest.raises(Exception):
                await db.execute(text("UPDATE meal_plan_entries SET planned_servings=0"))
    finally:
        await isolated.dispose()
        async with admin.begin() as db:
            await db.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        await admin.dispose()


def test_numbered_migration_cli_invokes_its_coroutine(monkeypatch):
    import asyncio
    import runpy
    import sys

    called = []

    def run(coroutine):
        called.append(coroutine.cr_code.co_name)
        coroutine.close()

    monkeypatch.setattr(asyncio, "run", run)
    monkeypatch.delitem(sys.modules, "migrations.053_add_planned_servings", raising=False)
    runpy.run_module("migrations.053_add_planned_servings", run_name="__main__")
    assert called == ["run_migration"]

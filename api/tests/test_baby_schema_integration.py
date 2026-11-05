"""Pre-F11 startup and historical migration compatibility on real PostgreSQL."""

import importlib

import pytest
from sqlalchemy import Column, Text, text

from app.domains.baby.models import BABY_TABLES
from app.domains.baby.runtime import schema_complete, verify_baby_schema
from app.domains.baby.schema import ALLOWED_FORMS
from app.domains.baby.schema import schema_complete as check_schema
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from migrations._baby_v1_schema import BABY_SHARE_V1_TABLES, BABY_V1_TABLES
from migrations.run import BABY_MIGRATIONS
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")

# Deliberately independent of the production contract/metadata. These are the
# portions of future DDL that affect old startup and historical migrations.
SPACE_TABLES = (
    "baby_children", "baby_records", "baby_attachments", "baby_imports",
    "baby_conversations", "baby_messages", "baby_share_credentials", "baby_share_captures",
)
CREATORS = ("baby_children", "baby_records", "baby_attachments")
LIVE_TABLES = (*BABY_TABLES, BabyShareCredential.__table__, BabyShareCapture.__table__)
OLD_TABLES = (*BABY_V1_TABLES, *BABY_SHARE_V1_TABLES)




@pytest.mark.parametrize("baby_api", [54, 55, 56, 57, 58], indirect=True)
async def test_startup_and_named_chain_rerun_at_each_stage(baby_api, monkeypatch, request):
    stage = request.node.callspec.params["baby_api"]
    monkeypatch.setattr("app.domains.baby.runtime.get_settings", lambda: baby_api.settings)
    if stage >= 57:
        await verify_baby_schema(baby_api.sessions)
    else:
        with pytest.raises(RuntimeError, match="before deploying F2"):
            await verify_baby_schema(baby_api.sessions)
    async with baby_api.engine.connect() as db:
        assert await schema_complete(db, tables=OLD_TABLES)
        if stage >= 56:
            # A caller can request the strict mapped shape instead.
            assert await schema_complete(db, tables=OLD_TABLES, allowed_forms={}) == (stage < 58)
    for name in BABY_MIGRATIONS:
        await importlib.import_module(name).run_migration(
            configured=baby_api.settings, migration_engine=baby_api.engine
        )
    await verify_baby_schema(baby_api.sessions)
    async with baby_api.engine.connect() as db:
        assert await check_schema(
            db, tables=(*BABY_V1_TABLES, *BABY_SHARE_V1_TABLES), allowed_forms=ALLOWED_FORMS
        )


@pytest.mark.parametrize("ddl", [
    "ALTER TABLE baby_children DROP COLUMN creation_hash",
    "ALTER TABLE baby_children ALTER COLUMN revision TYPE BIGINT",
    "ALTER TABLE baby_children ALTER COLUMN name DROP NOT NULL",
    "ALTER TABLE baby_children ALTER COLUMN birth_date SET NOT NULL",
    "ALTER TABLE baby_children DROP CONSTRAINT baby_children_pkey",
    "DROP INDEX ix_baby_children_owner",
    "ALTER TABLE baby_memberships DROP CONSTRAINT ck_baby_generation",
    "ALTER TABLE baby_memberships DROP CONSTRAINT ck_baby_generation; "
    "ALTER TABLE baby_memberships ADD CONSTRAINT ck_baby_generation CHECK (generation > 0) NOT VALID",
    "ALTER TABLE baby_children ALTER COLUMN app_user_id DROP NOT NULL",  # nullable/CASCADE
    "ALTER TABLE baby_children DROP CONSTRAINT baby_children_app_user_id_fkey",
    "ALTER TABLE baby_children DROP CONSTRAINT baby_children_app_user_id_fkey; "
    "ALTER TABLE baby_children ADD FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE SET NULL",
    "ALTER TABLE baby_children ADD FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE RESTRICT",
    "ALTER TABLE baby_imports ALTER COLUMN app_user_id DROP NOT NULL",
    "ALTER TABLE baby_ai_admissions DROP CONSTRAINT baby_ai_admissions_app_user_id_fkey; "
    "ALTER TABLE baby_ai_admissions ADD FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE",
])
async def test_strict_rules_still_reject_drift(baby_api, ddl):
    async with baby_api.engine.begin() as db:
        for statement in ddl.split("; "):
            await db.execute(text(statement))
        assert not await schema_complete(db)
    with pytest.raises(RuntimeError, match="schema"):
        await shared.migration.run_migration(
            configured=baby_api.settings, migration_engine=baby_api.engine
        )


@pytest.mark.parametrize("table", SPACE_TABLES)
@pytest.mark.parametrize("drift", ["type", "action", "missing_fk", "unvalidated_fk"])
async def test_every_space_column_is_checked_without_an_orm_mapping(baby_api, table, drift):
    async with baby_api.engine.begin() as db:
        await db.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {table}_space_id_fkey"))
        if drift == "type":
            await db.execute(text(f"ALTER TABLE {table} ALTER COLUMN space_id TYPE TEXT"))
        elif drift != "missing_fk":
            action = "SET NULL" if drift == "action" else "CASCADE"
            suffix = " NOT VALID" if drift == "unvalidated_fk" else ""
            await db.execute(text(f"""ALTER TABLE {table} ADD FOREIGN KEY (space_id)
                REFERENCES baby_spaces(id) ON DELETE {action}{suffix}"""))
        assert not await schema_complete(db, tables=LIVE_TABLES)
    migration = "migrations.051_add_baby_share" if "share_" in table else BABY_MIGRATIONS[0]
    with pytest.raises(RuntimeError, match="schema"):
        await importlib.import_module(migration).run_migration(
            configured=baby_api.settings, migration_engine=baby_api.engine
        )


async def test_frozen_creation_and_verification_ignore_future_model_changes(baby_api, monkeypatch):
    changed_tables = (BABY_TABLES[1], BabyShareCredential.__table__)
    async with baby_api.engine.begin() as db:
        await db.execute(text("DELETE FROM schema_migrations WHERE version IN (50,51,52,55,56,57)"))
        for table in reversed(OLD_TABLES):
            await db.execute(text(f"DROP TABLE {table.name} CASCADE"))
    added = []
    try:
        for table in changed_tables:
            column = Column("future_required_column", Text, nullable=False)
            table.append_column(column)
            added.append((table, column))
            monkeypatch.setattr(table.c.app_user_id, "nullable", True)
            monkeypatch.setattr(next(iter(table.c.app_user_id.foreign_keys)), "ondelete", "SET NULL")
        for name in BABY_MIGRATIONS:
            await importlib.import_module(name).run_migration(
                configured=baby_api.settings, migration_engine=baby_api.engine
            )
        async with baby_api.engine.connect() as db:
            assert await check_schema(
                db, tables=(*BABY_V1_TABLES, *BABY_SHARE_V1_TABLES), allowed_forms=ALLOWED_FORMS
            )
            assert not await db.scalar(text("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_name LIKE 'baby_%' AND column_name='future_required_column')"""))
    finally:
        for table, column in added:
            table._columns.remove(column)


async def test_fresh_prepare_schema_runs_complete_named_chain(baby_api, monkeypatch):
    from app.config import Settings
    from migrations import run
    from scripts import seed_development

    settings = Settings(
        _env_file=None, database_url=shared.DATABASE_URL, openai_api_key="test-only",
        environment="test", baby_api_enabled=True, workouts_api_enabled=False,
        clerk_development_issuer="https://development.clerk.example.test",
    )
    async with baby_api.engine.begin() as db:
        await db.execute(text("DROP SCHEMA public CASCADE"))
        await db.execute(text("CREATE SCHEMA public"))
    monkeypatch.setattr(seed_development, "engine", baby_api.engine)
    monkeypatch.setattr(run, "get_settings", lambda: settings)
    for name in (*run.ACTIVE_MIGRATIONS, *run.BABY_MIGRATIONS):
        module = importlib.import_module(name)
        monkeypatch.setattr(module, "engine", baby_api.engine)
        if hasattr(module, "get_settings"):
            monkeypatch.setattr(module, "get_settings", lambda: settings)
    await seed_development.prepare_schema()
    await seed_development.prepare_schema()
    async with baby_api.engine.connect() as db:
        assert await schema_complete(db)
        assert (await db.execute(text("""SELECT version FROM schema_migrations
            WHERE version IN (50,51,52,54) ORDER BY version"""))).scalars().all() == [50, 51, 52, 54]


async def test_later_tables_can_map_space_id_and_new_column_types():
    """F2 will map these; an unmapped type would fail startup closed, or raise on a new table."""
    from sqlalchemy import BigInteger, Boolean, ForeignKey, MetaData, String, Table
    from sqlalchemy.dialects.postgresql import UUID
    from sqlalchemy.ext.asyncio import create_async_engine

    from tests.database_safety import require_disposable_test_database

    meta = MetaData()
    Table("baby_spaces", meta, Column("id", UUID(as_uuid=True), primary_key=True))
    later = Table(
        "baby_later_stage", meta,
        Column("id", UUID(as_uuid=True), primary_key=True),
        Column("space_id", UUID(as_uuid=True), ForeignKey("baby_spaces.id", ondelete="CASCADE"), nullable=False),
        Column("seq", BigInteger, nullable=False),
        Column("flag", Boolean, nullable=False),
        Column("label", String(8), nullable=False),
    )
    require_disposable_test_database(shared.DATABASE_URL)
    engine = create_async_engine(shared.DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(meta.create_all)
            assert await check_schema(connection, tables=(later,), allowed_forms={})
            await connection.execute(text("ALTER TABLE baby_later_stage ALTER COLUMN seq TYPE integer"))
            assert not await check_schema(connection, tables=(later,), allowed_forms={})
    finally:
        await engine.dispose()

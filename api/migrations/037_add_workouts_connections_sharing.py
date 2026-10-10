"""Optional connections/sharing migration, outside Recipes' active chain."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.connection_models import CONNECTION_TABLES


async def install_connections_schema(connection):
    await connection.run_sync(
        lambda sync: CONNECTION_TABLES[0].metadata.create_all(sync, tables=list(CONNECTION_TABLES))
    )
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION prevent_published_training_snapshot_update()
        RETURNS TRIGGER AS $$ BEGIN
            IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
                OR NEW.snapshot_digest IS DISTINCT FROM OLD.snapshot_digest
                OR NEW.app_user_id IS DISTINCT FROM OLD.app_user_id
                OR NEW.generation IS DISTINCT FROM OLD.generation
                OR NEW.kind IS DISTINCT FROM OLD.kind
                OR NEW.record_id IS DISTINCT FROM OLD.record_id
                OR NEW.source_revision IS DISTINCT FROM OLD.source_revision
                OR NEW.scope IS DISTINCT FROM OLD.scope
                OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
                OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
            THEN RAISE EXCEPTION 'Published training snapshots are immutable'; END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql
    """)
    )
    await connection.execute(
        text("DROP TRIGGER IF EXISTS immutable_published_training_snapshot ON workouts_shares")
    )
    await connection.execute(
        text("""
        CREATE TRIGGER immutable_published_training_snapshot BEFORE UPDATE ON workouts_shares
        FOR EACH ROW EXECUTE FUNCTION prevent_published_training_snapshot_update()
    """)
    )
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION prevent_workouts_connection_receipt_update()
        RETURNS TRIGGER AS $$ BEGIN
            RAISE EXCEPTION 'Workouts connection receipts are immutable';
        END $$ LANGUAGE plpgsql
    """)
    )
    for table in ("workouts_recipe_connection_receipts", "workouts_copy_receipts"):
        await connection.execute(
            text(f"DROP TRIGGER IF EXISTS immutable_workouts_connection_receipt ON {table}")
        )
        await connection.execute(
            text(f"""
            CREATE TRIGGER immutable_workouts_connection_receipt BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION prevent_workouts_connection_receipt_update()
        """)
        )


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    target = migration_engine or engine
    async with target.begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340037)"))
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=37)")
        ):
            return
        if not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            raise RuntimeError("Optional Workouts migration 035 must precede 037")
        restore_point = (
            getattr(settings, "migration_037_restore_point", None)
            or os.environ.get("MIGRATION_037_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore_point:
            raise RuntimeError(
                "MIGRATION_037_RESTORE_POINT must name a verified production restore point"
            )
        if len(restore_point) > 160 or any(ord(char) < 32 for char in restore_point):
            raise RuntimeError("MIGRATION_037_RESTORE_POINT is invalid")
        await install_connections_schema(connection)
        await connection.execute(
            text("""
            INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(37,:restore_point,:release_id)
        """),
            {"restore_point": restore_point or None, "release_id": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())

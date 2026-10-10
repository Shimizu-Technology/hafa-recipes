"""Optional Workouts library organization; Recipes migration ledger stays at33."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.library_organization_models import ORGANIZATION_TABLES
from app.domains.workouts.library_organization_service import source_key


async def install_organization_schema(connection):
    # Composite targets make cross-owner collection membership impossible even
    # for accidental direct ORM writes. Only the optional Workouts table changes.
    await connection.execute(
        text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_workouts_library_organization_owner
        ON workouts_library(id,app_user_id,generation)
    """)
    )
    await connection.run_sync(
        lambda sync: ORGANIZATION_TABLES[0].metadata.create_all(
            sync, tables=list(ORGANIZATION_TABLES)
        )
    )
    await connection.execute(
        text("""
        DROP TRIGGER IF EXISTS immutable_workouts_duplicate ON workouts_library_duplicate_receipts
    """)
    )
    await connection.execute(
        text("""
        CREATE TRIGGER immutable_workouts_duplicate BEFORE UPDATE
        ON workouts_library_duplicate_receipts FOR EACH ROW
        EXECUTE FUNCTION prevent_workouts_snapshot_update()
    """)
    )
    # No customer content is logged or copied into metadata. Key maintenance is
    # rerunnable and bounded per batch; existing user metadata is preserved.
    last = None
    while True:
        rows = (
            (
                await connection.execute(
                    text("""
            SELECT id,app_user_id,generation,content->>'source_url' AS source_url
            FROM workouts_library WHERE (CAST(:last AS UUID) IS NULL OR id>CAST(:last AS UUID))
            ORDER BY id LIMIT 500
        """),
                    {"last": str(last) if last else None},
                )
            )
            .mappings()
            .all()
        )
        if not rows:
            break
        for row in rows:
            await connection.execute(
                text("""
                INSERT INTO workouts_library_organization
                (workout_id,app_user_id,generation,revision,favorite,archived,tags,tag_keys,source_key)
                VALUES(:id,:owner,:generation,1,false,false,'[]','[]',:key)
                ON CONFLICT(workout_id) DO UPDATE SET source_key=EXCLUDED.source_key
            """),
                {
                    "id": row["id"],
                    "owner": row["app_user_id"],
                    "generation": row["generation"],
                    "key": source_key(row["source_url"]),
                },
            )
        last = rows[-1]["id"]


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        ledger = await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not ledger or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            raise RuntimeError("Workouts migration035 must precede038")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=38)")
        ):
            return
        restore = (
            getattr(settings, "migration_038_restore_point", None)
            or os.environ.get("MIGRATION_038_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_038_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_038_RESTORE_POINT is invalid")
        await install_organization_schema(connection)
        await connection.execute(
            text("""
            INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(38,:restore,:release)
        """),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())

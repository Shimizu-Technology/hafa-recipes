"""Optional durable export receipts/leases; no Recipes core DDL."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.export_job_definitions import EXPORT_JOB_FUNCTION_BODIES
from app.domains.workouts.export_job_models import EXPORT_JOB_TABLES


async def install_export_job_schema(connection):
    await connection.run_sync(
        lambda db: EXPORT_JOB_TABLES[0].metadata.create_all(db, tables=list(EXPORT_JOB_TABLES))
    )
    for name, body in EXPORT_JOB_FUNCTION_BODIES.items():
        await connection.execute(
            text(
                f"CREATE OR REPLACE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $${body}$$"
            )
        )
    for name, table, action, function in (
        (
            "fence_workouts_export_job_identity",
            "workouts_export_jobs",
            "UPDATE",
            "fence_workouts_export_job_identity",
        ),
        (
            "fence_workouts_export_job_slot",
            "workouts_export_job_slot",
            "UPDATE",
            "fence_workouts_export_job_slot",
        ),
        (
            "persistent_workouts_export_job_slot",
            "workouts_export_job_slot",
            "DELETE",
            "reject_export_slot_deletion",
        ),
        (
            "immutable_workouts_export_job_recovery",
            "workouts_export_job_recovery",
            "UPDATE",
            "reject_export_recovery_update",
        ),
    ):
        await connection.execute(text(f"DROP TRIGGER IF EXISTS {name} ON {table}"))
        await connection.execute(
            text(
                f"CREATE TRIGGER {name} BEFORE {action} ON {table} FOR EACH ROW EXECUTE FUNCTION {function}()"
            )
        )
    await connection.execute(
        text("INSERT INTO workouts_export_job_slot(slot) VALUES(1) ON CONFLICT DO NOTHING")
    )


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled or not settings.workouts_export_jobs_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT count(*)=2 FROM workouts_schema_migrations WHERE version IN (35,43)")
        ):
            raise RuntimeError("Workouts migrations035/043 must precede045")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=45)")
        ):
            return
        restore = (
            getattr(settings, "migration_045_restore_point", None)
            or os.environ.get("MIGRATION_045_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_045_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_045_RESTORE_POINT is invalid")
        await install_export_job_schema(connection)
        await connection.execute(
            text(
                "INSERT INTO workouts_schema_migrations(version,restore_point,release_id) VALUES(45,:restore,:release)"
            ),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())

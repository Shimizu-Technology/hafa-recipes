"""Readiness for additive product tables; disabled domains never open the DB."""

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.activity_log_service import verify_activity_log_schema
from app.domains.workouts.budget import verify_budget_schema
from app.domains.workouts.export_job_runtime import verify_export_job_schema
from app.domains.workouts.export_service import verify_export_schema
from app.domains.workouts.health_models import HEALTH_TABLES
from app.domains.workouts.library_organization_service import verify_organization_schema
from app.domains.workouts.measurement_service import verify_measurement_schema
from app.domains.workouts.recipe_grant_service import verify_recipe_grant_schema


async def verify_optional_workouts_schema(*, configured=None, target_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    target = target_engine or engine
    await verify_organization_schema(target, settings)
    await verify_measurement_schema(target, settings)
    await verify_budget_schema(target, settings)
    await verify_recipe_grant_schema(target, settings)
    await verify_export_schema(target, settings)
    await verify_export_job_schema(target, settings=settings)
    await verify_activity_log_schema(target, settings)
    if not settings.workouts_health_sync_enabled:
        return
    async with target.connect() as connection:
        if not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=36)")
        ):
            raise RuntimeError("Optional Workouts health migration036 is missing")
        for table in HEALTH_TABLES:
            columns = set(
                (
                    await connection.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:name"
                        ),
                        {"name": table.name},
                    )
                ).scalars()
            )
            if not set(table.columns.keys()) <= columns:
                raise RuntimeError("Optional Workouts health schema is incomplete")
            if not await connection.scalar(
                text(
                    "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=CAST(:table AS regclass) AND confrelid='public.app_users'::regclass AND contype='f' AND convalidated AND confdeltype='c')"
                ),
                {"table": "public." + table.name},
            ):
                raise RuntimeError("Workouts health account-deletion cascade is missing")

"""Shared account locks fence every Workouts write and future worker completion."""

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsConsent,
    WorkoutsGrant,
    WorkoutsMembership,
    WorkoutsProfile,
    WorkoutsProgram,
    WorkoutsSession,
)
from app.models.identity import AppUser


def now():
    return datetime.now(UTC)


async def lock_owner(db, app_user_id: str):
    # Same first lock as legacy DELETE /api/users/me. An in-flight write either
    # finishes before deletion or waits and observes that the owner is gone.
    owner = await db.scalar(select(AppUser.id).where(AppUser.id == app_user_id).with_for_update())
    if owner is None:
        raise HTTPException(404, "Account not found")


async def membership_for(db, app_user_id: str, *, generation=None, write=False, active=True):
    if write:
        await lock_owner(db, app_user_id)
    membership = await db.scalar(
        select(WorkoutsMembership)
        .where(
            WorkoutsMembership.app_user_id == app_user_id,
        )
        .execution_options(populate_existing=True)
    )
    if membership is None or (active and membership.status != "active"):
        raise HTTPException(409, "Explicit Workouts enrollment is required")
    if generation is not None and membership.generation != generation:
        raise HTTPException(409, "Workouts data generation changed; refresh before saving")
    return membership


async def optional_table_exists(db, table_name):
    """Request-local schema check supports 034-only and installed optional slices.

    Only server constants reach this helper; never cache across database/schema
    deployments or imply that missing enabled migrations are release-ready.
    """
    tables = db.info.setdefault("workouts_optional_tables", {})
    if table_name not in tables:
        tables[table_name] = bool(
            await db.scalar(
                text("SELECT to_regclass(:name) IS NOT NULL"), {"name": "public." + table_name}
            )
        )
    return tables[table_name]


async def erase_product_data(db, membership, requested_generation: int):
    if membership.status == "deleted" and requested_generation == membership.generation - 1:
        return membership  # Retry of the already-completed deletion.
    if requested_generation != membership.generation or membership.status != "active":
        raise HTTPException(409, "Workouts data generation changed; refresh before deleting")
    owner = membership.app_user_id
    if await optional_table_exists(db, "workouts_health_connections"):
        from app.domains.workouts.health_models import HEALTH_TABLES
        from app.domains.workouts.health_service import erase_health_product_data

        await erase_health_product_data(db, owner, membership.generation)
        # Full product erasure also removes any orphan from an older generation.
        for table in HEALTH_TABLES:
            await db.execute(delete(table).where(table.c.app_user_id == owner))
    if await optional_table_exists(db, "workouts_shares"):
        from app.domains.workouts.connection_lifecycle import erase_connections_data

        await erase_connections_data(db, owner)
    if await optional_table_exists(db, "workouts_library_organization"):
        from app.domains.workouts.library_organization_service import erase_library_organization

        await erase_library_organization(db, owner)
    if await optional_table_exists(db, "workouts_measurements"):
        from app.domains.workouts.measurement_service import erase_measurements

        await erase_measurements(db, owner)
    if await optional_table_exists(db, "workouts_recipe_grant_epochs"):
        from app.domains.workouts.recipe_grant_service import erase_recipe_grant_epochs

        await erase_recipe_grant_epochs(db, owner)
    # Content-free 48h import allowance receipts intentionally survive product
    # erasure; whole-account deletion cascades them from the stable AppUser.
    # Optional automation may be absent in a supported 034-only environment.
    # Once installed, product erasure removes pending sources and coach memory.
    if await optional_table_exists(db, "workouts_import_jobs"):
        from app.domains.workouts.automation_models import AUTOMATION_TABLES

        for table in AUTOMATION_TABLES:
            await db.execute(delete(table).where(table.c.app_user_id == membership.app_user_id))
    if await optional_table_exists(db, "workouts_activity_log"):
        from app.domains.workouts.activity_log_service import erase_activity_logs

        await erase_activity_logs(db, owner)
    # Version records cascade from the library/program rows. The membership
    # tombstone remains so delayed offline writes cannot silently re-enroll.
    for model in (
        WorkoutsSession,
        WorkoutsActivity,
        WorkoutsConsent,
        WorkoutsGrant,
        WorkoutsProfile,
        WorkoutRecord,
        WorkoutsProgram,
    ):
        await db.execute(delete(model).where(model.app_user_id == membership.app_user_id))
    membership.generation += 1
    membership.status = "deleted"
    membership.deleted_at = now()
    await db.flush()
    from app.domains.workouts.export_service import erase_export_epochs_after_product_deletion

    await erase_export_epochs_after_product_deletion(db, owner)
    from app.domains.workouts.imports import workout_import_worker

    workout_import_worker.cancel_owner(membership.app_user_id)
    from app.domains.workouts.export_job_worker import export_job_worker

    export_job_worker.cancel_owner(membership.app_user_id)
    return membership


def external_cleanup_targets(app_user_id: str) -> tuple[str, ...]:
    """No external Workouts media exists yet; never return a broad storage prefix.

    Future media must register exact owned objects and durable cleanup intent in
    the same deletion transaction, both here and in whole-Håfa-account deletion.
    """
    del app_user_id
    return ()

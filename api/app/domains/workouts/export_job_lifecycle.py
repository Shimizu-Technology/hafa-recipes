"""Owner-held privacy hooks do not acquire or clear the global memory slot."""

from sqlalchemy import delete, func, update

from app.domains.workouts.export_job_models import WorkoutsExportJob
from app.domains.workouts.lifecycle import optional_table_exists


async def invalidate_export_jobs(db, owner, generation):
    if not await optional_table_exists(db, "workouts_export_jobs"):
        return
    await db.execute(
        update(WorkoutsExportJob)
        .where(
            WorkoutsExportJob.app_user_id == owner,
            WorkoutsExportJob.generation == generation,
            WorkoutsExportJob.status.in_(["queued", "running", "cancel_requested", "ready"]),
        )
        .values(
            status="failed",
            failure_code="privacy_changed",
            manifest=None,
            finished_at=func.coalesce(WorkoutsExportJob.finished_at, func.clock_timestamp()),
        )
    )
    from app.domains.workouts.export_job_worker import cancel_local_owner

    cancel_local_owner(db, owner)
    # The existing epoch/snapshot hook removes ciphertext in this same owner
    # transaction. Maintenance later releases only never-started slots or proof.


async def erase_export_jobs(db, owner):
    if await optional_table_exists(db, "workouts_export_jobs"):
        await db.execute(delete(WorkoutsExportJob).where(WorkoutsExportJob.app_user_id == owner))
        from app.domains.workouts.export_job_worker import cancel_local_owner

        cancel_local_owner(db, owner)

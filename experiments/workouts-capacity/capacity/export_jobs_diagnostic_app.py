"""Strict synthetic async-export probe; absent from production entry points."""

import os

from capacity.safety import OWNERS, ensure

ensure()
FLAGS = {
    "CAPACITY_EXPORT_JOBS_DIAGNOSTIC": "true",
    "CAPACITY_EXPORT_DIAGNOSTIC": "false",
    "WORKOUTS_EXPORT_JOBS_ENABLED": "true",
    "WORKOUTS_API_ENABLED": "true",
    "JOB_WORKER_ENABLED": "true",
    "WORKOUTS_IMPORTS_ENABLED": "false",
    "DELETION_CLEANUP_WORKER_ENABLED": "false",
    "CAPACITY_COVER_SCENARIOS": "false",
    "CAPACITY_PHASE": "diagnostic",
}
if any(os.environ.get(key) != value for key, value in FLAGS.items()):
    raise RuntimeError("Strict isolated background diagnostic configuration required")

from app.db.database import AsyncSessionLocal
from app.domains.workouts.export_job_models import (
    WorkoutsExportJob,
    WorkoutsExportJobRecovery,
    WorkoutsExportJobSlot,
)
from app.domains.workouts.export_job_worker import (
    _running,
    engine_key,
    export_job_worker,
)
from app.domains.workouts.export_models import (
    WorkoutsExportPage,
    WorkoutsExportSnapshot,
)
from fastapi import Depends, HTTPException
from sqlalchemy import func, select

from capacity.app import app, identity
from capacity.export_diagnostic_instrument import install, snapshot
from capacity.export_jobs_diagnostic_contract import STATUS_CODES

# The real worker owns a separately constructed normal builder. Class-level
# wrappers cover it; no singleton page-source replacement is needed here.
install(wrap_singleton=False)


async def job_checks(sessions=AsyncSessionLocal, worker=export_job_worker):
    async with sessions() as db:
        rows = (
            await db.scalars(
                select(WorkoutsExportJob).where(
                    WorkoutsExportJob.app_user_id == OWNERS[22],
                    WorkoutsExportJob.generation == 1,
                    WorkoutsExportJob.kind == "async",
                )
            )
        ).all()
        slots = (await db.scalars(select(WorkoutsExportJobSlot))).all()
        row = rows[0] if len(rows) == 1 else None
        ack = (
            (
                await db.scalars(
                    select(WorkoutsExportJobRecovery).where(
                        WorkoutsExportJobRecovery.job_id == row.id,
                        WorkoutsExportJobRecovery.reason == "actual_end",
                    )
                )
            ).all()
            if row is not None
            else []
        )
        # The isolated fixture admits exactly one job. Global artifact counts
        # catch an unexpected second owner/build instead of hiding its leftovers.
        snapshot_count = await db.scalar(
            select(func.count()).select_from(WorkoutsExportSnapshot)
        )
        page_count = await db.scalar(
            select(func.count()).select_from(WorkoutsExportPage)
        )
        registry = sum(
            engine == engine_key(worker.coordinator) for engine, _ in _running
        )
        # A post-commit ACK tuple is content-free. It is counted separately for
        # final drain; it does not mean source JSON/task frames are still alive.
        retired = (
            registry == 0
            and worker.active_task is None
            and worker.active_execution is None
            and worker.heartbeat_task is None
            and worker.retirement_task is None
        )
        idle = len(slots) == 1 and slots[0].active_job_id is None
        return {
            "job_count": len(rows),
            "status_code": STATUS_CODES.get(row.status, 0) if row else 0,
            "slot_rows": len(slots),
            "active_slot_count": sum(slot.active_job_id is not None for slot in slots),
            "actual_end_ack_count": len(ack),
            "ack_completion_ms": (ack[0].released_at - row.admitted_at).total_seconds()
            * 1000
            if len(ack) == 1 and row
            else None,
            "deadline_window_ms": (row.deadline_at - row.admitted_at).total_seconds()
            * 1000
            if row
            else None,
            "expiry_window_ms": (row.expires_at - row.admitted_at).total_seconds()
            * 1000
            if row
            else None,
            "snapshot_count": snapshot_count,
            "page_count": page_count,
            "running_registry_count": registry,
            "worker_active_task_count": int(worker.active_task is not None),
            "worker_active_execution_count": int(worker.active_execution is not None),
            "worker_pending_ack_count": int(worker.pending_ack is not None),
            "worker_heartbeat_task_count": int(worker.heartbeat_task is not None),
            "worker_retirement_task_count": int(worker.retirement_task is not None),
            "source_frames_retired": retired,
            "global_slot_idle": idle,
        }


@app.get("/capacity/export-jobs-diagnostic")
async def measurements(user=Depends(identity)):  # noqa: B008
    if user.id != OWNERS[22]:
        raise HTTPException(403, "Diagnostic fixture identity required")
    value = dict(snapshot() or {})
    value["job_checks"] = await job_checks()
    return value

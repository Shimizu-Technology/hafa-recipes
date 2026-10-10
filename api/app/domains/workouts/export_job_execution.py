"""Trusted internal execution identity; never accepted from a request body."""

import hmac
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, select

from app.domains.workouts.export_job_models import WorkoutsExportJob, WorkoutsExportJobSlot


@dataclass(frozen=True)
class ExportJobExecution:
    job_id: UUID
    owner: str
    generation: int
    snapshot_id: UUID
    lease_token: UUID
    worker_instance: UUID
    deadline_at: datetime
    expires_at: datetime
    permission_digest: bytes


@dataclass
class LegacyAdmissionCapsule:
    """Internal caller's exact nonce and proof that no source task was created.

    Never parsed from HTTP. Admission attaches execution synchronously before
    commit can lose its ACK; only the owning compatibility call marks creation.
    """

    owner: str
    generation: int
    request_id: UUID
    nonce: UUID = field(default_factory=uuid4)
    execution: ExportJobExecution | None = None
    source_created: bool = False


async def require_execution(db, execution, owner, generation):
    """Caller already holds owner lock. Never acquire the global slot here."""
    if execution.owner != owner or execution.generation != generation:
        raise HTTPException(410, "export_job_privacy_changed")
    row = await db.scalar(
        select(WorkoutsExportJob).where(WorkoutsExportJob.id == execution.job_id).with_for_update()
    )
    slot = await db.get(WorkoutsExportJobSlot, 1, populate_existing=True)
    clock = await db.scalar(select(func.clock_timestamp()))
    if (
        row is None
        or slot is None
        or row.app_user_id != owner
        or row.generation != generation
        or row.snapshot_id != execution.snapshot_id
        or row.worker_instance != execution.worker_instance
        or row.lease_token != execution.lease_token
        or slot.active_job_id != execution.job_id
        or slot.snapshot_id != execution.snapshot_id
        or slot.worker_instance != execution.worker_instance
        or slot.lease_token != execution.lease_token
        or slot.started_at != row.started_at
        or row.deadline_at != execution.deadline_at
        or row.expires_at != execution.expires_at
        or not hmac.compare_digest(row.permission_digest, execution.permission_digest)
    ):
        raise HTTPException(410, "export_job_interrupted")
    if row.deadline_at <= clock or execution.deadline_at <= clock:
        raise HTTPException(410, "export_job_deadline_exceeded")
    if row.status != "running":
        raise HTTPException(410, "export_job_stopped")
    if (
        row.leased_until is None
        or row.leased_until <= clock
        or slot.leased_until is None
        or slot.leased_until <= clock
    ):
        raise HTTPException(410, "export_job_interrupted")
    return row


async def require_job_snapshot_ready(db, snapshot):
    row = await db.scalar(
        select(WorkoutsExportJob).where(
            WorkoutsExportJob.snapshot_id == snapshot.id,
            WorkoutsExportJob.app_user_id == snapshot.app_user_id,
            WorkoutsExportJob.generation == snapshot.generation,
        )
    )
    if row is None:
        return  # Pre045 compatibility snapshots have no durable job receipt.
    slot = await db.get(WorkoutsExportJobSlot, 1)
    if row.status != "ready":
        raise HTTPException(410, "export_snapshot_unavailable")
    if slot is not None and slot.active_job_id == row.id:
        raise HTTPException(409, "export_snapshot_not_ready")

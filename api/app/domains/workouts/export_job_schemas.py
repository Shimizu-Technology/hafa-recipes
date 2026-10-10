"""Content-free async-export receipts. No guessed progress or exception text."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from app.domains.workouts.export_service import ExportManifest
from app.domains.workouts.schemas import DomainModel

JobStatus = Literal[
    "queued", "running", "cancel_requested", "ready", "cancelled", "failed", "expired"
]
JobFailure = Literal[
    "interrupted", "privacy_changed", "deadline_exceeded", "too_large", "export_failed"
]


class ExportJobRequest(DomainModel):
    request_id: UUID


class ExportJobReceipt(DomainModel):
    schema_version: Literal[1] = 1
    id: UUID
    request_id: UUID
    generation: int
    status: JobStatus
    admitted_at: datetime
    deadline_at: datetime
    expires_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    failure_code: JobFailure | None
    cleanup_pending: bool
    manifest: ExportManifest | None

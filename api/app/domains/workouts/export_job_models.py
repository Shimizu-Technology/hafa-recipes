"""Durable, owner-fenced receipts and a non-cascading global execution permit."""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.domains.workouts.models import Base, owner_column

JOB_STATES = "'queued','running','cancel_requested','ready','cancelled','failed','expired'"
FAILURE_CODES = "'interrupted','privacy_changed','deadline_exceeded','too_large','export_failed'"


class WorkoutsExportJob(Base):
    __tablename__ = "workouts_export_jobs"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    kind = Column(String(12), nullable=False)
    snapshot_id = Column(UUID(as_uuid=True), nullable=False)
    status = Column(String(20), nullable=False)
    permission_digest = Column(LargeBinary, nullable=False)
    admitted_at = Column(DateTime(timezone=True), nullable=False)
    deadline_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True))
    finished_at = Column(DateTime(timezone=True))
    worker_instance = Column(UUID(as_uuid=True))
    worker_identity = Column(JSONB(none_as_null=True))
    lease_token = Column(UUID(as_uuid=True))
    leased_until = Column(DateTime(timezone=True))
    failure_code = Column(String(24))
    manifest = Column(JSONB(none_as_null=True))
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "request_id", name="uq_workouts_export_job_request"
        ),
        UniqueConstraint("snapshot_id", name="uq_workouts_export_job_snapshot"),
        CheckConstraint("generation > 0", name="ck_workouts_export_job_generation"),
        CheckConstraint("kind IN ('async','legacy')", name="ck_workouts_export_job_kind"),
        CheckConstraint(f"status IN ({JOB_STATES})", name="ck_workouts_export_job_status"),
        CheckConstraint(
            f"failure_code IS NULL OR failure_code IN ({FAILURE_CODES})",
            name="ck_workouts_export_job_failure",
        ),
        CheckConstraint("octet_length(permission_digest)=32", name="ck_workouts_export_job_digest"),
        CheckConstraint(
            "deadline_at=admitted_at+INTERVAL '120 seconds' AND expires_at=admitted_at+INTERVAL '600 seconds'",
            name="ck_workouts_export_job_deadlines",
        ),
        CheckConstraint(
            "started_at IS NULL OR started_at>=admitted_at", name="ck_workouts_export_job_started"
        ),
        CheckConstraint(
            "leased_until IS NULL OR leased_until<=deadline_at", name="ck_workouts_export_job_lease"
        ),
        CheckConstraint(
            "manifest IS NULL OR (jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=16384)",
            name="ck_workouts_export_job_manifest",
        ),
        CheckConstraint(
            "worker_identity IS NULL OR (jsonb_typeof(worker_identity)='object' AND octet_length(worker_identity::text)<=2048)",
            name="ck_workouts_export_job_identity",
        ),
        CheckConstraint(
            "started_at IS NULL OR (worker_instance IS NOT NULL AND worker_identity IS NOT NULL AND lease_token IS NOT NULL)",
            name="ck_workouts_export_job_execution",
        ),
    )


class WorkoutsExportJobSlot(Base):
    __tablename__ = "workouts_export_job_slot"
    slot = Column(Integer, primary_key=True)
    # Deliberately no job/owner FK. Cascade cannot release an executing source.
    active_job_id = Column(UUID(as_uuid=True))
    snapshot_id = Column(UUID(as_uuid=True))
    admitted_at = Column(DateTime(timezone=True))
    deadline_at = Column(DateTime(timezone=True))
    started_at = Column(DateTime(timezone=True))
    worker_instance = Column(UUID(as_uuid=True))
    worker_identity = Column(JSONB(none_as_null=True))
    lease_token = Column(UUID(as_uuid=True))
    leased_until = Column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("slot=1", name="ck_workouts_export_job_singleton"),
        CheckConstraint(
            "active_job_id IS NULL OR (snapshot_id IS NOT NULL AND admitted_at IS NOT NULL AND deadline_at IS NOT NULL)",
            name="ck_workouts_export_slot_admission",
        ),
        CheckConstraint(
            "started_at IS NULL OR (worker_instance IS NOT NULL AND worker_identity IS NOT NULL AND lease_token IS NOT NULL)",
            name="ck_workouts_export_slot_execution",
        ),
        CheckConstraint(
            "leased_until IS NULL OR leased_until<=deadline_at",
            name="ck_workouts_export_slot_lease",
        ),
        CheckConstraint(
            "worker_identity IS NULL OR (jsonb_typeof(worker_identity)='object' AND octet_length(worker_identity::text)<=2048)",
            name="ck_workouts_export_slot_identity",
        ),
    )


class WorkoutsExportJobRecovery(Base):
    __tablename__ = "workouts_export_job_recovery"
    id = Column(UUID(as_uuid=True), primary_key=True)
    job_id = Column(UUID(as_uuid=True), nullable=False)
    worker_instance = Column(UUID(as_uuid=True))
    released_at = Column(DateTime(timezone=True), nullable=False, index=True)
    reason = Column(String(32), nullable=False)
    evidence_digest = Column(String(64), nullable=False)
    __table_args__ = (
        CheckConstraint(
            "reason IN ('never_started','actual_end','same_namespace_dead','verified_operator')",
            name="ck_workouts_export_recovery_reason",
        ),
        CheckConstraint("length(evidence_digest)=64", name="ck_workouts_export_recovery_digest"),
    )


EXPORT_JOB_TABLES = (
    WorkoutsExportJob.__table__,
    WorkoutsExportJobSlot.__table__,
    WorkoutsExportJobRecovery.__table__,
)

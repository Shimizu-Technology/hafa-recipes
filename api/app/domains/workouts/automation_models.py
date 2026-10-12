"""Private job and proposal state, independently migrated after account data."""

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class WorkoutImport(Base):
    __tablename__ = "workouts_import_jobs"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(24), nullable=False, default="queued")
    payload = Column(JSONB)
    result = Column(JSONB)
    accepted_workout_id = Column(UUID(as_uuid=True))
    accepted_content_hash = Column(String(64))
    ai_accepted_at = Column(DateTime(timezone=True), nullable=False)
    attempt_count = Column(Integer, nullable=False, default=0)
    lease_token = Column(String(64))
    leased_until = Column(DateTime(timezone=True))
    next_attempt_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "request_id", name="uq_workouts_import_request"
        ),
        CheckConstraint(
            "status IN ('queued','processing','ready','incomplete','failed','cancelled','expired')",
            name="ck_workouts_import_status",
        ),
        CheckConstraint("generation>0 AND attempt_count>=0", name="ck_workouts_import_generation"),
    )


class WorkoutProposal(Base):
    __tablename__ = "workouts_proposals"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    kind = Column(String(24), nullable=False)
    profile_revision = Column(Integer, nullable=False)
    context_hash = Column(String(64), nullable=False)
    source_versions = Column(JSONB, nullable=False, default=list)
    target_id = Column(UUID(as_uuid=True))
    target_revision = Column(Integer)
    content = Column(JSONB, nullable=False)
    accepted_record_id = Column(UUID(as_uuid=True))
    accepted_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint(
            "kind IN ('program','adaptation','schedule','progression','profile')",
            name="ck_workouts_proposal_kind",
        ),
        CheckConstraint(
            "generation>0 AND profile_revision>=0", name="ck_workouts_proposal_generation"
        ),
    )


class WorkoutReadiness(Base):
    __tablename__ = "workouts_readiness"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, nullable=False)
    state = Column(String(24), nullable=False)
    confirmed_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        CheckConstraint(
            "state IN ('ready','limited','unknown')", name="ck_workouts_readiness_state"
        ),
        CheckConstraint("generation>0", name="ck_workouts_readiness_generation"),
    )


class WorkoutCoachMessage(Base):
    __tablename__ = "workouts_coach_messages"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_hash = Column(String(64), nullable=False)
    user_message = Column(String(4000), nullable=False)
    assistant_message = Column(String(12000), nullable=False)
    proposals = Column(JSONB, nullable=False)
    used_health_context = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "request_id", name="uq_workouts_coach_request"
        ),
        CheckConstraint("generation>0", name="ck_workouts_coach_generation"),
    )


AUTOMATION_TABLES = tuple(
    model.__table__
    for model in (WorkoutImport, WorkoutProposal, WorkoutReadiness, WorkoutCoachMessage)
)

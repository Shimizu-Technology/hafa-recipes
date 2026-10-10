"""Private, generation-fenced Workouts records; all owners are application IDs."""

import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

from app.models.identity import AppUser

# Optional domain tables must not enter Recipes' Base.metadata/create_all paths.
# Copy only FK target metadata; migration creation explicitly selects Workouts
# tables and never creates or alters the shared AppUser table.
Base = declarative_base()
AppUser.__table__.to_metadata(Base.metadata)


def owner_column(*, primary_key=False):
    return Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=not primary_key,
        primary_key=primary_key,
    )


class WorkoutsMembership(Base):
    __tablename__ = "workouts_memberships"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, nullable=False, default=1)
    status = Column(String(16), nullable=False, default="active")
    disclosure_version = Column(Integer, nullable=False)
    adult_confirmed_at = Column(DateTime(timezone=True), nullable=False)
    deletion_acknowledged_at = Column(DateTime(timezone=True), nullable=False)
    enrolled_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    deleted_at = Column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("generation > 0", name="ck_workouts_membership_generation"),
        CheckConstraint("status IN ('active','deleted')", name="ck_workouts_membership_status"),
        CheckConstraint("disclosure_version = 1", name="ck_workouts_membership_disclosure"),
    )


class WorkoutsProfile(Base):
    __tablename__ = "workouts_profiles"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    content = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (CheckConstraint("revision > 0", name="ck_workouts_profile_revision"),)


class WorkoutRecord(Base):
    __tablename__ = "workouts_library"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    creation_request_id = Column(UUID(as_uuid=True))
    creation_request_hash = Column(String(64))
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_workouts_library_revision"),
        UniqueConstraint(
            "app_user_id", "generation", "creation_request_id", name="uq_workouts_library_creation"
        ),
    )


class WorkoutVersion(Base):
    __tablename__ = "workouts_library_versions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    workout_id = Column(
        UUID(as_uuid=True), ForeignKey("workouts_library.id", ondelete="CASCADE"), nullable=False
    )
    revision = Column(Integer, nullable=False)
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("workout_id", "revision", name="uq_workouts_library_version"),
    )


class WorkoutsProgram(Base):
    __tablename__ = "workouts_programs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    creation_request_id = Column(UUID(as_uuid=True))
    creation_request_hash = Column(String(64))
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_workouts_program_revision"),
        UniqueConstraint(
            "app_user_id", "generation", "creation_request_id", name="uq_workouts_program_creation"
        ),
    )


class WorkoutsProgramVersion(Base):
    __tablename__ = "workouts_program_versions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    program_id = Column(
        UUID(as_uuid=True), ForeignKey("workouts_programs.id", ondelete="CASCADE"), nullable=False
    )
    revision = Column(Integer, nullable=False)
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("program_id", "revision", name="uq_workouts_program_version"),
    )


class WorkoutsSession(Base):
    __tablename__ = "workouts_sessions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    client_session_id = Column(UUID(as_uuid=True), nullable=False)
    request_hash = Column(String(64), nullable=False)
    # References are historical identifiers, not cascading live prescriptions.
    # Only owner-validated server snapshots are stored; later edits cannot alter them.
    source_workout_id = Column(UUID(as_uuid=True))
    source_program_id = Column(UUID(as_uuid=True))
    supersedes_session_id = Column(UUID(as_uuid=True))
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "client_session_id", name="uq_workouts_client_session"
        ),
        UniqueConstraint("supersedes_session_id", name="uq_workouts_session_correction"),
    )


class WorkoutsConsent(Base):
    __tablename__ = "workouts_ai_consents"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, nullable=False)
    disclosure_version = Column(Integer, nullable=False)
    accepted_at = Column(DateTime(timezone=True))
    __table_args__ = (CheckConstraint("disclosure_version = 1", name="ck_workouts_ai_disclosure"),)


class WorkoutsGrant(Base):
    __tablename__ = "workouts_grants"
    app_user_id = owner_column(primary_key=True)
    scope = Column(String(64), primary_key=True)
    generation = Column(Integer, nullable=False)
    granted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint(
            "scope IN ('recipes_library_context','recipes_meal_plan_context','health_activity_read','health_activity_write','health_body_measurements_read','ai_health_context')",
            name="ck_workouts_grant_scope",
        ),
    )


class WorkoutsActivity(Base):
    __tablename__ = "workouts_activities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


WORKOUTS_TABLES = (
    WorkoutsMembership.__table__,
    WorkoutsProfile.__table__,
    WorkoutRecord.__table__,
    WorkoutVersion.__table__,
    WorkoutsProgram.__table__,
    WorkoutsProgramVersion.__table__,
    WorkoutsSession.__table__,
    WorkoutsConsent.__table__,
    WorkoutsGrant.__table__,
    WorkoutsActivity.__table__,
)

for table in WORKOUTS_TABLES:
    if table.name != "workouts_memberships":
        table.append_constraint(
            CheckConstraint("generation > 0", name=f"ck_{table.name}_generation")
        )
    if table.name in {"workouts_library_versions", "workouts_program_versions"}:
        table.append_constraint(CheckConstraint("revision > 0", name=f"ck_{table.name}_revision"))

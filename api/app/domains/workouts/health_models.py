"""Optional health tables: private ownership and separate consent revisions."""

import uuid

from sqlalchemy import (
    Boolean,
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

from app.domains.workouts.models import WorkoutsActivity, WorkoutsSession
from app.models.identity import AppUser

HealthBase = declarative_base()
for target in (AppUser.__table__, WorkoutsActivity.__table__, WorkoutsSession.__table__):
    target.to_metadata(HealthBase.metadata)


def owner():
    return Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True
    )


class HealthConnection(HealthBase):
    __tablename__ = "workouts_health_connections"
    app_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True
    )
    provider = Column(String(24), primary_key=True)
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    connected = Column(Boolean, nullable=False, default=False)
    read_on_device = Column(Boolean, nullable=False, default=False)
    upload_to_server = Column(Boolean, nullable=False, default=False)
    use_for_ai = Column(Boolean, nullable=False, default=False)
    write_actuals = Column(Boolean, nullable=False, default=False)
    disclosure_version = Column(Integer, nullable=False, default=1)
    cursor = Column(JSONB)
    last_sync_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("generation > 0 AND revision > 0", name="ck_health_connection_versions"),
        CheckConstraint(
            "provider IN ('apple_health','health_connect')", name="ck_health_connection_provider"
        ),
        CheckConstraint("disclosure_version=1", name="ck_health_connection_disclosure"),
        CheckConstraint(
            "NOT upload_to_server OR (connected AND read_on_device)",
            name="ck_health_upload_consent",
        ),
        CheckConstraint("NOT use_for_ai OR upload_to_server", name="ck_health_ai_consent"),
        CheckConstraint("NOT write_actuals OR connected", name="ck_health_write_consent"),
    )


class HealthObservation(HealthBase):
    __tablename__ = "workouts_health_observations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    provider = Column(String(24), nullable=False)
    source_id = Column(String(224), nullable=False)
    origin_id = Column(String(200), nullable=False)
    source_updated_at = Column(DateTime(timezone=True))
    content = Column(JSONB, nullable=False)
    content_hash = Column(String(64), nullable=False)
    activity_id = Column(
        UUID(as_uuid=True), ForeignKey("workouts_activities.id", ondelete="SET NULL")
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id",
            "generation",
            "provider",
            "source_id",
            name="uq_health_observation_source",
        ),
        CheckConstraint("generation > 0", name="ck_health_observation_generation"),
        CheckConstraint(
            "provider IN ('apple_health','health_connect')", name="ck_health_observation_provider"
        ),
    )


class HealthSyncReceipt(HealthBase):
    __tablename__ = "workouts_health_sync_receipts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    provider = Column(String(24), nullable=False)
    receipt_id = Column(UUID(as_uuid=True), nullable=False)
    connection_revision = Column(Integer, nullable=False)
    request_hash = Column(String(64), nullable=False)
    response = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint(
            "generation > 0 AND connection_revision > 0", name="ck_health_receipt_versions"
        ),
        CheckConstraint(
            "provider IN ('apple_health','health_connect')", name="ck_health_receipt_provider"
        ),
        UniqueConstraint(
            "app_user_id", "generation", "provider", "receipt_id", name="uq_health_sync_receipt"
        ),
    )


class HealthExportIntent(HealthBase):
    __tablename__ = "workouts_health_export_intents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    provider = Column(String(24), nullable=False)
    connection_revision = Column(Integer, nullable=False)
    session_id = Column(
        UUID(as_uuid=True), ForeignKey("workouts_sessions.id", ondelete="CASCADE"), nullable=False
    )
    canonical_session_id = Column(String(100), nullable=False)
    session_revision = Column(Integer, nullable=False)
    actual = Column(JSONB, nullable=False)
    status = Column(String(24), nullable=False, default="prepared")
    source_id = Column(String(224))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint(
            "generation > 0 AND connection_revision > 0 AND session_revision > 0",
            name="ck_health_export_versions",
        ),
        CheckConstraint(
            "provider IN ('apple_health','health_connect')", name="ck_health_export_provider"
        ),
        UniqueConstraint(
            "app_user_id",
            "generation",
            "provider",
            "session_id",
            "connection_revision",
            name="uq_health_export_intent",
        ),
        CheckConstraint(
            "status IN ('prepared','reported_written','reported_unsupported')",
            name="ck_health_export_status",
        ),
    )


HEALTH_TABLES = (
    HealthConnection.__table__,
    HealthObservation.__table__,
    HealthSyncReceipt.__table__,
    HealthExportIntent.__table__,
)

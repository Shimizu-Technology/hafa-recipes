"""Manual completed-activity metadata and immutable retry receipts."""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class WorkoutsActivityLog(Base):
    __tablename__ = "workouts_activity_log"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    activity_id = Column(
        UUID(as_uuid=True), ForeignKey("workouts_activities.id", ondelete="CASCADE"), unique=True
    )
    revision = Column(Integer, nullable=False, default=1)
    status = Column(String(16), nullable=False, default="active")
    content = Column(JSONB(none_as_null=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("id", "app_user_id", "generation", name="uq_workouts_activity_log_owner"),
        CheckConstraint("generation>0 AND revision>0", name="ck_workouts_activity_log_revision"),
        CheckConstraint(
            "(status='active' AND activity_id=id AND content IS NOT NULL) OR (status='removed' AND activity_id IS NULL AND content IS NULL)",
            name="ck_workouts_activity_log_status",
        ),
    )


class WorkoutsActivityLogOperation(Base):
    __tablename__ = "workouts_activity_log_operations"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, primary_key=True)
    request_id = Column(UUID(as_uuid=True), primary_key=True)
    request_hash = Column(String(64), nullable=False)
    action = Column(String(16), nullable=False)
    activity_id = Column(UUID(as_uuid=True), nullable=False)
    after_revision = Column(Integer, nullable=False)
    after_profile_revision = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(
            ["activity_id", "app_user_id", "generation"],
            [
                "workouts_activity_log.id",
                "workouts_activity_log.app_user_id",
                "workouts_activity_log.generation",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "generation>0 AND after_revision>0 AND after_profile_revision>=0 AND action IN ('create','correct','remove')",
            name="ck_workouts_activity_log_operation",
        ),
    )


ACTIVITY_LOG_TABLES = (WorkoutsActivityLog.__table__, WorkoutsActivityLogOperation.__table__)

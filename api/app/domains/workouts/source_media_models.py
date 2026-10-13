"""Owned public-link previews; pending writes retain a durable cleanup receipt."""

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column
from app.models.deletion import DeletionCleanupJob

DeletionCleanupJob.__table__.to_metadata(Base.metadata)


class WorkoutSourceMedia(Base):
    __tablename__ = "workouts_source_media"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=False)
    purpose = Column(String(16), nullable=False)
    canonical_url = Column(String(2000))
    retained = Column(Boolean, nullable=False, default=False, server_default="false")
    cleanup_job_id = Column(
        UUID(as_uuid=True), ForeignKey("deletion_cleanup_jobs.id", ondelete="SET NULL")
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint(
            "generation>0 AND purpose IN ('import','copy')", name="ck_workouts_source_media_owner"
        ),
    )

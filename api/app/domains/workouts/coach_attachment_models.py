"""Private upload receipts, never public workout or source-thumbnail content."""

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column
from app.models.deletion import DeletionCleanupJob

DeletionCleanupJob.__table__.to_metadata(Base.metadata)


class CoachAttachment(Base):
    __tablename__ = "workouts_coach_attachments"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    upload_id = Column(UUID(as_uuid=True), nullable=False)
    byte_hash = Column(String(64), nullable=False)
    state = Column(String(16), nullable=False, default="pending")
    consent_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    cleanup_job_id = Column(UUID(as_uuid=True), ForeignKey("deletion_cleanup_jobs.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("generation>0 AND state IN ('pending','ready','deleted') AND (state='deleted' OR consent_at IS NOT NULL)", name="ck_coach_attachment_state"),
    )

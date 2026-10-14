"""Optional, product-scoped capabilities for the native Workouts share extension."""

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.domains.workouts.models import Base, owner_column


class WorkoutShareCredential(Base):
    __tablename__ = "workouts_share_credentials"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    installation_hash = Column(String(64), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    is_public = Column(Boolean, nullable=False, default=False)
    display_name = Column(String(100), nullable=False)
    ai_accepted_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "installation_hash", name="uq_workouts_share_installation"
        ),
        CheckConstraint("generation>0", name="ck_workouts_share_generation"),
    )

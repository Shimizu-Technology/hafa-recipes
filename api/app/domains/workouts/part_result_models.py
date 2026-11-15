"""Optional derived score index. Immutable session JSONB remains authoritative."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import UUID

from app.domains.workouts.models import Base, owner_column


class PartResultRow(Base):
    __tablename__ = "workouts_part_results"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("workouts_sessions.id", ondelete="CASCADE"), nullable=False)
    block_id = Column(String(100), nullable=False)
    block_label = Column(String(200), nullable=False)
    comparison_key = Column(String(200), nullable=False)
    benchmark_key = Column(String(60))
    source_workout_id = Column(UUID(as_uuid=True))
    kind = Column(String(16), nullable=False)
    scaling = Column(String(8))
    sort_value = Column(Float, nullable=False)
    better = Column(String(6), nullable=False)
    performed_at = Column(DateTime(timezone=True), nullable=False)
    superseded = Column(Boolean, nullable=False, server_default=false())
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("session_id", "block_id", name="uq_workouts_part_result"),
        CheckConstraint("generation>0 AND better IN ('higher','lower')", name="ck_workouts_part_result"),
        Index("ix_workouts_result_comparison", "app_user_id", "generation", "comparison_key", "performed_at"),
        Index("ix_workouts_result_workout", "app_user_id", "generation", "source_workout_id", "performed_at"),
    )

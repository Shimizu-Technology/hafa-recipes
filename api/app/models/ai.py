"""Privacy-bounded AI invocation provenance and usage records."""

import uuid

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.database import Base


class AIInvocation(Base):
    """One provider attempt without prompts, responses, URLs, or recipe content."""

    __tablename__ = "ai_invocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(String(64), nullable=False)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=True,
    )
    job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("extraction_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    capability = Column(String(32), nullable=False)
    provider = Column(String(24), nullable=False, default="openai")
    model = Column(String(96), nullable=False)
    prompt_version = Column(String(64), nullable=False)
    schema_version = Column(String(64), nullable=True)
    rollout_variant = Column(String(24), nullable=False, default="primary")
    fallback_reason = Column(String(64), nullable=True)
    status = Column(String(32), nullable=False)
    error_code = Column(String(64), nullable=True)
    provider_request_id = Column(String(128), nullable=True)
    latency_ms = Column(Integer, nullable=False)
    input_tokens = Column(Integer, nullable=True)
    cached_input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    reasoning_tokens = Column(Integer, nullable=True)
    estimated_cost_microusd = Column(BigInteger, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_ai_invocations_request_id", "request_id"),
        Index("ix_ai_invocations_created_at", "created_at"),
        Index("ix_ai_invocations_capability_created_at", "capability", "created_at"),
        Index("ix_ai_invocations_model_created_at", "model", "created_at"),
        Index("ix_ai_invocations_status_created_at", "status", "created_at"),
        Index(
            "ix_ai_invocations_user_id",
            "user_id",
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "ix_ai_invocations_job_id",
            "job_id",
            postgresql_where=text("job_id IS NOT NULL"),
        ),
    )

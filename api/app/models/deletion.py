"""Durable external cleanup and authentication tombstones for deletions."""

import uuid

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.db.database import Base


class DeletionCleanupJob(Base):
    """Persist external work that must outlive the request deleting local data."""

    __tablename__ = "deletion_cleanup_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind = Column(String(16), nullable=False)
    app_user_id = Column(String(64), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="queued", server_default="queued")
    clerk_identities = Column(JSONB, nullable=False, default=list, server_default="[]")
    storage_prefixes = Column(JSONB, nullable=False, default=list, server_default="[]")
    clerk_target_count = Column(Integer, nullable=False, default=0, server_default="0")
    storage_prefix_count = Column(Integer, nullable=False, default=0, server_default="0")
    attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    max_attempts = Column(Integer, nullable=False, default=20, server_default="20")
    next_attempt_at = Column(DateTime(timezone=True), nullable=True)
    lease_token = Column(String(64), nullable=True)
    leased_until = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index(
            "uq_deletion_cleanup_account_user",
            "app_user_id",
            unique=True,
            postgresql_where=text("kind = 'account'"),
        ),
    )


class DeletedAuthIdentity(Base):
    """Hash-only tombstone preventing a deleted Clerk subject from re-adopting data."""

    __tablename__ = "deleted_auth_identities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deletion_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("deletion_cleanup_jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    issuer = Column(String(512), nullable=False)
    clerk_user_id_hash = Column(String(64), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "issuer",
            "clerk_user_id_hash",
            name="uq_deleted_auth_identity_subject",
        ),
    )

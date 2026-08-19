"""User safety and administrator moderation records."""

import uuid

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.db.database import Base


class ContentReport(Base):
    """A user-submitted report with a durable, reversible review workflow."""

    __tablename__ = "content_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_type = Column(String(16), nullable=False)
    recipe_id = Column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    category = Column(String(24), nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="open", server_default="open", index=True)
    resolution_note = Column(Text, nullable=True)
    reviewed_by = Column(String(64), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "target_type IN ('recipe', 'contributor')",
            name="ck_content_reports_target_type",
        ),
        CheckConstraint(
            "(target_type = 'recipe' AND target_user_id IS NULL) "
            "OR (target_type = 'contributor' AND recipe_id IS NULL)",
            name="ck_content_reports_target",
        ),
        CheckConstraint(
            "category IN ('spam', 'unsafe', 'inappropriate', 'copyright', 'impersonation', 'other', 'appeal')",
            name="ck_content_reports_category",
        ),
        CheckConstraint(
            "status IN ('open', 'reviewing', 'resolved', 'dismissed')",
            name="ck_content_reports_status",
        ),
    )


class UserBlock(Base):
    """A private, user-controlled contributor block."""

    __tablename__ = "user_blocks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blocker_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    blocked_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("blocker_user_id", "blocked_user_id", name="uq_user_blocks_pair"),
        CheckConstraint("blocker_user_id <> blocked_user_id", name="ck_user_blocks_not_self"),
    )


class AdminAuditEvent(Base):
    """Append-only, privacy-bounded record of an administrator action."""

    __tablename__ = "admin_audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # This is an immutable actor snapshot, not an ownership relationship. It
    # intentionally has no FK so account cleanup cannot rewrite audit history.
    actor_user_id = Column(String(64), nullable=False, index=True)
    action = Column(String(48), nullable=False, index=True)
    target_type = Column(String(24), nullable=False)
    target_id = Column(String(128), nullable=False, index=True)
    reason = Column(String(500), nullable=False)
    before_summary = Column(JSONB, nullable=False, default=dict, server_default="{}")
    after_summary = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    __table_args__ = (
        CheckConstraint("char_length(reason) BETWEEN 3 AND 500", name="ck_admin_audit_reason"),
    )

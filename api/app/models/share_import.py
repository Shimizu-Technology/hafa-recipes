"""Least-privilege share-extension capability and durable capture receipts."""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class ShareImportCredential(Base):
    __tablename__ = "share_import_credentials"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    installation_hash = Column(String(64), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    scope = Column(String(32), nullable=False, default="recipe:import_link")
    location = Column(String(100), nullable=False, default="Guam")
    is_public = Column(Boolean, nullable=False, default=False)
    display_name = Column(String(200), nullable=False)
    issued_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("app_user_id", "installation_hash", name="uq_share_import_installation"),
        CheckConstraint("scope = 'recipe:import_link'", name="ck_share_import_scope"),
        CheckConstraint("expires_at > issued_at", name="ck_share_import_expiry"),
    )


class ShareImportReceipt(Base):
    __tablename__ = "share_import_receipts"
    app_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True
    )
    capture_id = Column(UUID(as_uuid=True), primary_key=True)
    url = Column(String(2048), nullable=False)
    job_id = Column(UUID(as_uuid=True), nullable=True)
    recipe_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

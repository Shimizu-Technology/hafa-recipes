"""Additive Baby tables. Shared account IDs are the only ownership authority."""

import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

from app.models.deletion import DeletionCleanupJob
from app.models.identity import AppUser

Base = declarative_base()
AppUser.__table__.to_metadata(Base.metadata)
DeletionCleanupJob.__table__.to_metadata(Base.metadata)


def owner():
    return Column(String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)


def identifier():
    return Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class BabyMembership(Base):
    __tablename__ = "baby_memberships"
    app_user_id = owner()
    app_user_id.primary_key = True
    generation = Column(Integer, nullable=False, default=1)
    status = Column(String(16), nullable=False, default="active")
    profile = Column(JSONB, nullable=False, default=dict)
    consent_epoch = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("generation > 0", name="ck_baby_generation"),
        CheckConstraint("status IN ('active','deleted')", name="ck_baby_status"),
    )


class BabyChild(Base):
    __tablename__ = "baby_children"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True))
    name = Column(String(120), nullable=False)
    birth_date = Column(Date)
    due_date = Column(Date)
    creation_hash = Column(String(64), nullable=False)
    __table_args__ = (Index("ix_baby_children_owner", "app_user_id", "generation"),)


class BabyRecord(Base):
    __tablename__ = "baby_records"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    deleted_at = Column(DateTime(timezone=True))
    kind = Column(String(16), nullable=False)
    title = Column(String(240), nullable=False)
    body = Column(Text, nullable=False, default="")
    child_id = Column(UUID(as_uuid=True))
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    data = Column(JSONB, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    creation_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_baby_record_revision"),
        CheckConstraint(
            "kind IN ('source','journal','feeding','sleep','diaper','routine','question','collection')",
            name="ck_baby_record_kind",
        ),
        Index("ix_baby_records_owner", "app_user_id", "generation", "occurred_at"),
        Index("ix_baby_records_child", "app_user_id", "generation", "child_id"),
    )


class BabyAttachment(Base):
    __tablename__ = "baby_attachments"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    name = Column(String(180), nullable=False)
    mime_type = Column(String(100), nullable=False)
    size = Column(Integer, nullable=False)
    object_key = Column(String(240), nullable=False)
    byte_hash = Column(String(64), nullable=False)
    state = Column(String(16), nullable=False, default="pending")
    cleanup_job_id = Column(
        UUID(as_uuid=True), ForeignKey("deletion_cleanup_jobs.id", ondelete="SET NULL")
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_baby_attachments_owner", "app_user_id", "generation"),)


class BabyImport(Base):
    __tablename__ = "baby_imports"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    consent_epoch = Column(Integer, nullable=False)
    creation_hash = Column(String(64), nullable=False)
    request = Column(JSONB, nullable=False)
    status = Column(String(16), nullable=False, default="queued")
    record_id = Column(UUID(as_uuid=True), nullable=False)
    error = Column(String(200))
    attempts = Column(Integer, nullable=False, default=0)
    lease_token = Column(UUID(as_uuid=True))
    lease_until = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','processing','ready','incomplete','failed','cancelled')",
            name="ck_baby_import_status",
        ),
        Index("ix_baby_imports_queue", "status", "lease_until", "created_at"),
        Index("ix_baby_imports_owner", "app_user_id", "generation"),
    )


class BabyConversation(Base):
    __tablename__ = "baby_conversations"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    title = Column(String(240), nullable=False)
    scope = Column(String(16), nullable=False, default="all")
    record_id = Column(UUID(as_uuid=True))
    child_id = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_baby_conversations_owner", "app_user_id", "generation"),)


class BabyMessage(Base):
    __tablename__ = "baby_messages"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    conversation_id = Column(
        UUID(as_uuid=True), ForeignKey("baby_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role = Column(String(16), nullable=False)
    content = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        Index("ix_baby_messages_owner", "app_user_id", "generation", "conversation_id"),
    )


BABY_TABLES = tuple(
    model.__table__
    for model in (
        BabyMembership,
        BabyChild,
        BabyRecord,
        BabyAttachment,
        BabyImport,
        BabyConversation,
        BabyMessage,
    )
)


class BabyAIAdmission(Base):
    """Content-free hard admission reservations survive provider failures/restarts."""

    __tablename__ = "baby_ai_admissions"
    id = identifier()
    # Keep only anonymous cost accounting after account erasure. Deletion must
    # not release money already spent or reserved in the global rolling window.
    app_user_id = Column(String(64), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True)
    generation = Column(Integer, nullable=False)
    capability = Column(String(32), nullable=False)
    reserved_microusd = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("reserved_microusd > 0", name="ck_baby_ai_positive"),
        Index("ix_baby_ai_admissions_created", "created_at", "app_user_id"),
    )


BABY_TABLES = (*BABY_TABLES, BabyAIAdmission.__table__)

"""Baby tables. Owner-based access remains until F4; creator IDs are never rewritten."""

import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
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


def space_column():
    return Column(UUID(as_uuid=True), ForeignKey("baby_spaces.id", ondelete="CASCADE"))


def identifier():
    return Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class BabyMembership(Base):
    __tablename__ = "baby_memberships"
    app_user_id = owner()
    app_user_id.primary_key = True
    personal_space_id = Column(UUID(as_uuid=True), ForeignKey("baby_spaces.id", ondelete="SET NULL"))
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
    space_id = space_column()
    change_seq = Column(BigInteger)
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
    space_id = space_column()
    change_seq = Column(BigInteger)
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
            "kind IN ('source','journal','feeding','sleep','diaper','routine','question','collection',"
            "'event','contraction','kick_session','pumping','medicine','temperature',"
            "'growth','milestone','custom')",
            name="ck_baby_record_kind",
        ),
        Index("ix_baby_records_owner", "app_user_id", "generation", "occurred_at"),
        Index("ix_baby_records_child", "app_user_id", "generation", "child_id"),
    )


class BabyAttachment(Base):
    __tablename__ = "baby_attachments"
    id = identifier()
    app_user_id = owner()
    space_id = space_column()
    change_seq = Column(BigInteger)
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
    space_id = space_column()
    change_seq = Column(BigInteger)
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
    space_id = space_column()
    change_seq = Column(BigInteger)
    context_space_ids = Column(JSONB, nullable=False, default=list, server_default="[]")
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
    space_id = space_column()
    change_seq = Column(BigInteger)
    context_space_ids = Column(JSONB, nullable=False, default=list, server_default="[]")
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


class BabySpace(Base):
    __tablename__ = "baby_spaces"
    id = identifier()
    kind = Column(String(16), nullable=False)
    created_by = Column(String(64), ForeignKey("app_users.id", ondelete="SET NULL"))
    generation = Column(Integer, nullable=False)
    change_seq = Column(BigInteger, nullable=False, default=0)
    timezone = Column(String(80), nullable=False, default="Pacific/Guam")
    status = Column(String(16), nullable=False, default="active")
    __table_args__ = (
        CheckConstraint("kind IN ('personal','family')", name="ck_baby_space_kind"),
        CheckConstraint("status IN ('active','deleted')", name="ck_baby_space_status"),
        Index("uq_baby_personal_space", "created_by", unique=True, postgresql_where=Column("kind") == "personal"),
    )


class BabySpaceMember(Base):
    __tablename__ = "baby_space_members"
    space_id = space_column()
    space_id.primary_key, space_id.nullable = True, False
    app_user_id = owner()
    app_user_id.primary_key = True
    role = Column(String(16), nullable=False)
    status = Column(String(16), nullable=False, default="active")
    access_version = Column(Integer, nullable=False, default=1)
    __table_args__ = (
        CheckConstraint("role IN ('parent','caregiver')", name="ck_baby_member_role"),
        CheckConstraint("status IN ('active','left','removed')", name="ck_baby_member_status"),
        Index("ix_baby_space_members_actor", "app_user_id", "status"),
    )


class BabySpaceInvite(Base):
    __tablename__ = "baby_space_invites"
    id = identifier()
    space_id = space_column()
    space_id.nullable = False
    created_by = Column(String(64), ForeignKey("app_users.id", ondelete="SET NULL"))
    token_hash = Column(String(64), nullable=False, unique=True)
    role = Column(String(16), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True))
    revoked_at = Column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("role IN ('parent','caregiver')", name="ck_baby_invite_role"),
        Index("ix_baby_space_invites_space", "space_id"),
    )


class BabyMovedOut(Base):
    __tablename__ = "baby_moved_out"
    space_id = space_column()
    space_id.primary_key, space_id.nullable = True, False
    seq = Column(BigInteger, primary_key=True)
    record_id = Column(UUID(as_uuid=True), primary_key=True)


class BabyPushDevice(Base):
    __tablename__ = "baby_push_devices"
    id = identifier()
    app_user_id = owner()
    installation_id = Column(String(128), nullable=False)
    token = Column(Text, nullable=False, unique=True)
    platform = Column(String(16), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("app_user_id", "installation_id"),
        CheckConstraint("platform IN ('ios','android')", name="ck_baby_push_platform"),
        Index("ix_baby_push_devices_actor", "app_user_id"),
    )


class BabyNotificationPref(Base):
    __tablename__ = "baby_notification_prefs"
    space_id = space_column()
    space_id.primary_key, space_id.nullable = True, False
    app_user_id = owner()
    app_user_id.primary_key = True
    kind = Column(String(64), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    settings = Column(JSONB, nullable=False, default=dict)


class BabyNotification(Base):
    __tablename__ = "baby_notifications"
    id = identifier()
    space_id = space_column()
    space_id.nullable = False
    app_user_id = owner()
    device_id = Column(UUID(as_uuid=True), ForeignKey("baby_push_devices.id", ondelete="SET NULL"))
    idempotency_key = Column(String(240), nullable=False, unique=True)
    collapse_id = Column(String(64), nullable=False)
    kind = Column(String(64), nullable=False)
    payload = Column(JSONB, nullable=False, default=dict)
    due_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(16), nullable=False, default="queued")
    lease_token = Column(UUID(as_uuid=True))
    lease_until = Column(DateTime(timezone=True))
    attempts = Column(Integer, nullable=False, default=0)
    unknown_retries = Column(Integer, nullable=False, default=0)
    provider_ticket = Column(Text)
    receipt_due_at = Column(DateTime(timezone=True))
    last_error = Column(String(240))
    dismissed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("status IN ('queued','sending','accepted','failed','unknown')", name="ck_baby_notification_status"),
        CheckConstraint("attempts >= 0", name="ck_baby_notification_attempts"),
        CheckConstraint("unknown_retries BETWEEN 0 AND 1", name="ck_baby_notification_unknown_retry"),
        Index("ix_baby_notifications_due", "status", "due_at", "lease_until"),
        Index("ix_baby_notifications_today", "space_id", "app_user_id", "due_at"),
    )


BABY_TABLES = (*BABY_TABLES, *(model.__table__ for model in (
    BabySpace, BabySpaceMember, BabySpaceInvite, BabyMovedOut,
    BabyPushDevice, BabyNotificationPref, BabyNotification,
)))

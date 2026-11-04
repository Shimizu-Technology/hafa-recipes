"""Frozen DDL for Baby050/051. Never derive historical migrations from live models."""

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.domains.baby.schema import ColumnForm

# Rerunning 050/051 must keep passing on every later stage, whatever startup later narrows to.
BABY_V1_SPACE_TABLES = (
    "baby_children", "baby_records", "baby_attachments", "baby_imports",
    "baby_conversations", "baby_messages", "baby_share_credentials", "baby_share_captures",
)
BABY_V1_ALLOWED_FORMS = {
    name: {"space_id": (None, ColumnForm("uuid", True, "CASCADE"), ColumnForm("uuid", False, "CASCADE"))}
    for name in BABY_V1_SPACE_TABLES
}
for name in ("baby_children", "baby_records", "baby_attachments"):
    BABY_V1_ALLOWED_FORMS[name]["app_user_id"] = (
        ColumnForm("varchar", False, "CASCADE"),
        ColumnForm("varchar", True, "SET NULL"),
    )

metadata = MetaData()
# Reference targets only; these shared tables are never created here.
Table("app_users", metadata, Column("id", String(64), primary_key=True))
Table("deletion_cleanup_jobs", metadata, Column("id", UUID(), primary_key=True))

baby_memberships = Table(
    "baby_memberships", metadata,
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), primary_key=True),
    Column('generation', Integer(), nullable=False),
    Column('status', String(16), nullable=False),
    Column('profile', JSONB, nullable=False),
    Column('consent_epoch', Integer(), nullable=False),
    Column('updated_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    CheckConstraint('generation > 0', name='ck_baby_generation'),
    CheckConstraint("status IN ('active','deleted')", name='ck_baby_status'),
)

baby_children = Table(
    "baby_children", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('revision', Integer(), nullable=False),
    Column('deleted_at', DateTime(timezone=True)),
    Column('name', String(120), nullable=False),
    Column('birth_date', Date()),
    Column('due_date', Date()),
    Column('creation_hash', String(64), nullable=False),
    Index('ix_baby_children_owner', 'app_user_id', 'generation'),
)

baby_records = Table(
    "baby_records", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('deleted_at', DateTime(timezone=True)),
    Column('kind', String(16), nullable=False),
    Column('title', String(240), nullable=False),
    Column('body', Text(), nullable=False),
    Column('child_id', UUID()),
    Column('occurred_at', DateTime(timezone=True), nullable=False),
    Column('data', JSONB, nullable=False),
    Column('revision', Integer(), nullable=False),
    Column('creation_hash', String(64), nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    Column('updated_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    CheckConstraint("kind IN ('source','journal','feeding','sleep','diaper','routine','question','collection')", name='ck_baby_record_kind'),
    CheckConstraint('revision > 0', name='ck_baby_record_revision'),
    Index('ix_baby_records_child', 'app_user_id', 'generation', 'child_id'),
    Index('ix_baby_records_owner', 'app_user_id', 'generation', 'occurred_at'),
)

baby_attachments = Table(
    "baby_attachments", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('name', String(180), nullable=False),
    Column('mime_type', String(100), nullable=False),
    Column('size', Integer(), nullable=False),
    Column('object_key', String(240), nullable=False),
    Column('byte_hash', String(64), nullable=False),
    Column('state', String(16), nullable=False),
    Column('cleanup_job_id', UUID(), ForeignKey('deletion_cleanup_jobs.id', ondelete='SET NULL')),
    Column('created_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    Index('ix_baby_attachments_owner', 'app_user_id', 'generation'),
)

baby_imports = Table(
    "baby_imports", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('consent_epoch', Integer(), nullable=False),
    Column('creation_hash', String(64), nullable=False),
    Column('request', JSONB, nullable=False),
    Column('status', String(16), nullable=False),
    Column('record_id', UUID(), nullable=False),
    Column('error', String(200)),
    Column('attempts', Integer(), nullable=False),
    Column('lease_token', UUID()),
    Column('lease_until', DateTime(timezone=True)),
    Column('created_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    Column('updated_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    CheckConstraint("status IN ('queued','processing','ready','incomplete','failed','cancelled')", name='ck_baby_import_status'),
    Index('ix_baby_imports_owner', 'app_user_id', 'generation'),
    Index('ix_baby_imports_queue', 'status', 'lease_until', 'created_at'),
)

baby_conversations = Table(
    "baby_conversations", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('title', String(240), nullable=False),
    Column('scope', String(16), nullable=False),
    Column('record_id', UUID()),
    Column('child_id', UUID()),
    Column('created_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    Column('updated_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    Index('ix_baby_conversations_owner', 'app_user_id', 'generation'),
)

baby_messages = Table(
    "baby_messages", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('conversation_id', UUID(), ForeignKey('baby_conversations.id', ondelete='CASCADE'), nullable=False),
    Column('role', String(16), nullable=False),
    Column('content', JSONB, nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    Index('ix_baby_messages_owner', 'app_user_id', 'generation', 'conversation_id'),
)

baby_ai_admissions = Table(
    "baby_ai_admissions", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='SET NULL')),
    Column('generation', Integer(), nullable=False),
    Column('capability', String(32), nullable=False),
    Column('reserved_microusd', Integer(), nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False, server_default=text('now()')),
    CheckConstraint('reserved_microusd > 0', name='ck_baby_ai_positive'),
    Index('ix_baby_ai_admissions_created', 'created_at', 'app_user_id'),
)

baby_share_credentials = Table(
    "baby_share_credentials", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('installation_hash', String(64), nullable=False),
    Column('token_hash', String(64), nullable=False),
    Column('expires_at', DateTime(timezone=True), nullable=False),
    Column('revoked_at', DateTime(timezone=True)),
    UniqueConstraint('token_hash'),
    UniqueConstraint('app_user_id', 'generation', 'installation_hash', name='uq_baby_share_installation'),
)

baby_share_captures = Table(
    "baby_share_captures", metadata,
    Column('id', UUID(), primary_key=True),
    Column('app_user_id', String(64), ForeignKey('app_users.id', ondelete='CASCADE'), nullable=False),
    Column('generation', Integer(), nullable=False),
    Column('creation_hash', String(64), nullable=False),
    Column('request', JSONB, nullable=False),
    Column('record_id', UUID(), nullable=False),
    Column('status', String(16), nullable=False),
    Column('last_attempt_at', DateTime(timezone=True)),
    Column('created_at', DateTime(timezone=True), nullable=False),
)

BABY_V1_TABLES = (
    baby_memberships,
    baby_children,
    baby_records,
    baby_attachments,
    baby_imports,
    baby_conversations,
    baby_messages,
    baby_ai_admissions,
)
BABY_SHARE_V1_TABLES = (baby_share_credentials, baby_share_captures)

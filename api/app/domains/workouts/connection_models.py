"""Opt-in access receipts and explicitly published workout snapshots."""

import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class RecipeConnectionReceipt(Base):
    __tablename__ = "workouts_recipe_connection_receipts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    purpose = Column(String(16), nullable=False)
    scopes = Column(JSONB, nullable=False)
    recipe_ids = Column(JSONB, nullable=False)
    meal_plan_ids = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("purpose IN ('view','coach')", name="ck_workouts_recipe_receipt_purpose"),
    )


class WorkoutSharePreview(Base):
    __tablename__ = "workouts_share_previews"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    kind = Column(String(16), nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False)
    source_revision = Column(Integer, nullable=False)
    snapshot = Column(JSONB, nullable=False)
    snapshot_digest = Column(String(64), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    link_expires_at = Column(DateTime(timezone=True), nullable=False)
    confirmed_share_id = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class WorkoutShare(Base):
    __tablename__ = "workouts_shares"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    kind = Column(String(16), nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False)
    source_revision = Column(Integer, nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    encrypted_token = Column(Text, nullable=False)
    scope = Column(String(32), nullable=False, default="training:preview_copy")
    snapshot = Column(JSONB, nullable=False)
    snapshot_digest = Column(String(64), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("scope='training:preview_copy'", name="ck_workouts_share_scope"),
    )


class WorkoutCopyReceipt(Base):
    __tablename__ = "workouts_copy_receipts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    copy_request_id = Column(UUID(as_uuid=True), nullable=False)
    # No source-share FK: a recipient's deliberate copy survives source revocation
    # or deletion. Attribution is a frozen published alias/revision, never an ID.
    share_id = Column(UUID(as_uuid=True), nullable=False)
    source_token_hash = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)
    kind = Column(String(16), nullable=False)
    snapshot_digest = Column(String(64), nullable=False)
    attribution = Column(JSONB, nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "copy_request_id", name="uq_workouts_share_copy"
        ),
    )


CONNECTION_TABLES = (
    RecipeConnectionReceipt.__table__,
    WorkoutSharePreview.__table__,
    WorkoutShare.__table__,
    WorkoutCopyReceipt.__table__,
)
for table in CONNECTION_TABLES:
    table.append_constraint(CheckConstraint("generation>0", name=f"ck_{table.name}_generation"))
    if "kind" in table.columns:
        table.append_constraint(
            CheckConstraint("kind IN ('workout','program')", name=f"ck_{table.name}_kind")
        )

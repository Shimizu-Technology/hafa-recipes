"""Private and household pantry inventory, scoped independently of grocery items."""

import uuid

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class PantrySpace(Base):
    __tablename__ = "pantry_spaces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind = Column(String(16), nullable=False)
    owner_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=True
    )
    grocery_list_id = Column(
        UUID(as_uuid=True), ForeignKey("grocery_lists.id", ondelete="CASCADE"), nullable=True
    )
    revision = Column(BigInteger, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    items = relationship("PantryItem", back_populates="space", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("owner_user_id", name="uq_pantry_spaces_owner"),
        UniqueConstraint("grocery_list_id", name="uq_pantry_spaces_list"),
        CheckConstraint(
            "(kind = 'personal' AND owner_user_id IS NOT NULL AND grocery_list_id IS NULL) OR "
            "(kind = 'household' AND owner_user_id IS NULL AND grocery_list_id IS NOT NULL)",
            name="ck_pantry_space_scope",
        ),
    )


class PantryItem(Base):
    """One lot: dates and amounts from different purchases never overwrite each other."""

    __tablename__ = "pantry_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    space_id = Column(
        UUID(as_uuid=True),
        ForeignKey("pantry_spaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    quantity = Column(Numeric(12, 3), nullable=True)
    unit = Column(String(50), nullable=True)
    location = Column(String(50), nullable=True)
    date_kind = Column(String(16), nullable=True)
    date_value = Column(Date, nullable=True)
    notes = Column(String(255), nullable=True)
    source_personal_item_id = Column(UUID(as_uuid=True), nullable=True)
    created_by_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    space = relationship("PantrySpace", back_populates="items")

    __table_args__ = (
        UniqueConstraint("space_id", "source_personal_item_id", name="uq_pantry_copy_source"),
        CheckConstraint("quantity IS NULL OR quantity >= 0", name="ck_pantry_item_quantity"),
        CheckConstraint(
            "(date_kind IS NULL AND date_value IS NULL) OR "
            "(date_kind IN ('best_before', 'use_by') AND date_value IS NOT NULL)",
            name="ck_pantry_item_date",
        ),
    )


class PantryMutationReceipt(Base):
    """Hash-bound receipt for replay-safe pantry writes."""

    __tablename__ = "pantry_mutation_receipts"

    space_id = Column(
        UUID(as_uuid=True), ForeignKey("pantry_spaces.id", ondelete="CASCADE"), nullable=False
    )
    mutation_id = Column(UUID(as_uuid=True), nullable=False)
    actor_user_id = Column(
        String(64), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    operation = Column(String(24), nullable=False)
    request_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint("space_id", "mutation_id", name="pk_pantry_mutation_receipts"),
        CheckConstraint(
            "operation IN ('add', 'update', 'delete', 'transfer', 'copy')",
            name="ck_pantry_mutation_operation",
        ),
    )


class PantryTransferReceipt(Base):
    """Keep a grocery item from entering the same pantry twice, even after deletion."""

    __tablename__ = "pantry_transfer_receipts"

    space_id = Column(
        UUID(as_uuid=True), ForeignKey("pantry_spaces.id", ondelete="CASCADE"), nullable=False
    )
    grocery_item_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint("space_id", "grocery_item_id", name="pk_pantry_transfer_receipts"),
    )


class PantryCopyReceipt(Base):
    """A private lot stays copied even if its household copy is removed."""

    __tablename__ = "pantry_copy_receipts"

    space_id = Column(
        UUID(as_uuid=True), ForeignKey("pantry_spaces.id", ondelete="CASCADE"), nullable=False
    )
    personal_item_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint("space_id", "personal_item_id", name="pk_pantry_copy_receipts"),
    )

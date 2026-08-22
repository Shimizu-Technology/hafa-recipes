"""SQLAlchemy models for grocery items and shared lists."""

import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class GroceryList(Base):
    """Grocery list that can be shared between users."""
    
    __tablename__ = "grocery_lists"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, default="Grocery List")
    # Monotonic change token used by mobile clients and WidgetKit snapshots.
    # Every mutation through the durable sync contract increments this value
    # while holding a row lock on the list.
    revision = Column(BigInteger, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    members = relationship("GroceryListMember", back_populates="grocery_list", cascade="all, delete-orphan")
    items = relationship("GroceryItem", back_populates="grocery_list", cascade="all, delete-orphan")
    invites = relationship("GroceryListInvite", back_populates="grocery_list", cascade="all, delete-orphan")


class GroceryListMember(Base):
    """Member of a shared grocery list."""
    
    __tablename__ = "grocery_list_members"
    
    list_id = Column(UUID(as_uuid=True), ForeignKey("grocery_lists.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=True,
        index=True,
    )
    display_name = Column(String(255), nullable=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    grocery_list = relationship("GroceryList", back_populates="members")

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_grocery_list_members_user_id"),
    )


class GroceryListInvite(Base):
    """Invite to join a shared grocery list."""
    
    __tablename__ = "grocery_list_invites"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    list_id = Column(UUID(as_uuid=True), ForeignKey("grocery_lists.id", ondelete="CASCADE"), nullable=False)
    invite_code = Column(String(20), unique=True, nullable=False, index=True)
    created_by = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    accepted_by = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    grocery_list = relationship("GroceryList", back_populates="invites")


class GroceryItem(Base):
    """Grocery list item model."""
    
    __tablename__ = "grocery_items"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    list_id = Column(UUID(as_uuid=True), ForeignKey("grocery_lists.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    quantity = Column(String(50), nullable=True)
    unit = Column(String(50), nullable=True)
    notes = Column(String(255), nullable=True)
    checked = Column(Boolean, nullable=False, default=False)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True)
    recipe_title = Column(String(255), nullable=True)
    added_by_name = Column(String(255), nullable=True)  # Who added this item
    archived = Column(Boolean, nullable=False, default=False)  # Hidden when user joins shared list
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    grocery_list = relationship("GroceryList", back_populates="items")


class GroceryMutationReceipt(Base):
    """Hash-bound receipt that makes client grocery mutations replay-safe."""

    __tablename__ = "grocery_mutation_receipts"

    list_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "grocery_lists.id",
            ondelete="CASCADE",
            name="fk_grocery_mutation_receipts_list",
        ),
        nullable=False,
    )
    mutation_id = Column(UUID(as_uuid=True), nullable=False)
    actor_user_id = Column(
        String(64),
        ForeignKey(
            "app_users.id",
            ondelete="CASCADE",
            name="fk_grocery_mutation_receipts_actor",
        ),
        nullable=False,
        index=True,
    )
    operation = Column(String(24), nullable=False)
    request_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint(
            "list_id",
            "mutation_id",
            name="pk_grocery_mutation_receipts",
        ),
        CheckConstraint(
            "operation IN ('add', 'update', 'set_checked', 'delete')",
            name="ck_grocery_mutation_receipts_operation",
        ),
    )


class GroceryWidgetCredential(Base):
    """Revocable, device-scoped capability for the iOS grocery widget.

    Only a digest of the opaque bearer secret is stored. The credential is
    bound to the stable application user and the exact list membership that
    existed when it was issued.
    """

    __tablename__ = "grocery_widget_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = Column(
        String(64),
        ForeignKey(
            "app_users.id",
            ondelete="CASCADE",
            name="fk_grocery_widget_credentials_user",
        ),
        nullable=False,
        index=True,
    )
    list_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "grocery_lists.id",
            ondelete="CASCADE",
            name="fk_grocery_widget_credentials_list",
        ),
        nullable=False,
        index=True,
    )
    installation_hash = Column(String(64), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    scope = Column(
        String(64),
        nullable=False,
        default="grocery:read grocery:set_checked",
        server_default="grocery:read grocery:set_checked",
    )
    issued_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "app_user_id",
            "installation_hash",
            name="uq_grocery_widget_credential_user_installation",
        ),
        CheckConstraint(
            "scope = 'grocery:read grocery:set_checked'",
            name="ck_grocery_widget_credentials_scope",
        ),
        CheckConstraint(
            "expires_at > issued_at",
            name="ck_grocery_widget_credentials_expiry",
        ),
    )

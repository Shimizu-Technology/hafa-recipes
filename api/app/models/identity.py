"""Stable application users and their issuer-scoped Clerk identities."""

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class AppUser(Base):
    """Stable owner ID used by recipes and all other application data."""

    __tablename__ = "app_users"

    # Existing development Clerk subjects become stable IDs during backfill, so
    # no business-data ownership columns need to be rewritten.
    id = Column(String(64), primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    clerk_identities = relationship(
        "ClerkIdentity",
        back_populates="app_user",
        cascade="all, delete-orphan",
    )


class ClerkIdentity(Base):
    """A Clerk subject scoped to the exact instance that issued it."""

    __tablename__ = "clerk_identities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    issuer = Column(String(512), nullable=False)
    clerk_user_id = Column(String(64), nullable=False)
    email_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_authenticated_at = Column(DateTime(timezone=True), nullable=True)

    app_user = relationship("AppUser", back_populates="clerk_identities")

    __table_args__ = (
        UniqueConstraint("issuer", "clerk_user_id", name="uq_clerk_identity_subject"),
        UniqueConstraint("app_user_id", "issuer", name="uq_clerk_identity_user_issuer"),
    )


class ClerkMigrationGrant(Base):
    """One-use, hash-at-rest credential for the mobile Clerk cutover.

    The development-key bridge release stores the opaque grant in the device
    keychain. The production-key release redeems it for a 60-second Clerk
    sign-in ticket. Only the SHA-256 digest is retained by the API.
    """

    __tablename__ = "clerk_migration_grants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = Column(
        String(64),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_hash = Column(String(64), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    redeemed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "app_user_id",
            "device_hash",
            name="uq_clerk_migration_grant_user_device",
        ),
    )

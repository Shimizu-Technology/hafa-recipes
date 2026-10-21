"""Optional Baby-only native intake authority and durable capture receipts."""

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.domains.baby.models import Base, identifier, owner


class BabyShareCredential(Base):
    __tablename__ = "baby_share_credentials"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    installation_hash = Column(String(64), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "installation_hash", name="uq_baby_share_installation"
        ),
    )


class BabyShareCapture(Base):
    __tablename__ = "baby_share_captures"
    id = identifier()
    app_user_id = owner()
    generation = Column(Integer, nullable=False)
    creation_hash = Column(String(64), nullable=False)
    request = Column(JSONB, nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False)
    status = Column(String(16), nullable=False)
    last_attempt_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False)

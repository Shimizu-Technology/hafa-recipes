"""Content-free import accounting, surviving only product-scoped erasure."""

from sqlalchemy import Column, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class WorkoutImportUsage(Base):
    __tablename__ = "workouts_import_usage"
    app_user_id = owner_column(primary_key=True)
    request_id = Column(UUID(as_uuid=True), primary_key=True)
    charged_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_workouts_import_usage_expiry", "charged_at"),)


# Deliberately separate from product erasure/export payload tables. AppUser's
# FK cascade still removes these receipts on whole-account deletion.
IMPORT_USAGE_TABLES = (WorkoutImportUsage.__table__,)

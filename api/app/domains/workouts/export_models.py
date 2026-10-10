"""Private temporary export ciphertext and content-free invalidation epochs."""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.domains.workouts.models import Base, owner_column


class WorkoutsExportEpoch(Base):
    __tablename__ = "workouts_export_epochs"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, primary_key=True)
    revision = Column(Integer, nullable=False)
    __table_args__ = (
        CheckConstraint("generation > 0 AND revision > 0", name="ck_workouts_export_epoch"),
    )


class WorkoutsExportSnapshot(Base):
    __tablename__ = "workouts_export_snapshots"
    id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(String(12), nullable=False)
    permission_digest = Column(LargeBinary, nullable=False)
    page_count = Column(Integer, nullable=False, default=0)
    byte_count = Column(Integer, nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint("app_user_id", name="uq_workouts_export_slot"),
        CheckConstraint(
            "generation > 0 AND page_count BETWEEN 0 AND 512 AND byte_count BETWEEN 0 AND 67108864",
            name="ck_workouts_export_bounds",
        ),
        CheckConstraint("status IN ('building','ready')", name="ck_workouts_export_status"),
        CheckConstraint(
            "expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes'",
            name="ck_workouts_export_ttl",
        ),
        CheckConstraint("octet_length(permission_digest)=32", name="ck_workouts_export_digest"),
    )


class WorkoutsExportPage(Base):
    __tablename__ = "workouts_export_pages"
    snapshot_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workouts_export_snapshots.id", ondelete="CASCADE"),
        primary_key=True,
    )
    page = Column(Integer, primary_key=True)
    ciphertext = Column(LargeBinary, nullable=False)
    __table_args__ = (
        CheckConstraint("page BETWEEN 0 AND 511", name="ck_workouts_export_page"),
        CheckConstraint(
            "octet_length(ciphertext) BETWEEN 29 AND 8388636", name="ck_workouts_export_ciphertext"
        ),
    )


EXPORT_TABLES = (
    WorkoutsExportEpoch.__table__,
    WorkoutsExportSnapshot.__table__,
    WorkoutsExportPage.__table__,
)

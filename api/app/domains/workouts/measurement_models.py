"""Self-reported measurements with scrubbed removal and explicit current selection."""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class WorkoutsMeasurement(Base):
    __tablename__ = "workouts_measurements"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    kind = Column(String(16), nullable=False)
    source = Column(String(16), nullable=False, default="user")
    status = Column(String(16), nullable=False, default="active")
    value = Column(Float)
    unit = Column(String(8))
    canonical_value = Column(Float)
    recorded_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "id", "app_user_id", "generation", "kind", name="uq_workouts_measurement_owner"
        ),
        CheckConstraint("generation>0 AND revision>0", name="ck_workouts_measurement_revision"),
        CheckConstraint(
            "kind IN ('weight','height') AND source='user'", name="ck_workouts_measurement_kind"
        ),
        CheckConstraint("status IN ('active','removed')", name="ck_workouts_measurement_status"),
        CheckConstraint(
            "(status='removed' AND value IS NULL AND unit IS NULL AND canonical_value IS NULL AND recorded_at IS NULL) OR (status='active' AND value IS NOT NULL AND unit IS NOT NULL AND canonical_value IS NOT NULL AND value>0 AND value<'Infinity'::float8 AND recorded_at IS NOT NULL AND ((kind='weight' AND unit IN ('kg','lb') AND canonical_value>0 AND canonical_value<=500) OR (kind='height' AND unit IN ('cm','in') AND canonical_value>0 AND canonical_value<=300)))",
            name="ck_workouts_measurement_values",
        ),
    )


class WorkoutsMeasurementCurrent(Base):
    __tablename__ = "workouts_measurement_current"
    app_user_id = owner_column(primary_key=True)
    kind = Column(String(16), primary_key=True)
    generation = Column(Integer, nullable=False)
    measurement_id = Column(UUID(as_uuid=True))
    cleared_at = Column(DateTime(timezone=True))
    __table_args__ = (
        ForeignKeyConstraint(
            ["measurement_id", "app_user_id", "generation", "kind"],
            [
                "workouts_measurements.id",
                "workouts_measurements.app_user_id",
                "workouts_measurements.generation",
                "workouts_measurements.kind",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "generation>0 AND kind IN ('weight','height')",
            name="ck_workouts_current_measurement_kind",
        ),
    )


class WorkoutsMeasurementOperation(Base):
    __tablename__ = "workouts_measurement_operations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_hash = Column(String(64), nullable=False)
    action = Column(String(16), nullable=False)
    measurement_id = Column(UUID(as_uuid=True), nullable=False)
    current_applied = Column(Boolean, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "request_id", name="uq_workouts_measurement_operation"
        ),
        CheckConstraint(
            "generation>0 AND action IN ('create','correct','remove')",
            name="ck_workouts_measurement_operation",
        ),
    )


MEASUREMENT_TABLES = (
    WorkoutsMeasurement.__table__,
    WorkoutsMeasurementCurrent.__table__,
    WorkoutsMeasurementOperation.__table__,
)

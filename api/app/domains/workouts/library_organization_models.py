"""Private library metadata; organization never changes a prescription revision."""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class WorkoutLibraryOrganization(Base):
    __tablename__ = "workouts_library_organization"
    workout_id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    favorite = Column(Boolean, nullable=False, default=False)
    archived = Column(Boolean, nullable=False, default=False)
    tags = Column(JSONB, nullable=False, default=list)
    tag_keys = Column(JSONB, nullable=False, default=list)
    source_key = Column(String(64), index=True)
    # Historical identifiers: removing the original never erases copy provenance.
    duplicate_of_workout_id = Column(UUID(as_uuid=True))
    duplicate_of_revision = Column(Integer)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(
            ["workout_id", "app_user_id", "generation"],
            ["workouts_library.id", "workouts_library.app_user_id", "workouts_library.generation"],
            ondelete="CASCADE",
        ),
        CheckConstraint("generation>0 AND revision>0", name="ck_workouts_organization_revision"),
        CheckConstraint(
            "jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=20",
            name="ck_workouts_organization_tags",
        ),
        CheckConstraint(
            "jsonb_typeof(tag_keys)='array' AND jsonb_array_length(tag_keys)<=20",
            name="ck_workouts_organization_keys",
        ),
        CheckConstraint(
            "(duplicate_of_workout_id IS NULL AND duplicate_of_revision IS NULL) OR (duplicate_of_workout_id IS NOT NULL AND duplicate_of_revision>0)",
            name="ck_workouts_organization_origin",
        ),
    )


class WorkoutLibraryCollection(Base):
    __tablename__ = "workouts_library_collections"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    title = Column(String(100), nullable=False)
    title_key = Column(String(300), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("id", "app_user_id", "generation", name="uq_workouts_collection_owner"),
        UniqueConstraint(
            "app_user_id", "generation", "title_key", name="uq_workouts_collection_title"
        ),
        CheckConstraint("generation>0 AND revision>0", name="ck_workouts_collection_revision"),
    )


class WorkoutLibraryCollectionMember(Base):
    __tablename__ = "workouts_library_collection_members"
    collection_id = Column(UUID(as_uuid=True), primary_key=True)
    workout_id = Column(UUID(as_uuid=True), primary_key=True)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(
            ["collection_id", "app_user_id", "generation"],
            [
                "workouts_library_collections.id",
                "workouts_library_collections.app_user_id",
                "workouts_library_collections.generation",
            ],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["workout_id", "app_user_id", "generation"],
            ["workouts_library.id", "workouts_library.app_user_id", "workouts_library.generation"],
            ondelete="CASCADE",
        ),
        CheckConstraint("generation>0", name="ck_workouts_collection_member_generation"),
    )


class WorkoutLibraryDuplicateReceipt(Base):
    __tablename__ = "workouts_library_duplicate_receipts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_user_id = owner_column()
    generation = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    request_hash = Column(String(64), nullable=False)
    source_workout_id = Column(UUID(as_uuid=True), nullable=False)
    source_revision = Column(Integer, nullable=False)
    destination_workout_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint(
            "app_user_id", "generation", "request_id", name="uq_workouts_duplicate_request"
        ),
        CheckConstraint(
            "generation>0 AND source_revision>0", name="ck_workouts_duplicate_generation"
        ),
    )


ORGANIZATION_TABLES = (
    WorkoutLibraryOrganization.__table__,
    WorkoutLibraryCollection.__table__,
    WorkoutLibraryCollectionMember.__table__,
    WorkoutLibraryDuplicateReceipt.__table__,
)

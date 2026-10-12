"""Monotonic Recipes choice revisions, isolated by account and enrollment generation."""

from sqlalchemy import CheckConstraint, Column, DateTime, Integer
from sqlalchemy.sql import func

from app.domains.workouts.models import Base, owner_column


class WorkoutsRecipeGrantEpoch(Base):
    __tablename__ = "workouts_recipe_grant_epochs"
    app_user_id = owner_column(primary_key=True)
    generation = Column(Integer, primary_key=True)
    revision = Column(Integer, nullable=False, default=1)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("generation>0 AND revision>0", name="ck_workouts_recipe_epoch_positive"),
    )

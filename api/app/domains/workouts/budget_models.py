"""Anonymous global paid-AI admission ledger, independent of account deletion."""

from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

BudgetBase = declarative_base()


class WorkoutsAIAdmission(BudgetBase):
    __tablename__ = "workouts_ai_admissions"
    attempt_id = Column(UUID(as_uuid=True), primary_key=True)
    capability = Column(String(32), nullable=False)
    model = Column(String(128), nullable=False)
    admitted_microusd = Column(BigInteger, nullable=False)
    estimated_cost_microusd = Column(BigInteger)
    outcome = Column(String(16), nullable=False, server_default="unknown")
    admitted_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )
    finished_at = Column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint(
            "capability IN ('workout_extraction','workout_coach','workout_transcription')",
            name="ck_workouts_ai_budget_capability",
        ),
        CheckConstraint(
            "model IN ('gpt-5.6-luna','gpt-5.6-terra','whisper-1')",
            name="ck_workouts_ai_budget_model",
        ),
        CheckConstraint(
            "admitted_microusd>0 AND admitted_microusd<=9000000000000000",
            name="ck_workouts_ai_budget_amount",
        ),
        CheckConstraint(
            "estimated_cost_microusd IS NULL OR (estimated_cost_microusd>=0 AND estimated_cost_microusd<=9000000000000000)",
            name="ck_workouts_ai_budget_estimate",
        ),
        CheckConstraint(
            "outcome IN ('unknown','success','failed','cancelled')",
            name="ck_workouts_ai_budget_outcome",
        ),
        Index("ix_workouts_ai_admission_window", "admitted_at"),
    )

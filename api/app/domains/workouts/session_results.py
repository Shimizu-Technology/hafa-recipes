"""Optional class scores and splits; heart-rate upload requires an explicit storage grant."""

from typing import Literal

from fastapi import HTTPException
from pydantic import AwareDatetime, Field, StrictBool, model_validator
from sqlalchemy import select, text

from app.domains.workouts.models import WorkoutsGrant
from app.domains.workouts.schemas import DomainModel


class PartResult(DomainModel):
    block_id: str = Field(min_length=1, max_length=100)
    kind: Literal["rounds_reps", "time", "load", "reps", "distance", "calories", "completed"]
    time_seconds: int | None = Field(default=None, strict=True, ge=0, le=86400)
    capped: StrictBool = False
    rounds: int | None = Field(default=None, strict=True, ge=0, le=1000)
    reps: int | None = Field(default=None, strict=True, ge=0, le=10000)
    buy_in_done: StrictBool | None = None
    buy_in_seconds: int | None = Field(default=None, strict=True, ge=0, le=86400)
    load: float | None = Field(default=None, strict=True, ge=0, le=2000)
    load_unit: Literal["kg", "lb"] | None = None
    distance_meters: float | None = Field(default=None, strict=True, ge=0, le=1000000)
    calories: int | None = Field(default=None, strict=True, ge=0, le=10000)
    scaling: Literal["rx", "scaled", "custom"] | None = None
    scaling_note: str | None = Field(default=None, max_length=200)
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    origin: Literal["timer", "watch", "manual"] = "manual"

    @model_validator(mode="after")
    def valid_score(self):
        if (self.started_at is None) != (self.ended_at is None):
            raise ValueError("Part timestamps must be supplied together")
        if self.started_at and self.ended_at < self.started_at:
            raise ValueError("Part end must not precede start")
        if (self.load is None) != (self.load_unit is None):
            raise ValueError("A load and its unit must be supplied together")
        if self.capped and self.kind != "time":
            raise ValueError("Only a for-time score can be capped")
        required = {
            "rounds_reps": ("rounds", "reps"),
            "time": ("rounds", "reps") if self.capped else ("time_seconds",),
            "load": ("load",), "reps": ("reps",), "distance": ("distance_meters",),
            "calories": ("calories",), "completed": (),
        }[self.kind]
        if self.buy_in_done is False:
            if self.kind != "rounds_reps" or self.rounds or self.reps:
                raise ValueError("An unfinished buy-in cannot score repeating rounds or reps")
            required = ("distance_meters",)
        if any(getattr(self, field) is None for field in required):
            raise ValueError("Score is missing its required value")
        allowed = set(required) | {"time_seconds"}
        if self.buy_in_done is False:
            allowed |= {"rounds", "reps"}
        if any(getattr(self, field) is not None for field in
               {"rounds", "reps", "load", "distance_meters", "calories"} - allowed):
            raise ValueError("Score contains a value for another score kind")
        return self


class Segment(DomainModel):
    block_id: str = Field(min_length=1, max_length=100)
    kind: Literal["buy_in", "round", "run", "station", "rest", "part"]
    index: int = Field(strict=True, ge=1, le=1000)
    label: str | None = Field(default=None, max_length=60)
    started_at: AwareDatetime
    ended_at: AwareDatetime
    distance_meters: float | None = Field(default=None, strict=True, ge=0, le=100000)
    run_environment: Literal["outdoor", "treadmill"] | None = None
    distance_source: Literal["gps", "prescribed", "edited"] | None = None
    avg_hr: int | None = Field(default=None, strict=True, ge=20, le=250)
    max_hr: int | None = Field(default=None, strict=True, ge=20, le=250)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.distance_source is not None and (self.run_environment is None or self.distance_meters is None):
            raise ValueError("A distance source requires run environment and distance")
        if self.run_environment == "treadmill" and self.distance_source == "gps":
            raise ValueError("Treadmill distance cannot come from GPS")
        if self.avg_hr is not None and self.max_hr is not None and self.avg_hr > self.max_hr:
            raise ValueError("Average heart rate cannot exceed maximum")
        if self.ended_at < self.started_at:
            raise ValueError("Segment end must not precede start")
        return self


def validate_intervals(request):
    """Validate without a database so malformed intervals never reach a write."""
    ids = [result.block_id for result in request.results]
    if len(set(ids)) != len(ids):
        raise ValueError("A part can have at most one result")
    previous = {}
    identities = set()
    for item in [*request.results, *request.segments]:
        if item.started_at is not None and (
            item.started_at < request.started_at or item.ended_at > request.finished_at
        ):
            raise ValueError("Part and segment intervals must lie inside the session")
    for segment in request.segments:
        key = (segment.block_id, segment.kind, segment.index)
        if key in identities or segment.started_at < previous.get(segment.block_id, request.started_at):
            raise ValueError("Segments must be unique and ordered within each part")
        identities.add(key)
        previous[segment.block_id] = segment.started_at
    return request


def validate_snapshot(request, snapshot):
    blocks = {block["id"]: block for block in snapshot["blocks"]}
    for result in request.results:
        block = blocks.get(result.block_id)
        if block is None:
            raise HTTPException(422, "A result does not reference the saved prescription")
        mode = (block.get("execution") or {}).get("mode")
        allowed = {"amrap": {"rounds_reps"}, "for_time": {"time"},
                   "emom": {"reps", "completed"}, "work_rest": {"reps", "completed"}}
        if block.get("score_kind") == "none" or result.kind not in allowed.get(mode, {"load", "reps", "completed"}):
            raise HTTPException(422, "Result kind does not fit the saved part")
        buy_ins = [ex for ex in block.get("exercises", []) if ex.get("segment") == "buy_in"]
        if (result.buy_in_done is not None or result.buy_in_seconds is not None) and not buy_ins:
            raise HTTPException(422, "This part has no buy-in")
        cap = (block.get("execution") or {}).get("time_cap_seconds")
        if cap and result.buy_in_seconds is not None and result.buy_in_seconds > cap:
            raise HTTPException(422, "Buy-in time exceeds the part cap")
    for segment in request.segments:
        if segment.block_id not in blocks:
            raise HTTPException(422, "A segment does not reference the saved prescription")
        result = next((r for r in request.results if r.block_id == segment.block_id), None)
        if result and result.started_at is not None and (
            segment.started_at < result.started_at or segment.ended_at > result.ended_at
        ):
            raise HTTPException(422, "A segment must lie inside its part interval")


class HeartRateSummary(DomainModel):
    avg: int = Field(strict=True, ge=20, le=250)
    max: int = Field(strict=True, ge=20, le=250)
    source: Literal["apple_watch", "health"]

    @model_validator(mode="after")
    def valid_summary(self):
        if self.avg > self.max:
            raise ValueError("Average heart rate cannot exceed maximum")
        return self


class HealthSummaryChoice(DomainModel):
    enabled: StrictBool


HEALTH_SUMMARY_SCOPE = "health_workout_summary_store"


async def health_summary_ready(db):
    return bool(await db.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=63)")))


async def health_summary_enabled(db, owner, generation):
    return bool(await db.scalar(select(WorkoutsGrant.app_user_id).where(
        WorkoutsGrant.app_user_id == owner, WorkoutsGrant.generation == generation,
        WorkoutsGrant.scope == HEALTH_SUMMARY_SCOPE)))


async def require_summary_permission(db, owner, generation, request):
    if request.heart_rate is not None or any(s.avg_hr is not None or s.max_hr is not None for s in request.segments):
        if not await health_summary_ready(db) or not await health_summary_enabled(db, owner, generation):
            raise HTTPException(403, "Enable heart-rate summary storage before uploading heart-rate data")

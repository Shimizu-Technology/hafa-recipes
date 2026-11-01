"""Versioned prescriptions are independent from immutable recorded actuals."""

from datetime import date
from typing import Annotated, Literal, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    model_serializer,
    model_validator,
)

Goal = Literal[
    "general_fitness", "strength", "body_composition", "running", "athletic_conditioning"
]
Provenance = Literal["source", "user", "suggestion"]
Status = Literal["ready", "needs_information", "conflicts", "unsupported"]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Evidence(DomainModel):
    field: str = Field(min_length=1, max_length=80)
    wording: str = Field(min_length=1, max_length=2000)
    location: str | None = Field(default=None, max_length=500)


class ExercisePrescription(DomainModel):
    exercise_id: str | None = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    provenance: Provenance = "user"
    sets: int | None = Field(default=None, ge=1, le=100)
    reps_min: int | None = Field(default=None, ge=1, le=1000)
    reps_max: int | None = Field(default=None, ge=1, le=1000)
    per_side: bool | None = None
    duration_seconds: int | None = Field(default=None, ge=1, le=86400)
    distance_meters: float | None = Field(default=None, gt=0, le=1000000)
    rest_seconds: int | None = Field(default=None, ge=0, le=7200)
    tempo: str | None = Field(default=None, max_length=100)
    load: float | None = Field(default=None, ge=0, le=2000)
    load_unit: Literal["kg", "lb"] | None = None
    load_convention: Literal["total", "per_hand", "added", "assistance"] | None = None
    effort: str | None = Field(default=None, max_length=500)
    # Reps per round for 21-15-9 style schemes, or an open/closed rep ladder.
    # Absent keys keep legacy snapshots, and their content hashes, unchanged.
    rep_scheme: list[Annotated[StrictInt, Field(ge=1, le=1000)]] | None = Field(
        default=None, min_length=2, max_length=100, exclude_if=lambda value: value is None)
    ladder: "RepLadder | None" = Field(default=None, exclude_if=lambda value: value is None)
    # Shareable prescription cues; legacy notes remain owner-only.
    instructions: str | None = Field(default=None, max_length=2000, exclude_if=lambda value: value is None)
    notes: str | None = Field(default=None, max_length=2000)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.reps_min is not None and self.reps_max is not None:
            if self.reps_min > self.reps_max:
                raise ValueError("reps_min cannot exceed reps_max")
        if self.load is not None and (self.load_unit is None or self.load_convention is None):
            raise ValueError("load requires a unit and load convention")
        return self


class RepLadder(DomainModel):
    """Reps change by step each round or interval; an open ladder runs to failure."""

    start: StrictInt = Field(ge=1, le=1000)
    step: StrictInt = Field(ge=-100, le=100)
    end: StrictInt | None = Field(default=None, ge=1, le=1000)


ExercisePrescription.model_rebuild()


class AmrapExecution(DomainModel):
    mode: Literal["amrap"]
    time_cap_seconds: StrictInt = Field(ge=1, le=86400)


class EmomExecution(DomainModel):
    """Every interval (60 s for EMOM/OTM), for a known or unknown number of intervals."""

    mode: Literal["emom"]
    interval_seconds: StrictInt = Field(default=60, ge=1, le=3600)
    intervals: StrictInt | None = Field(default=None, ge=1, le=1440)
    rotation: Literal["alternating", "together"] | None = None


class ForTimeExecution(DomainModel):
    """Complete the block's rounds (one pass when unset) as fast as possible."""

    mode: Literal["for_time"]
    time_cap_seconds: StrictInt | None = Field(default=None, ge=1, le=86400)


class WorkRestExecution(DomainModel):
    """Fixed work and rest intervals, such as Tabata or 30 on / 30 off."""

    mode: Literal["work_rest"]
    work_seconds: StrictInt = Field(ge=1, le=3600)
    rest_seconds: StrictInt = Field(ge=0, le=3600)
    intervals: StrictInt | None = Field(default=None, ge=1, le=1000)


# Clients that predate a mode never receive it; see extraction typed_formats.
WorkoutExecution = Annotated[
    Union[AmrapExecution, EmomExecution, ForTimeExecution, WorkRestExecution],
    Field(discriminator="mode"),
]


class WorkoutBlock(DomainModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    grouping: Literal["sequential", "circuit", "superset", "interval"] = "sequential"
    rounds: int | None = Field(default=None, ge=1, le=100)
    execution: WorkoutExecution | None = Field(default=None, exclude_if=lambda value: value is None)
    rest_between_rounds_seconds: int | None = Field(default=None, ge=0, le=7200)
    exercises: list[ExercisePrescription] = Field(default_factory=list, max_length=100)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)


class SourceTextPart(DomainModel):
    location: str = Field(pattern=r"^(caption|transcript|page_text|provided_text|document_text|document_page:[1-9][0-9]?)$")
    text: str = Field(min_length=1, max_length=4000)


class SourceContext(DomainModel):
    source_url: str | None = Field(default=None, max_length=2000)
    parts: list[SourceTextPart] = Field(default_factory=list, max_length=64)
    truncated: bool = False

    @model_validator(mode="after")
    def bounded_text(self):
        if sum(len(part.text) for part in self.parts) > 30_000:
            raise ValueError("Saved source text exceeds 30000 characters")
        return self


class WorkoutContent(DomainModel):
    id: str | None = Field(default=None, max_length=100)
    version: int = Field(default=1, ge=1)
    parent_version_id: str | None = Field(default=None, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["exercise", "accessory", "session", "program"] = "session"
    provenance: Provenance = "user"
    blocks: list[WorkoutBlock] = Field(default_factory=list, max_length=100)
    source_url: str | None = Field(default=None, max_length=2000)
    capture_kind: Literal["url", "text", "images", "document", "shared"] | None = None
    source_creator: str | None = Field(default=None, max_length=200)
    source_title: str | None = Field(default=None, max_length=200)
    source_thumbnail_url: str | None = Field(default=None, max_length=2000)
    source_context: SourceContext | None = Field(default=None, exclude_if=lambda value: value is None)
    cover_origin: Literal["user"] | None = Field(default=None, exclude_if=lambda value: value is None)
    equipment_required: list[str] = Field(default_factory=list, max_length=100)
    equipment_optional: list[str] = Field(default_factory=list, max_length=100)
    estimated_minutes: int | None = Field(default=None, ge=1, le=1440)
    # Sharing whitelists instructions and always removes private notes.
    instructions: list[str] = Field(default_factory=list, max_length=100)
    notes: list[str] = Field(default_factory=list, max_length=100)
    extraction_warnings: list[str] = Field(default_factory=list, max_length=100)

    @model_serializer(mode="wrap")
    def serialize_instructions(self, handler):
        content = handler(self)
        # Legacy snapshots keep their original shape/hash, while an explicit
        # clear must survive persistence and suppress the legacy notes fallback.
        if not self.instructions and "instructions" not in self.model_fields_set:
            content.pop("instructions", None)
        return content


class RunningBaseline(DomainModel):
    novice_start_confirmed: bool = False
    accepted_stage: int = Field(default=0, ge=0, le=8)
    comfortable_walk_minutes: int | None = Field(default=None, ge=0, le=1440)
    comfortable_run_minutes: int | None = Field(default=None, ge=0, le=1440)
    recent_weekly_minutes: int | None = Field(default=None, ge=0, le=10080)
    recent_runs_per_week: int | None = Field(default=None, ge=0, le=14)
    event_distance_km: float | None = Field(default=None, gt=0, le=500)
    event_date: date | None = None


class ActivityContext(DomainModel):
    date: date
    name: str = Field(min_length=1, max_length=200)
    strenuous: bool | None = None
    duration_minutes: int | None = Field(default=None, ge=0, le=1440)
    origin_id: str | None = Field(default=None, max_length=200)


class EquipmentLocation(DomainModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=80)
    equipment: list[str] = Field(default_factory=list, max_length=100)
    available_loads_kg: list[float] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_location(self):
        if not self.name.strip() or any(not item.strip() for item in self.equipment):
            raise ValueError("Equipment location names and equipment cannot be blank")
        if any(load <= 0 or load > 2000 for load in self.available_loads_kg):
            raise ValueError("Location loads must be positive and at most 2000 kg")
        return self


class TrainingProfile(DomainModel):
    adult_confirmed: bool = False
    primary_goal: Goal = "general_fitness"
    secondary_goals: list[Goal] = Field(default_factory=list, max_length=5)
    experience: Literal["new", "returning", "regular"] = "new"
    equipment: list[str] | None = Field(default=None, max_length=100)
    equipment_locations: list[EquipmentLocation] = Field(default_factory=list, max_length=10)
    active_equipment_location_id: str | None = Field(default=None, max_length=100)
    available_days: list[int] = Field(default_factory=list, max_length=7)
    timezone: str = Field(default="Pacific/Guam", min_length=1, max_length=64)
    session_minutes: int | None = Field(default=None, ge=5, le=180)
    age_years: int | None = Field(default=None, ge=18, le=120)
    weight_kg: float | None = Field(default=None, strict=True, gt=0, le=500)
    height_cm: float | None = Field(default=None, strict=True, gt=0, le=300)
    weight_recorded_at: AwareDatetime | None = None
    height_recorded_at: AwareDatetime | None = None
    readiness: Literal["ready", "unknown", "limited"] = "unknown"
    movement_exclusions: list[str] = Field(default_factory=list, max_length=100)
    limitations: list[str] = Field(default_factory=list, max_length=100)
    running_baseline: RunningBaseline | None = None
    other_activities: list[ActivityContext] = Field(default_factory=list, max_length=500)
    body_composition_priority: Literal["maintain", "fat_loss", "muscle_gain"] | None = None
    strength_priority: Literal["strength", "muscle", "both"] | None = None
    activity_focus: str | None = Field(default=None, max_length=200)
    available_loads_kg: list[float] = Field(default_factory=list, max_length=100)
    interrupted: bool = False

    @model_validator(mode="after")
    def validate_profile(self):
        if len({location.id for location in self.equipment_locations}) != len(
            self.equipment_locations
        ):
            raise ValueError("Equipment location identifiers must be unique")
        if self.equipment_locations:
            selected = next(
                (
                    location
                    for location in self.equipment_locations
                    if location.id == self.active_equipment_location_id
                ),
                None,
            )
            if selected is None:
                raise ValueError("Choose the current equipment location")
            self.equipment = selected.equipment
            self.available_loads_kg = selected.available_loads_kg
        elif self.active_equipment_location_id is not None:
            raise ValueError("Current equipment location does not exist")
        if self.weight_recorded_at is not None and self.weight_kg is None:
            raise ValueError("A weight timestamp requires a weight value")
        if self.height_recorded_at is not None and self.height_cm is None:
            raise ValueError("A height timestamp requires a height value")
        if any(day < 0 or day > 6 for day in self.available_days):
            raise ValueError("available_days must use Monday=0 through Sunday=6")
        if len(set(self.available_days)) != len(self.available_days):
            raise ValueError("available_days must not contain duplicates")
        if any(load <= 0 or load > 2000 for load in self.available_loads_kg):
            raise ValueError("available loads must be positive and at most 2000 kg")
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
            raise ValueError("timezone must be an IANA timezone") from exc
        return self


class ScheduledPrescription(DomainModel):
    id: str
    date: date
    purpose: str
    workout: WorkoutContent


class ProgramProposal(DomainModel):
    status: Status
    rule_version: str
    source_ids: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    sessions: list[ScheduledPrescription] = Field(default_factory=list)
    progression_policy: str


class AdaptationProposal(DomainModel):
    status: Status
    rule_version: str
    workout: WorkoutContent | None = None
    questions: list[str] = Field(default_factory=list)
    changes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CompletedExposure(DomainModel):
    session_id: str
    date: date
    exercise_id: str
    reps: list[int] = Field(min_length=1, max_length=100)
    load: float | None = Field(default=None, ge=0, le=2000)
    load_unit: Literal["kg", "lb"] | None = None
    load_convention: Literal["total", "per_hand", "added", "assistance"] | None = None
    completed: bool = False
    difficulty: Literal["easy", "manageable", "hard"] | None = None
    pain_reported: bool | None = None

    @model_validator(mode="after")
    def validate_reps(self):
        if any(rep < 0 or rep > 1000 for rep in self.reps):
            raise ValueError("actual reps must be between 0 and 1000")
        return self


class ProgressionProposal(DomainModel):
    action: Literal["hold", "increase_load", "repeat_stage", "advance_stage", "needs_information"]
    rule_version: str
    reason: str
    suggested_load: float | None = None
    load_unit: Literal["kg", "lb"] | None = None
    suggested_stage: int | None = None
    evidence_session_ids: list[str] = Field(default_factory=list)


class RunningStageResult(DomainModel):
    session_id: str
    date: date
    stage: int = Field(ge=0, le=8)
    completed: bool
    comfortable: bool | None = None
    pain_reported: bool | None = None

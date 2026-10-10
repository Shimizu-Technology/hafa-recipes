"""Quick manual completed activity; no saved-workout prerequisite or AI call."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Response
from pydantic import Field, StrictBool, field_validator, model_validator

from app.domains.workouts.activity_log_service import (
    activity_log_page,
    activity_response,
    change_activity_log,
    create_activity_log,
    owned_activity,
)
from app.domains.workouts.lifecycle import membership_for
from app.domains.workouts.router import Database, Generation, User
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute

router = APIRouter(
    prefix="/api/v1/workouts", tags=["workouts-activity-log"], route_class=WorkoutsRoute
)
Kind = Literal["run", "walk", "basketball", "other"]


class ActivityLogFields(DomainModel):
    kind: Kind
    date: date
    duration_minutes: int = Field(strict=True, ge=1, le=1440)
    name: str | None = Field(default=None, max_length=200)
    strenuous: StrictBool | None = None
    distance_km: float | None = Field(default=None, strict=True, gt=0, le=500)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("date", mode="before")
    @classmethod
    def explicit_date(cls, value):
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("Use an explicit YYYY-MM-DD date")
        return value

    @field_validator("name", "notes")
    @classmethod
    def clean_text(cls, value):
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def supported_distance(self):
        if self.distance_km is not None and self.kind not in {"run", "walk"}:
            raise ValueError(
                "Distance is supported for a run or walk; leave it empty for other activities"
            )
        return self


class ActivityLogCreate(ActivityLogFields):
    request_id: UUID


class ActivityLogCorrection(ActivityLogFields):
    request_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_646)


class ActivityLogRemoval(DomainModel):
    request_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_646)


class ActivityLogContent(DomainModel):
    kind: Kind
    date: date
    name: str
    duration_minutes: int | None
    strenuous: bool | None
    distance_km: float | None
    notes: str | None


class ActivityLogResponse(DomainModel):
    id: UUID
    generation: int
    revision: int
    status: Literal["active", "removed"]
    content: ActivityLogContent | None
    source: Literal["user", "external"]
    read_only: bool
    legacy: bool
    completed_confirmed: bool | None
    origin_id: str | None
    created_at: datetime
    updated_at: datetime


class ActivityLogMutation(ActivityLogResponse):
    profile_revision: int


class ActivityLogPage(DomainModel):
    items: list[ActivityLogResponse]
    has_more: bool
    timezone: str
    today: date
    limit: int
    offset: int


@router.get("/activity-log", response_model=ActivityLogPage)
async def list_completed_activity(
    user: User,
    db: Database,
    generation: Generation,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    from_date: date | None = None,
    to_date: date | None = None,
):
    membership = await membership_for(db, user.id, generation=generation, write=True)
    return await activity_log_page(
        db, user.id, membership.generation, limit, offset, from_date=from_date, to_date=to_date
    )


@router.get("/activity-log/{activity_id}", response_model=ActivityLogResponse)
async def get_completed_activity(
    activity_id: UUID, user: User, db: Database, generation: Generation
):
    membership = await membership_for(db, user.id, generation=generation, write=True)
    entry, projection = await owned_activity(db, user.id, membership.generation, activity_id)
    return activity_response(entry, projection)


async def finish_mutation(db, entry, profile_revision, response, *, changed):
    result = {**activity_response(entry), "profile_revision": profile_revision}
    await db.commit()
    response.headers["ETag"] = f'"{entry.revision}"'
    response.headers["X-Workouts-Revision"] = str(profile_revision)
    if changed:
        from app.domains.workouts.coach import workout_coach

        workout_coach.cancel_owner(entry.app_user_id)
    # Revision/context checks also fence work dispatched by other replicas.
    return result


@router.post("/activity-log", response_model=ActivityLogMutation, status_code=201)
async def log_completed_activity(
    payload: ActivityLogCreate, response: Response, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    entry, changed, profile_revision = await create_activity_log(db, user.id, generation, payload)
    await db.flush()
    return await finish_mutation(db, entry, profile_revision, response, changed=changed)


@router.put("/activity-log/{activity_id}", response_model=ActivityLogMutation)
async def correct_completed_activity(
    activity_id: UUID,
    payload: ActivityLogCorrection,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
):
    await membership_for(db, user.id, generation=generation, write=True)
    entry, changed, profile_revision = await change_activity_log(
        db, user.id, generation, activity_id, payload
    )
    await db.flush()
    return await finish_mutation(db, entry, profile_revision, response, changed=changed)


@router.delete("/activity-log/{activity_id}", response_model=ActivityLogMutation)
async def remove_completed_activity(
    activity_id: UUID,
    payload: ActivityLogRemoval,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
):
    await membership_for(db, user.id, generation=generation, write=True)
    entry, changed, profile_revision = await change_activity_log(
        db, user.id, generation, activity_id, payload, remove=True
    )
    await db.flush()
    return await finish_mutation(db, entry, profile_revision, response, changed=changed)

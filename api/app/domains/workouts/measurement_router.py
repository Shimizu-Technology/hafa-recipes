"""Private, explicit self-reported weight/height history without inferred targets."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Response
from pydantic import AwareDatetime, Field, StrictBool, field_validator
from sqlalchemy import func, select

from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.measurement_models import (
    WorkoutsMeasurement,
    WorkoutsMeasurementOperation,
)
from app.domains.workouts.measurement_service import (
    apply_current,
    canonical_measurement,
    checked_profile,
    clear_selected,
    current_measurement_ids,
    measurement_response,
    measurement_time,
    operation_hash,
    owned_measurement,
    replay_operation,
    reset_measurement_context,
)
from app.domains.workouts.models import WorkoutsProfile
from app.domains.workouts.router import Database, Generation, User, expected_profile_revision
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute

router = APIRouter(
    prefix="/api/v1/workouts", tags=["workouts-measurements"], route_class=WorkoutsRoute
)
ProfileMatch = Annotated[str | None, Header(alias="If-Match")]


class MeasurementTime(DomainModel):
    recorded_at: AwareDatetime

    @field_validator("recorded_at", mode="before")
    @classmethod
    def explicit_time(cls, value):
        if not isinstance(value, str):
            raise ValueError("recorded_at must be an explicit ISO time with timezone")
        return value


class MeasurementCreate(MeasurementTime):
    request_id: UUID
    kind: Literal["weight", "height"]
    value: float = Field(strict=True, gt=0)
    unit: Literal["kg", "lb", "cm", "in"]
    recorded_at: AwareDatetime
    source: Literal["user"]
    update_current: StrictBool = True


class MeasurementCorrection(MeasurementTime):
    request_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    value: float = Field(strict=True, gt=0)
    unit: Literal["kg", "lb", "cm", "in"]
    recorded_at: AwareDatetime
    source: Literal["user"]
    update_current: StrictBool = False


class MeasurementRemoval(DomainModel):
    request_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)


async def mutation_result(db, entry, applied, response, *, context_reset=False):
    profile = await db.get(WorkoutsProfile, entry.app_user_id)
    revision = profile.revision if profile else 0
    response.headers["X-Workouts-Revision"] = str(revision)
    response.headers["ETag"] = f'"{revision}"'
    response.headers["Cache-Control"] = "no-store"
    return {
        "measurement": measurement_response(
            entry,
            is_current=entry.id
            in await current_measurement_ids(db, entry.app_user_id, entry.generation),
        ),
        "profile_revision": revision,
        "current_applied": applied,
        "profile": profile.content if profile else None,
        "context_reset": context_reset,
    }


async def replay_result(db, operation, response):
    entry = await owned_measurement(
        db, operation.app_user_id, operation.generation, operation.measurement_id
    )
    if operation.action != "remove" and entry.status == "removed":
        raise HTTPException(410, "The measurement was removed; old requests cannot recreate it")
    response.status_code = 200
    return await mutation_result(
        db,
        entry,
        operation.current_applied,
        response,
        context_reset=operation.action in {"correct", "remove"},
    )


def add_operation(db, owner, generation, payload, digest, action, entry, applied):
    db.add(
        WorkoutsMeasurementOperation(
            app_user_id=owner,
            generation=generation,
            request_id=payload.request_id,
            request_hash=digest,
            action=action,
            measurement_id=entry.id,
            current_applied=applied,
        )
    )


@router.post("/measurements", status_code=201)
async def create_measurement(
    payload: MeasurementCreate,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
    if_match: ProfileMatch = None,
):
    expected = expected_profile_revision(if_match)
    await membership_for(db, user.id, generation=generation, write=True)
    digest = operation_hash("create", None, payload.model_dump(mode="json"))
    replay = await replay_operation(db, user.id, generation, payload.request_id, digest)
    if replay:
        return await replay_result(db, replay, response)
    profile = await checked_profile(db, user.id, generation, expected)
    value = canonical_measurement(payload.kind, payload.value, payload.unit)
    entry = WorkoutsMeasurement(
        id=uuid4(),
        app_user_id=user.id,
        generation=generation,
        revision=1,
        kind=payload.kind,
        source="user",
        status="active",
        value=payload.value,
        unit=payload.unit,
        canonical_value=value,
        recorded_at=measurement_time(payload.recorded_at),
    )
    db.add(entry)
    await db.flush()
    profile, applied = await apply_current(
        db, user.id, generation, entry, profile, requested=payload.update_current
    )
    add_operation(db, user.id, generation, payload, digest, "create", entry, applied)
    await db.flush()
    result = await mutation_result(db, entry, applied, response)
    await db.commit()
    return result


@router.put("/measurements/{measurement_id}")
async def correct_measurement(
    measurement_id: UUID,
    payload: MeasurementCorrection,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
    if_match: ProfileMatch = None,
):
    expected = expected_profile_revision(if_match)
    await membership_for(db, user.id, generation=generation, write=True)
    digest = operation_hash("correct", measurement_id, payload.model_dump(mode="json"))
    replay = await replay_operation(db, user.id, generation, payload.request_id, digest)
    if replay:
        return await replay_result(db, replay, response)
    profile = await checked_profile(db, user.id, generation, expected)
    entry = await owned_measurement(db, user.id, generation, measurement_id)
    if entry.status == "removed":
        raise HTTPException(410, "Removed measurements cannot be corrected")
    if entry.revision != payload.expected_revision:
        raise HTTPException(409, "Measurement changed; refresh before correcting")
    entry.value, entry.unit = payload.value, payload.unit
    entry.canonical_value = canonical_measurement(entry.kind, payload.value, payload.unit)
    entry.recorded_at, entry.updated_at = measurement_time(payload.recorded_at), now()
    entry.revision += 1
    profile, applied = await apply_current(
        db, user.id, generation, entry, profile, requested=payload.update_current, correction=True
    )
    if profile and not applied:
        profile.revision += 1
        profile.updated_at = now()
    await reset_measurement_context(db, user.id, generation)
    add_operation(db, user.id, generation, payload, digest, "correct", entry, applied)
    await db.flush()
    result = await mutation_result(db, entry, applied, response, context_reset=True)
    await db.commit()
    return result


@router.post("/measurements/{measurement_id}/remove")
async def remove_measurement(
    measurement_id: UUID,
    payload: MeasurementRemoval,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
    if_match: ProfileMatch = None,
):
    expected = expected_profile_revision(if_match)
    await membership_for(db, user.id, generation=generation, write=True)
    digest = operation_hash("remove", measurement_id, payload.model_dump(mode="json"))
    replay = await replay_operation(db, user.id, generation, payload.request_id, digest)
    if replay:
        return await replay_result(db, replay, response)
    profile = await checked_profile(db, user.id, generation, expected)
    entry = await owned_measurement(db, user.id, generation, measurement_id)
    if entry.status == "removed":
        raise HTTPException(410, "Measurement already removed")
    if entry.revision != payload.expected_revision:
        raise HTTPException(409, "Measurement changed; refresh before removing")
    applied = await clear_selected(db, user.id, generation, entry, profile)
    if profile:
        profile.revision += 1
        profile.updated_at = now()
    entry.status = "removed"
    entry.value = entry.unit = entry.canonical_value = entry.recorded_at = None
    entry.revision += 1
    entry.updated_at = now()
    await reset_measurement_context(db, user.id, generation)
    add_operation(db, user.id, generation, payload, digest, "remove", entry, applied)
    await db.flush()
    result = await mutation_result(db, entry, applied, response, context_reset=True)
    await db.commit()
    return result


async def measurement_page(
    db, owner, generation, kind, include_deleted, start_at, end_at, limit, offset
):
    conditions = [
        WorkoutsMeasurement.app_user_id == owner,
        WorkoutsMeasurement.generation == generation,
    ]
    if kind:
        conditions.append(WorkoutsMeasurement.kind == kind)
    if not include_deleted:
        conditions.append(WorkoutsMeasurement.status == "active")
    if start_at and end_at and start_at > end_at:
        raise HTTPException(422, "Measurement date range is reversed")
    if start_at:
        conditions.append(WorkoutsMeasurement.recorded_at >= start_at)
    if end_at:
        conditions.append(WorkoutsMeasurement.recorded_at <= end_at)
    total = await db.scalar(
        select(func.count()).select_from(WorkoutsMeasurement).where(*conditions)
    )
    rows = (
        await db.scalars(
            select(WorkoutsMeasurement)
            .where(*conditions)
            .order_by(
                WorkoutsMeasurement.recorded_at.desc().nulls_last(), WorkoutsMeasurement.id.desc()
            )
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    current = await current_measurement_ids(db, owner, generation)
    return {
        "items": [measurement_response(row, is_current=row.id in current) for row in rows[:limit]],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": len(rows) > limit,
    }


@router.get("/measurements")
async def list_measurements(
    user: User,
    db: Database,
    generation: Generation,
    kind: Literal["weight", "height"] | None = None,
    include_deleted: bool = False,
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=1_000_000),
):
    await membership_for(db, user.id, generation=generation)
    return await measurement_page(
        db, user.id, generation, kind, include_deleted, None, None, limit, offset
    )


@router.get("/measurements/trends")
async def measurement_trends(
    user: User,
    db: Database,
    generation: Generation,
    kind: Literal["weight", "height"],
    start_at: AwareDatetime | None = None,
    end_at: AwareDatetime | None = None,
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=1_000_000),
):
    await membership_for(db, user.id, generation=generation)
    return await measurement_page(
        db, user.id, generation, kind, False, start_at, end_at, limit, offset
    )


@router.get("/measurements/{measurement_id}")
async def get_measurement(measurement_id: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation)
    entry = await owned_measurement(db, user.id, generation, measurement_id)
    return measurement_response(
        entry, is_current=entry.id in await current_measurement_ids(db, user.id, generation)
    )

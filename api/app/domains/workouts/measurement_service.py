"""Unit normalization, chronological current values, and profile integration hooks."""

import hashlib
import json
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from fastapi import HTTPException
from pydantic import AwareDatetime, TypeAdapter
from sqlalchemy import delete, or_, select, text, update

from app.domains.workouts.lifecycle import now
from app.domains.workouts.measurement_models import (
    MEASUREMENT_TABLES,
    WorkoutsMeasurement,
    WorkoutsMeasurementCurrent,
    WorkoutsMeasurementOperation,
)
from app.domains.workouts.models import WorkoutsProfile

FIELDS = {
    "weight": ("weight_kg", "weight_recorded_at", "kg"),
    "height": ("height_cm", "height_recorded_at", "cm"),
}
DATE_ADAPTER = TypeAdapter(AwareDatetime)


def canonical_measurement(kind, value, unit):
    if (kind, unit) not in {("weight", "kg"), ("weight", "lb"), ("height", "cm"), ("height", "in")}:
        raise HTTPException(422, "Measurement unit does not match its kind")
    try:
        number = Decimal(str(value))
        canonical = (
            number
            * {
                "kg": Decimal(1),
                "lb": Decimal("0.45359237"),
                "cm": Decimal(1),
                "in": Decimal("2.54"),
            }[unit]
        )
        maximum = 500 if kind == "weight" else 300
        if not canonical.is_finite() or canonical <= 0 or canonical > maximum:
            raise ValueError()
        rounded = canonical.quantize(Decimal("0.000001"))
        if rounded <= 0:
            raise ValueError()
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise HTTPException(422, "Measurement is outside the supported positive range") from exc
    return float(rounded)


def measurement_time(value):
    try:
        timestamp = DATE_ADAPTER.validate_python(value)
    except ValueError as exc:
        raise HTTPException(422, "An explicit time with timezone is required") from exc
    if timestamp.year < 1900 or timestamp > now() + timedelta(minutes=5):
        raise HTTPException(422, "Use a recorded time from 1900 through the present")
    return timestamp


async def checked_profile(db, owner, generation, expected_revision):
    profile = await db.get(WorkoutsProfile, owner, populate_existing=True)
    if profile and profile.generation != generation:
        raise HTTPException(409, "Profile generation changed")
    if (profile.revision if profile else 0) != expected_revision:
        raise HTTPException(409, "Profile changed; refresh before saving measurements")
    return profile


async def current_state(db, owner, generation, kind):
    state = await db.get(WorkoutsMeasurementCurrent, (owner, kind))
    if state and state.generation != generation:
        raise HTTPException(409, "Measurement generation changed")
    if state is None:
        state = WorkoutsMeasurementCurrent(app_user_id=owner, generation=generation, kind=kind)
        db.add(state)
    return state


async def reset_measurement_context(db, owner, generation):
    """Clear saved AI context and pending derivatives; never alter recorded actuals.

    Call under the owner lock. Advancing profile revision fences in-flight calls.
    The optional 035 tables may be absent in a supported migration-only test.
    """
    if await db.scalar(text("SELECT to_regclass('public.workouts_coach_messages') IS NOT NULL")):
        from app.domains.workouts.automation_models import WorkoutCoachMessage, WorkoutProposal

        await db.execute(
            delete(WorkoutCoachMessage).where(
                WorkoutCoachMessage.app_user_id == owner,
                WorkoutCoachMessage.generation == generation,
            )
        )
        await db.execute(
            delete(WorkoutProposal).where(
                WorkoutProposal.app_user_id == owner,
                WorkoutProposal.generation == generation,
                or_(WorkoutProposal.accepted_at.is_(None), WorkoutProposal.kind == "profile"),
            )
        )
        # Acceptance preserves training records, not a stale copy of the profile
        # or model context. Keep only the content-free acceptance reference.
        await db.execute(
            update(WorkoutProposal)
            .where(
                WorkoutProposal.app_user_id == owner,
                WorkoutProposal.generation == generation,
                WorkoutProposal.accepted_at.is_not(None),
            )
            .values(
                content={"status": "unsupported", "questions": ["Saved AI context was cleared."]},
                source_versions=[],
                context_hash="0" * 64,
            )
        )


async def apply_current(db, owner, generation, entry, profile, *, requested=True, correction=False):
    if not requested and not correction:
        return profile, False
    state = await current_state(db, owner, generation, entry.kind)
    field, timestamp_field, _ = FIELDS[entry.kind]
    content = dict(profile.content) if profile else {"adult_confirmed": True}
    selected = state.measurement_id == entry.id
    prior_time = content.get(timestamp_field)
    prior_time = measurement_time(prior_time) if prior_time else None
    newer = not prior_time or entry.recorded_at > prior_time
    if state.cleared_at and entry.recorded_at <= state.cleared_at:
        newer = False
    if not selected and (not requested or not newer):
        return profile, False
    state.measurement_id, state.cleared_at = entry.id, None
    content[field], content[timestamp_field] = entry.canonical_value, entry.recorded_at.isoformat()
    if profile is None:
        # Root TrainingProfile applies other defaults on read; no health inference.
        from app.domains.workouts.schemas import TrainingProfile

        content = {**TrainingProfile(adult_confirmed=True).model_dump(mode="json"), **content}
        profile = WorkoutsProfile(
            app_user_id=owner, generation=generation, revision=1, content=content
        )
        db.add(profile)
    else:
        profile.content = content
        profile.revision += 1
        profile.updated_at = now()
    return profile, True


async def clear_selected(db, owner, generation, entry, profile):
    state = await current_state(db, owner, generation, entry.kind)
    if state.measurement_id != entry.id:
        return False
    state.measurement_id, state.cleared_at = None, now()
    if profile:
        field, timestamp_field, _ = FIELDS[entry.kind]
        profile.content = {**profile.content, field: None, timestamp_field: None}
    return True


async def reconcile_profile_measurements(db, owner, generation, previous_content, proposed_content):
    """Root invokes inside owner-locked, revision-checked PUT /profile before save.

    Returns normalized content. Root schema adds optional aware timestamp fields.
    Changed non-null values require an explicit paired timestamp. Unchanged
    values keep their stored timestamp regardless of a client's repeated time.
    Clearing current retains history and establishes a backfill selection fence.
    """
    previous, normalized = previous_content or {}, dict(proposed_content)
    reset = False
    for kind, (field, timestamp_field, unit) in FIELDS.items():
        value = normalized.get(field)
        value = canonical_measurement(kind, value, unit) if value is not None else None
        old = previous.get(field)
        old = canonical_measurement(kind, old, unit) if old is not None else None
        normalized[field] = value
        if value is None and normalized.get(timestamp_field) is not None:
            raise HTTPException(422, "A measurement timestamp requires its value")
        if value == old:
            normalized[timestamp_field] = previous.get(timestamp_field)
            continue
        reset = True
        state = await current_state(db, owner, generation, kind)
        if value is None:
            state.measurement_id, state.cleared_at = None, now()
            normalized[timestamp_field] = None
            continue
        timestamp = measurement_time(normalized.get(timestamp_field))
        prior_time = previous.get(timestamp_field)
        if (prior_time and timestamp < measurement_time(prior_time)) or (
            state.cleared_at and timestamp <= state.cleared_at
        ):
            raise HTTPException(
                422, "Add older measurements to history instead of replacing current profile data"
            )
        entry = WorkoutsMeasurement(
            id=uuid4(),
            app_user_id=owner,
            generation=generation,
            revision=1,
            kind=kind,
            source="user",
            status="active",
            value=value,
            unit=unit,
            canonical_value=value,
            recorded_at=timestamp,
        )
        db.add(entry)
        await db.flush()
        state.measurement_id, state.cleared_at = entry.id, None
        normalized[timestamp_field] = timestamp.isoformat()
    if reset:
        await reset_measurement_context(db, owner, generation)
    return normalized


def measurement_response(entry, *, is_current=False):
    return {
        "id": str(entry.id),
        "is_current": is_current,
        "generation": entry.generation,
        "revision": entry.revision,
        "kind": entry.kind,
        "source": entry.source,
        "status": entry.status,
        "value": entry.value,
        "unit": entry.unit,
        "canonical_value": entry.canonical_value,
        "canonical_unit": FIELDS[entry.kind][2] if entry.status == "active" else None,
        "recorded_at": entry.recorded_at,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


def operation_hash(action, identifier, payload):
    return hashlib.sha256(
        json.dumps(
            [action, str(identifier) if identifier else None, payload], sort_keys=True
        ).encode()
    ).hexdigest()


async def replay_operation(db, owner, generation, request_id, digest):
    operation = await db.scalar(
        select(WorkoutsMeasurementOperation).where(
            WorkoutsMeasurementOperation.app_user_id == owner,
            WorkoutsMeasurementOperation.generation == generation,
            WorkoutsMeasurementOperation.request_id == request_id,
        )
    )
    if operation and operation.request_hash != digest:
        raise HTTPException(409, "Measurement request ID already has different details")
    return operation


async def owned_measurement(db, owner, generation, identifier):
    entry = await db.scalar(
        select(WorkoutsMeasurement).where(
            WorkoutsMeasurement.id == identifier,
            WorkoutsMeasurement.app_user_id == owner,
            WorkoutsMeasurement.generation == generation,
        )
    )
    if entry is None:
        raise HTTPException(404, "Measurement not found")
    return entry


async def current_measurement_ids(db, owner, generation):
    return set(
        (
            await db.scalars(
                select(WorkoutsMeasurementCurrent.measurement_id).where(
                    WorkoutsMeasurementCurrent.app_user_id == owner,
                    WorkoutsMeasurementCurrent.generation == generation,
                    WorkoutsMeasurementCurrent.measurement_id.is_not(None),
                )
            )
        ).all()
    )


async def current_measurement_context(db, owner, generation):
    """Minimal active selections only; never automatically send historical values."""
    rows = (
        await db.scalars(
            select(WorkoutsMeasurement)
            .join(
                WorkoutsMeasurementCurrent,
                (WorkoutsMeasurementCurrent.measurement_id == WorkoutsMeasurement.id)
                & (WorkoutsMeasurementCurrent.app_user_id == owner)
                & (WorkoutsMeasurementCurrent.generation == generation)
                & (WorkoutsMeasurementCurrent.kind == WorkoutsMeasurement.kind),
            )
            .where(
                WorkoutsMeasurement.app_user_id == owner,
                WorkoutsMeasurement.generation == generation,
                WorkoutsMeasurement.status == "active",
            )
            .order_by(WorkoutsMeasurement.kind)
        )
    ).all()
    return [
        {
            "kind": row.kind,
            "value": row.canonical_value,
            "unit": FIELDS[row.kind][2],
            "recorded_at": row.recorded_at,
            "source": "user",
        }
        for row in rows
    ]


async def erase_measurements(db, owner):
    for model in (WorkoutsMeasurementOperation, WorkoutsMeasurementCurrent, WorkoutsMeasurement):
        await db.execute(delete(model).where(model.app_user_id == owner))


async def measurement_export_page(db, owner, generation, *, limit=50, offset=0):
    if not 1 <= limit <= 50 or not 0 <= offset <= 1_000_000:
        raise ValueError("Invalid measurement export page")
    rows = (
        await db.scalars(
            select(WorkoutsMeasurement)
            .where(
                WorkoutsMeasurement.app_user_id == owner,
                WorkoutsMeasurement.generation == generation,
            )
            .order_by(WorkoutsMeasurement.created_at, WorkoutsMeasurement.id)
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    current = await current_measurement_ids(db, owner, generation)
    return {
        "items": [measurement_response(row, is_current=row.id in current) for row in rows[:limit]],
        "has_more": len(rows) > limit,
    }


async def verify_measurement_schema(engine, settings):
    if not settings.workouts_api_enabled:
        return
    async with engine.connect() as connection:
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=39)")
        ):
            raise RuntimeError("Workouts measurement migration039 is required")
        for table in MEASUREMENT_TABLES:
            if not await connection.scalar(
                text("SELECT to_regclass(:table) IS NOT NULL"), {"table": "public." + table.name}
            ):
                raise RuntimeError(f"Missing Workouts measurement table: {table.name}")
            owner_fk = await connection.scalar(
                text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
                WHERE conrelid=CAST(:table AS regclass) AND contype='f'
                AND confrelid='public.app_users'::regclass AND confdeltype='c')"""),
                {"table": "public." + table.name},
            )
            if not owner_fk:
                raise RuntimeError(f"Missing Workouts measurement owner cascade: {table.name}")
            columns = set(
                (
                    await connection.execute(
                        text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name=:name
            """),
                        {"name": table.name},
                    )
                ).scalars()
            )
            if not set(table.columns.keys()) <= columns:
                raise RuntimeError(f"Incomplete Workouts measurement table: {table.name}")
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
            WHERE conrelid='public.workouts_measurement_current'::regclass
            AND confrelid='public.workouts_measurements'::regclass AND contype='f'
            AND array_length(conkey,1)=4 AND confdeltype='c')""")
        ):
            raise RuntimeError("Missing current measurement ownership fence")
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_trigger
            WHERE tgrelid='public.workouts_measurement_operations'::regclass
            AND tgname='immutable_workouts_measurement_operation'
            AND tgfoid='public.prevent_workouts_snapshot_update'::regproc
            AND tgenabled IN ('O','A') AND NOT tgisinternal)""")
        ):
            raise RuntimeError("Missing immutable Workouts measurement operation trigger")

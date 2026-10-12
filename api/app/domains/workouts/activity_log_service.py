"""Owner-locked manual observations, without fictional exercise prescriptions."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.domains.workouts.export_context import SnapshotSourceContext

from datetime import timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.domains.workouts.activity_log_models import (
    ACTIVITY_LOG_TABLES,
    WorkoutsActivityLog,
    WorkoutsActivityLogOperation,
)
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import WorkoutsActivity, WorkoutsProfile
from app.domains.workouts.router import content_digest
from app.domains.workouts.schemas import ActivityContext, TrainingProfile

HISTORY_DAYS = 3650  # Product storage/input bound, not a training recommendation.
NAMES = {"run": "Run", "walk": "Walk", "basketball": "Basketball", "other": "Other activity"}


def external_activity(content):
    from app.domains.workouts.coach_actions import health_derived

    return content.get("origin_id") is not None or health_derived(content)


async def activity_calendar(db, owner, generation):
    profile = await db.get(WorkoutsProfile, owner, populate_existing=True)
    if profile and profile.generation != generation:
        raise HTTPException(409, "Training profile changed; refresh before logging")
    timezone = (profile.content.get("timezone") if profile else None) or TrainingProfile(
        adult_confirmed=True
    ).timezone
    try:
        today = now().astimezone(ZoneInfo(timezone)).date()
    except (ValueError, TypeError, KeyError):
        raise HTTPException(409, "Review your training timezone before logging activity") from None
    return profile, timezone, today


def validate_completed_date(value, today):
    if not today - timedelta(days=HISTORY_DAYS) <= value <= today:
        raise HTTPException(
            422,
            "Use a completed activity date within the past ten years through today in your training timezone",
        )


def normalized_content(payload):
    content = payload.model_dump(mode="json", exclude={"request_id", "expected_revision"})
    content["name"] = content.get("name") or NAMES[content["kind"]]
    return content


def projection_content(content):
    return ActivityContext(
        date=content["date"],
        name=content["name"],
        duration_minutes=content["duration_minutes"],
        strenuous=content["strenuous"],
        origin_id=None,
    ).model_dump(mode="json")


async def touch_training_context(db, owner, generation):
    # Existing proposal hashes use profile revision and activity ID/created_at.
    # Keep original capture time intact and advance a profile context epoch.
    profile = await db.get(WorkoutsProfile, owner, populate_existing=True)
    if profile:
        if profile.generation != generation:
            raise HTTPException(409, "Training profile changed; refresh before logging")
        profile.revision += 1
        profile.updated_at = now()
        return profile.revision
    return 0


async def owned_activity(db, owner, generation, identifier):
    entry = await db.scalar(
        select(WorkoutsActivityLog).where(
            WorkoutsActivityLog.id == identifier,
            WorkoutsActivityLog.app_user_id == owner,
            WorkoutsActivityLog.generation == generation,
        )
    )
    if entry:
        if entry.status == "removed":
            return entry, None
        projection = await db.scalar(
            select(WorkoutsActivity).where(
                WorkoutsActivity.id == entry.activity_id,
                WorkoutsActivity.app_user_id == owner,
                WorkoutsActivity.generation == generation,
            )
        )
        if projection is None:
            raise HTTPException(409, "Activity provenance changed; refresh before editing")
        return entry, projection
    projection = await db.scalar(
        select(WorkoutsActivity).where(
            WorkoutsActivity.id == identifier,
            WorkoutsActivity.app_user_id == owner,
            WorkoutsActivity.generation == generation,
        )
    )
    if projection is None:
        raise HTTPException(404, "Activity not found")
    return None, projection


def legacy_content(projection):
    value = projection.content
    return {
        "kind": "other",
        "name": value.get("name") or "Existing activity",
        "date": value.get("date"),
        "duration_minutes": value.get("duration_minutes"),
        "strenuous": value.get("strenuous"),
        "distance_km": None,
        "notes": None,
    }


def activity_response(entry=None, projection=None):
    if entry and projection and external_activity(projection.content):
        result = activity_response(None, projection)
        result["revision"] = entry.revision
        return result
    if entry:
        return {
            "id": entry.id,
            "generation": entry.generation,
            "revision": entry.revision,
            "status": entry.status,
            "content": entry.content,
            "source": "user",
            "read_only": False,
            "legacy": False,
            "completed_confirmed": True if entry.status == "active" else None,
            "origin_id": None,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
        }
    external = external_activity(projection.content)
    return {
        "id": projection.id,
        "generation": projection.generation,
        "revision": 1,
        "status": "active",
        "content": legacy_content(projection),
        "source": "external" if external else "user",
        "read_only": external,
        "legacy": True,
        "completed_confirmed": None,
        "origin_id": projection.content.get("origin_id"),
        "created_at": projection.created_at,
        "updated_at": projection.created_at,
    }


async def operation_replay(db, owner, generation, request_id, digest):
    operation = await db.get(
        WorkoutsActivityLogOperation, (owner, generation, request_id), populate_existing=True
    )
    if operation is None:
        return None
    if operation.request_hash != digest:
        raise HTTPException(
            409, "Activity request identity was used for different content or action"
        )
    entry, projection = await owned_activity(db, owner, generation, operation.activity_id)
    if projection and external_activity(projection.content):
        raise HTTPException(409, "Activity provenance changed; refresh before retrying")
    if entry.status == "removed" and operation.action != "remove":
        raise HTTPException(410, "This activity was removed; old requests cannot recreate it")
    if entry.revision != operation.after_revision:
        raise HTTPException(
            409, "This activity changed after that request; refresh its current version"
        )
    return entry, operation.after_profile_revision


def add_operation(db, owner, generation, payload, digest, action, entry, profile_revision):
    db.add(
        WorkoutsActivityLogOperation(
            app_user_id=owner,
            generation=generation,
            request_id=payload.request_id,
            request_hash=digest,
            action=action,
            activity_id=entry.id,
            after_revision=entry.revision,
            after_profile_revision=profile_revision,
        )
    )


async def create_activity_log(db, owner, generation, payload):
    digest = content_digest({"action": "create", "payload": payload.model_dump(mode="json")})
    replay = await operation_replay(db, owner, generation, payload.request_id, digest)
    if replay:
        return replay[0], False, replay[1]
    _, _, today = await activity_calendar(db, owner, generation)
    validate_completed_date(payload.date, today)
    content = normalized_content(payload)
    identifier, current = uuid4(), now()
    projection = WorkoutsActivity(
        id=identifier,
        app_user_id=owner,
        generation=generation,
        content=projection_content(content),
        created_at=current,
    )
    db.add(projection)
    await db.flush()
    entry = WorkoutsActivityLog(
        id=identifier,
        app_user_id=owner,
        generation=generation,
        activity_id=identifier,
        revision=1,
        status="active",
        content=content,
        created_at=current,
        updated_at=current,
    )
    db.add(entry)
    await db.flush()
    profile_revision = await touch_training_context(db, owner, generation)
    add_operation(db, owner, generation, payload, digest, "create", entry, profile_revision)
    return entry, True, profile_revision


async def change_activity_log(db, owner, generation, identifier, payload, *, remove=False):
    action = "remove" if remove else "correct"
    digest = content_digest(
        {"action": action, "id": str(identifier), "payload": payload.model_dump(mode="json")}
    )
    replay = await operation_replay(db, owner, generation, payload.request_id, digest)
    if replay:
        return replay[0], False, replay[1]
    entry, projection = await owned_activity(db, owner, generation, identifier)
    if projection and external_activity(projection.content):
        raise HTTPException(
            403,
            "Imported activities are read-only here; manage the original or disconnect its Health connection",
        )
    if entry and entry.status == "removed":
        raise HTTPException(410, "This activity was removed")
    if (entry.revision if entry else 1) != payload.expected_revision:
        raise HTTPException(409, "Activity changed; refresh before correcting or removing")
    if not remove:
        _, _, today = await activity_calendar(db, owner, generation)
        validate_completed_date(payload.date, today)
    from app.domains.workouts.export_service import invalidate_export_snapshots

    await invalidate_export_snapshots(db, owner, generation)
    if entry is None:
        entry = WorkoutsActivityLog(
            id=projection.id,
            app_user_id=owner,
            generation=generation,
            activity_id=projection.id,
            revision=1,
            status="active",
            content=legacy_content(projection),
            created_at=projection.created_at,
            updated_at=now(),
        )
        db.add(entry)
        await db.flush()
    entry.revision += 1
    entry.updated_at = now()
    if remove:
        entry.status, entry.content, entry.activity_id = "removed", None, None
        await db.flush()
        await db.execute(
            delete(WorkoutsActivity).where(
                WorkoutsActivity.id == identifier,
                WorkoutsActivity.app_user_id == owner,
                WorkoutsActivity.generation == generation,
            )
        )
    else:
        entry.content = normalized_content(payload)
        projection = projection or await db.get(
            WorkoutsActivity, entry.activity_id, populate_existing=True
        )
        if projection is None or external_activity(projection.content):
            raise HTTPException(409, "Activity provenance changed; refresh before editing")
        projection.content = projection_content(entry.content)
    profile_revision = await touch_training_context(db, owner, generation)
    add_operation(db, owner, generation, payload, digest, action, entry, profile_revision)
    return entry, True, profile_revision


async def activity_log_page(
    db, owner, generation, limit=20, offset=0, *, from_date=None, to_date=None
):
    _, timezone, today = await activity_calendar(db, owner, generation)
    start = from_date or today - timedelta(days=HISTORY_DAYS)
    end = to_date or today
    if start > end or start < today - timedelta(days=HISTORY_DAYS) or end > today:
        raise HTTPException(
            422, "Activity history must stay within the supported completed-date range"
        )
    rows = (
        await db.execute(
            select(WorkoutsActivity, WorkoutsActivityLog)
            .outerjoin(WorkoutsActivityLog, WorkoutsActivityLog.activity_id == WorkoutsActivity.id)
            .where(
                WorkoutsActivity.app_user_id == owner,
                WorkoutsActivity.generation == generation,
                WorkoutsActivity.content["date"].as_string() >= start.isoformat(),
                WorkoutsActivity.content["date"].as_string() <= end.isoformat(),
            )
            .order_by(
                WorkoutsActivity.content["date"].as_string().desc(),
                WorkoutsActivity.created_at.desc(),
                WorkoutsActivity.id.desc(),
            )
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    return {
        "items": [activity_response(entry, projection) for projection, entry in rows[:limit]],
        "has_more": len(rows) > limit,
        "timezone": timezone,
        "today": today,
        "offset": offset,
        "limit": limit,
    }


async def erase_activity_logs(db, owner):
    # Root calls before deleting WorkoutsActivity projections. This also erases
    # removed tombstones with no remaining projection; operations cascade.
    await db.execute(delete(WorkoutsActivityLog).where(WorkoutsActivityLog.app_user_id == owner))


async def export_activity_logs(
    db, owner, generation, limit, offset, *, source_context: "SnapshotSourceContext | None" = None
):
    if source_context is not None:
        source_context.require_guard(db, owner, generation, limit, offset)
    rows = (
        []
        if source_context is not None
        and not source_context.should_fetch("completed_activity_log", offset)
        else (
            await db.scalars(
                select(WorkoutsActivityLog)
                .where(
                    WorkoutsActivityLog.app_user_id == owner,
                    WorkoutsActivityLog.generation == generation,
                )
                .order_by(WorkoutsActivityLog.created_at, WorkoutsActivityLog.id)
                .limit(limit + 1)
                .offset(offset)
            )
        ).all()
    )
    return {
        "items": [activity_response(row) for row in rows[:limit]],
        "has_more": len(rows) > limit,
    }


async def verify_activity_log_schema(engine, settings):
    if not settings.workouts_api_enabled:
        return
    async with engine.connect() as connection:
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=44)")
        ):
            raise RuntimeError("Workouts activity-log migration044 is required")
        for table in ACTIVITY_LOG_TABLES:
            columns = set(
                (
                    await connection.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:name"
                        ),
                        {"name": table.name},
                    )
                ).scalars()
            )
            if columns != set(table.columns.keys()):
                raise RuntimeError("Workouts activity-log schema is incomplete")
            if not await connection.scalar(
                text(
                    "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=CAST(:table AS regclass) AND contype='f' AND confrelid='public.app_users'::regclass AND confdeltype='c' AND convalidated)"
                ),
                {"table": "public." + table.name},
            ):
                raise RuntimeError("Workouts activity-log owner cascade is missing")
        if not await connection.scalar(
            text(
                "SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.workouts_activity_log_operations'::regclass AND tgname='immutable_workouts_activity_log_operation' AND tgfoid='public.prevent_workouts_snapshot_update'::regproc AND tgenabled IN ('O','A') AND NOT tgisinternal)"
            )
        ):
            raise RuntimeError("Immutable activity-log operation protection is missing")

        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_trigger
            WHERE tgrelid='public.workouts_activity_log'::regclass
            AND tgname='immutable_workouts_activity_log_identity'
            AND tgfoid='public.protect_workouts_activity_log_identity'::regproc
            AND tgenabled IN ('O','A') AND NOT tgisinternal)
            AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.workouts_activity_log_operations'::regclass
            AND confrelid='public.workouts_activity_log'::regclass AND contype='f'
            AND array_length(conkey,1)=3 AND confdeltype='c' AND convalidated)""")
        ):
            raise RuntimeError("Activity-log capture identity/receipt ownership fence is missing")

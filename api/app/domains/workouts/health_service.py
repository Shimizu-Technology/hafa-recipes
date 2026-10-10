"""Health persistence requires fresh membership, granular grants and owner locks."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, exists, select

from app.domains.workouts.health_models import (
    HealthConnection,
    HealthExportIntent,
    HealthObservation,
    HealthSyncReceipt,
)
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import (
    WorkoutsActivity,
    WorkoutsConsent,
    WorkoutsGrant,
    WorkoutsProfile,
    WorkoutsSession,
)

APP_ID = "com.shimizutechnology.hafaworkouts"
SYNC_PREFIX = "hafa-workouts:"
READ_SCOPE = "health_activity_read"
WRITE_SCOPE = "health_activity_write"
AI_SCOPE = "ai_health_context"


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def health_activity_exclusion_clause(user_id, generation):
    """Apply to WorkoutsActivity queries feeding AI; current origins are unreviewed."""
    return ~exists().where(
        HealthObservation.activity_id == WorkoutsActivity.id,
        HealthObservation.app_user_id == user_id,
        HealthObservation.generation == generation,
    )


async def connection_for(
    db, user_id, provider, generation, *, revision=None, operation=None, write=False
):
    await membership_for(db, user_id, generation=generation, write=write)
    row = await db.scalar(
        select(HealthConnection)
        .where(
            HealthConnection.app_user_id == user_id,
            HealthConnection.provider == provider,
            HealthConnection.generation == generation,
        )
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise HTTPException(409, "Explicit health connection consent is required")
    if revision is not None and row.revision != revision:
        raise HTTPException(409, "Health consent changed; refresh before processing")
    if operation:
        scope = READ_SCOPE if operation == "sync" else WRITE_SCOPE
        grant = await db.scalar(
            select(WorkoutsGrant).where(
                WorkoutsGrant.app_user_id == user_id,
                WorkoutsGrant.generation == generation,
                WorkoutsGrant.scope == scope,
            )
        )
        allowed = row.connected and (
            row.read_on_device and row.upload_to_server
            if operation == "sync"
            else row.write_actuals
        )
        if not allowed or grant is None:
            raise HTTPException(403, "The current health permission does not allow this operation")
    return row


async def purge_imported(db, user_id, generation, provider=None):
    from app.domains.workouts.export_service import invalidate_export_snapshots

    await invalidate_export_snapshots(db, user_id, generation)
    query = select(HealthObservation).where(
        HealthObservation.app_user_id == user_id, HealthObservation.generation == generation
    )
    if provider:
        query = query.where(HealthObservation.provider == provider)
    rows = list((await db.scalars(query)).all())
    ids = [row.activity_id for row in rows if row.activity_id]
    filters = [HealthObservation.app_user_id == user_id, HealthObservation.generation == generation]
    if provider:
        filters.append(HealthObservation.provider == provider)
    await db.execute(delete(HealthObservation).where(*filters))
    # Do not erase a manual activity or another provider's independent projection.
    if ids:
        await db.execute(
            delete(WorkoutsActivity).where(
                WorkoutsActivity.app_user_id == user_id,
                WorkoutsActivity.generation == generation,
                WorkoutsActivity.id.in_(ids),
            )
        )
    receipt_filters = [
        HealthSyncReceipt.app_user_id == user_id,
        HealthSyncReceipt.generation == generation,
    ]
    if provider:
        receipt_filters.append(HealthSyncReceipt.provider == provider)
    await db.execute(delete(HealthSyncReceipt).where(*receipt_filters))


async def erase_health_product_data(db, user_id, generation):
    """Root calls inside the same owner-locked product-erasure transaction."""
    await purge_imported(db, user_id, generation)
    for model in (HealthExportIntent, HealthConnection):
        await db.execute(
            delete(model).where(model.app_user_id == user_id, model.generation == generation)
        )


async def export_health_page(db, user_id, generation, *, limit=50, offset=0):
    """Root includes this private page in product export; no credentials/receipts."""
    if not 1 <= limit <= 100 or offset < 0:
        raise HTTPException(422, "Invalid health export pagination")
    await membership_for(db, user_id, generation=generation)
    connections = list(
        (
            await db.scalars(
                select(HealthConnection).where(
                    HealthConnection.app_user_id == user_id,
                    HealthConnection.generation == generation,
                )
            )
        ).all()
    )
    observations = list(
        (
            await db.scalars(
                select(HealthObservation)
                .where(
                    HealthObservation.app_user_id == user_id,
                    HealthObservation.generation == generation,
                )
                .order_by(HealthObservation.created_at, HealthObservation.id)
                .limit(limit)
                .offset(offset)
            )
        ).all()
    )
    intents = list(
        (
            await db.scalars(
                select(HealthExportIntent)
                .where(
                    HealthExportIntent.app_user_id == user_id,
                    HealthExportIntent.generation == generation,
                )
                .order_by(HealthExportIntent.created_at, HealthExportIntent.id)
                .limit(limit)
                .offset(offset)
            )
        ).all()
    )
    return {
        "connections": [
            {
                "provider": row.provider,
                "revision": row.revision,
                "connected": row.connected,
                "read_on_device": row.read_on_device,
                "upload_to_server": row.upload_to_server,
                "use_for_ai": row.use_for_ai,
                "write_actuals": row.write_actuals,
            }
            for row in connections
        ],
        "observations": [row.content for row in observations],
        "owned_writes": [
            {
                "provider": row.provider,
                "canonical_session_id": row.canonical_session_id,
                "revision": row.session_revision,
                "status": row.status,
                "source_id": row.source_id,
            }
            for row in intents
        ],
        "limit": limit,
        "offset": offset,
    }


async def invalidate_health_access(db, user_id, generation, removed_scopes):
    """Root grant/AI revocation hook; rows and pending writes share the owner lock."""
    removed = set(removed_scopes)
    if not removed & {READ_SCOPE, WRITE_SCOPE, AI_SCOPE}:
        return
    from app.domains.workouts.export_service import invalidate_export_snapshots

    await invalidate_export_snapshots(db, user_id, generation)
    rows = list(
        (
            await db.scalars(
                select(HealthConnection).where(
                    HealthConnection.app_user_id == user_id,
                    HealthConnection.generation == generation,
                )
            )
        ).all()
    )
    for row in rows:
        changed = False
        if READ_SCOPE in removed and (row.read_on_device or row.upload_to_server):
            row.read_on_device = row.upload_to_server = row.use_for_ai = False
            row.cursor = row.last_sync_at = None
            await purge_imported(db, user_id, generation, row.provider)
            changed = True
        if WRITE_SCOPE in removed and row.write_actuals:
            row.write_actuals = False
            changed = True
        if AI_SCOPE in removed and row.use_for_ai:
            row.use_for_ai = False
            changed = True
        if changed:
            row.revision += 1
            row.updated_at = now()
            if not row.read_on_device and not row.write_actuals:
                row.connected = False


async def set_health_scopes(db, user_id, generation):
    rows = list(
        (
            await db.scalars(
                select(HealthConnection).where(
                    HealthConnection.app_user_id == user_id,
                    HealthConnection.generation == generation,
                )
            )
        ).all()
    )
    needed = set()
    for row in rows:
        if row.connected and row.read_on_device and row.upload_to_server:
            needed.add(READ_SCOPE)
        if row.connected and row.write_actuals:
            needed.add(WRITE_SCOPE)
        if row.connected and row.use_for_ai:
            needed.add(AI_SCOPE)
    existing = list(
        (
            await db.scalars(
                select(WorkoutsGrant).where(
                    WorkoutsGrant.app_user_id == user_id,
                    WorkoutsGrant.generation == generation,
                    WorkoutsGrant.scope.in_([READ_SCOPE, WRITE_SCOPE, AI_SCOPE]),
                )
            )
        ).all()
    )
    for row in existing:
        if row.scope not in needed:
            await db.delete(row)
    for scope in needed - {row.scope for row in existing}:
        db.add(WorkoutsGrant(app_user_id=user_id, generation=generation, scope=scope))


async def require_ai_disclosure(db, user_id, generation):
    consent = await db.scalar(
        select(WorkoutsConsent).where(
            WorkoutsConsent.app_user_id == user_id, WorkoutsConsent.generation == generation
        )
    )
    if consent is None or consent.accepted_at is None:
        raise HTTPException(
            409, "Accept the separate AI disclosure before permitting eligible health context"
        )


async def projection_content(db, user_id, generation, observation):
    profile = await db.scalar(
        select(WorkoutsProfile).where(
            WorkoutsProfile.app_user_id == user_id, WorkoutsProfile.generation == generation
        )
    )
    timezone = ZoneInfo((profile.content or {}).get("timezone", "UTC") if profile else "UTC")
    names = {
        "healthkit:37": "Running",
        "healthkit:52": "Walking",
        "healthkit:50": "Strength",
        "healthkit:6": "Basketball",
        "health_connect:56": "Running",
        "health_connect:79": "Walking",
        "health_connect:70": "Strength",
        "health_connect:5": "Basketball",
    }
    return {
        "date": observation.started_at.astimezone(timezone).date().isoformat(),
        "name": names.get(observation.activity_type, "Recorded exercise"),
        "strenuous": None,
        "duration_minutes": min(1440, round(observation.duration_seconds / 60)),
        "origin_id": observation.source_id,
    }


def normalize_content(observation):
    content = observation.model_dump(mode="json")
    for field in ("started_at", "ended_at", "updated_at"):
        value = getattr(observation, field)
        if value is not None:
            content[field] = value.astimezone(UTC).isoformat()
    # Client consent/confidence never turns unknown upstream data into AI context.
    content["ai_eligibility"] = (
        "restricted"
        if "strava" in observation.origin_id.lower() or observation.ai_eligibility == "restricted"
        else "unknown"
    )
    return content


async def apply_sync(db, user_id, generation, provider, request):
    connection = await connection_for(
        db,
        user_id,
        provider,
        generation,
        revision=request.expected_revision,
        operation="sync",
        write=True,
    )
    raw = request.model_dump(mode="json")
    raw["observations"] = [normalize_content(item) for item in request.observations]
    if request.next_cursor:
        raw["next_cursor"]["window_start"] = request.next_cursor.window_start.astimezone(
            UTC
        ).isoformat()
        raw["next_cursor"]["window_end"] = request.next_cursor.window_end.astimezone(
            UTC
        ).isoformat()
    payload_hash = digest(raw)
    existing_receipt = await db.scalar(
        select(HealthSyncReceipt).where(
            HealthSyncReceipt.app_user_id == user_id,
            HealthSyncReceipt.generation == generation,
            HealthSyncReceipt.provider == provider,
            HealthSyncReceipt.receipt_id == request.receipt_id,
        )
    )
    if existing_receipt:
        if existing_receipt.request_hash != payload_hash:
            raise HTTPException(409, "This health receipt was already used for different content")
        return existing_receipt.response
    if request.next_cursor is not None and request.next_cursor.provider != provider:
        raise HTTPException(422, "Cursor provider does not match the connection")
    deleted = set(request.deleted_source_ids)
    by_id = {}
    for observation in request.observations:
        if observation.provider != provider or not observation.source_id.startswith(provider + ":"):
            raise HTTPException(422, "Observation provider/source does not match the connection")
        if observation.source_id in by_id and by_id[observation.source_id] != observation:
            raise HTTPException(409, "Conflicting observations of one source need reconciliation")
        by_id[observation.source_id] = observation
    accepted = ignored = removed = 0
    for source_id in deleted:
        if not source_id.startswith(provider + ":"):
            raise HTTPException(422, "Deletion provider does not match the connection")
        row = await db.scalar(
            select(HealthObservation).where(
                HealthObservation.app_user_id == user_id,
                HealthObservation.generation == generation,
                HealthObservation.provider == provider,
                HealthObservation.source_id == source_id,
            )
        )
        if row:
            if row.activity_id:
                await db.execute(
                    delete(WorkoutsActivity).where(
                        WorkoutsActivity.id == row.activity_id,
                        WorkoutsActivity.app_user_id == user_id,
                        WorkoutsActivity.generation == generation,
                    )
                )
            await db.delete(row)
            removed += 1
    for source_id, observation in by_id.items():
        if source_id in deleted or observation.origin_id == APP_ID:
            ignored += 1
            continue
        content = normalize_content(observation)
        content_hash = digest(content)
        row = await db.scalar(
            select(HealthObservation).where(
                HealthObservation.app_user_id == user_id,
                HealthObservation.generation == generation,
                HealthObservation.provider == provider,
                HealthObservation.source_id == source_id,
            )
        )
        if row and row.content_hash != content_hash:
            if row.origin_id != observation.origin_id:
                raise HTTPException(409, "A provider source cannot silently change its origin")
            if row.source_updated_at is None or observation.updated_at is None:
                raise HTTPException(409, "Changed source content needs provider revision evidence")
            if observation.updated_at < row.source_updated_at:
                ignored += 1
                continue
            if observation.updated_at == row.source_updated_at:
                raise HTTPException(409, "Provider content conflicts at the same update time")
        if row and row.content_hash == content_hash:
            ignored += 1
            continue
        projection = await projection_content(db, user_id, generation, observation)
        activity = (
            await db.get(WorkoutsActivity, row.activity_id) if row and row.activity_id else None
        )
        if activity is None:
            activity = WorkoutsActivity(
                app_user_id=user_id, generation=generation, content=projection
            )
            db.add(activity)
            await db.flush()
        else:
            activity.content = projection
        if row is None:
            row = HealthObservation(
                app_user_id=user_id,
                generation=generation,
                provider=provider,
                source_id=source_id,
                origin_id=observation.origin_id,
                activity_id=activity.id,
            )
            db.add(row)
        row.content, row.content_hash = content, content_hash
        row.source_updated_at = observation.updated_at
        row.updated_at = now()
        accepted += 1
    if request.next_cursor is not None:
        connection.cursor = request.next_cursor.model_dump(mode="json")
    connection.last_sync_at = now()
    response = {
        "receipt_id": str(request.receipt_id),
        "generation": generation,
        "connection_revision": connection.revision,
        "accepted": accepted,
        "ignored": ignored,
        "deleted": removed,
        "reset_required": request.reset_required,
        "has_more": request.has_more,
        "observed_source_ids": [
            source_id
            for source_id, observation in by_id.items()
            if source_id not in deleted and observation.origin_id != APP_ID
        ],
        "cursor": request.next_cursor.model_dump(mode="json") if request.next_cursor else None,
    }
    db.add(
        HealthSyncReceipt(
            app_user_id=user_id,
            generation=generation,
            provider=provider,
            receipt_id=request.receipt_id,
            connection_revision=connection.revision,
            request_hash=payload_hash,
            response=response,
        )
    )
    await db.flush()
    return response


async def reconcile_snapshot(db, user_id, generation, provider, request):
    """Only reconcile a fully acknowledged bounded snapshot, never an empty query."""
    await connection_for(
        db,
        user_id,
        provider,
        generation,
        revision=request.expected_revision,
        operation="sync",
        write=True,
    )
    receipts = list(
        (
            await db.scalars(
                select(HealthSyncReceipt).where(
                    HealthSyncReceipt.app_user_id == user_id,
                    HealthSyncReceipt.generation == generation,
                    HealthSyncReceipt.provider == provider,
                    HealthSyncReceipt.connection_revision == request.expected_revision,
                    HealthSyncReceipt.receipt_id.in_(request.receipt_ids),
                )
            )
        ).all()
    )
    if len(receipts) != len(set(request.receipt_ids)):
        raise HTTPException(
            409, "All snapshot pages must be acknowledged under the current consent"
        )
    cursors = [row.response.get("cursor") for row in receipts if row.response.get("cursor")]
    valid = [
        cursor
        for cursor in cursors
        if datetime.fromisoformat(cursor["window_start"]) == request.window_start
        and datetime.fromisoformat(cursor["window_end"]) == request.window_end
    ]
    if not valid or not any(cursor["phase"] == "changes" for cursor in valid):
        raise HTTPException(409, "The bounded snapshot is not complete")
    # Apple emptiness is not permission/deletion evidence. Only explicit native
    # deleted UUIDs are accepted; absence-based reconciliation is Android only.
    if provider != "health_connect":
        raise HTTPException(422, "Apple Health absence cannot establish deletion")
    seen = {
        source_id for row in receipts for source_id in row.response.get("observed_source_ids", [])
    }
    first = min(row.created_at for row in receipts)
    rows = list(
        (
            await db.scalars(
                select(HealthObservation).where(
                    HealthObservation.app_user_id == user_id,
                    HealthObservation.generation == generation,
                    HealthObservation.provider == provider,
                )
            )
        ).all()
    )
    removed = 0
    for row in rows:
        start = datetime.fromisoformat(row.content["started_at"])
        if (
            request.window_start <= start < request.window_end
            and row.source_id not in seen
            and row.updated_at < first
        ):
            if row.activity_id:
                await db.execute(
                    delete(WorkoutsActivity).where(
                        WorkoutsActivity.id == row.activity_id,
                        WorkoutsActivity.app_user_id == user_id,
                        WorkoutsActivity.generation == generation,
                    )
                )
            await db.delete(row)
            removed += 1
    await db.flush()
    return {"deleted": removed, "outside_window_preserved": True}


async def actual_for_export(db, user_id, generation, session_id):
    row = await db.scalar(
        select(WorkoutsSession).where(
            WorkoutsSession.id == session_id,
            WorkoutsSession.app_user_id == user_id,
            WorkoutsSession.generation == generation,
        )
    )
    if row is None:
        raise HTTPException(404, "Actual session not found")
    newer = await db.scalar(
        select(WorkoutsSession.id).where(
            WorkoutsSession.supersedes_session_id == row.id,
            WorkoutsSession.app_user_id == user_id,
            WorkoutsSession.generation == generation,
        )
    )
    if newer:
        raise HTTPException(409, "Use the current session correction for health export")
    original, revision = row, 1
    while original.supersedes_session_id:
        if revision >= 32:
            raise HTTPException(409, "Session correction history requires review")
        original = await db.scalar(
            select(WorkoutsSession).where(
                WorkoutsSession.id == original.supersedes_session_id,
                WorkoutsSession.app_user_id == user_id,
                WorkoutsSession.generation == generation,
            )
        )
        if original is None:
            raise HTTPException(409, "Session correction history is unavailable")
        revision += 1
    content = row.content
    duration = content.get("active_seconds")
    if duration is None:
        return (
            row,
            None,
            "Actual active duration was not recorded; it cannot be inferred from the prescription or elapsed interval.",
        )
    start = datetime.fromisoformat(content["started_at"])
    end = datetime.fromisoformat(content["finished_at"])
    if (
        not isinstance(duration, (int, float))
        or isinstance(duration, bool)
        or duration <= 0
        or duration > (end - start).total_seconds() + 1
        or content.get("status") not in {"completed", "partial"}
    ):
        raise HTTPException(422, "The saved actual interval is not valid for health export")
    intervals = content.get("active_intervals") or []
    if intervals:
        try:
            elapsed = 0
            last_end = start
            for interval in intervals:
                interval_start = datetime.fromisoformat(interval["started_at"])
                interval_end = datetime.fromisoformat(interval["ended_at"])
                if (
                    interval_start.tzinfo is None
                    or interval_end.tzinfo is None
                    or not start <= interval_start < interval_end <= end
                    or interval_start < last_end
                ):
                    raise ValueError("Invalid recorded interval")
                elapsed += (interval_end - interval_start).total_seconds()
                last_end = interval_end
            if len(intervals) > 100 or abs(duration - elapsed) > 1:
                raise ValueError("Active duration differs from recorded intervals")
        except (KeyError, TypeError, ValueError):
            raise HTTPException(
                422, "Recorded active intervals need review before export"
            ) from None
    elif abs(duration - (end - start).total_seconds()) > 1:
        return (
            row,
            None,
            "Recorded pause intervals are unavailable; elapsed time cannot replace active duration.",
        )
    activity = {"strength_training": "strength", "general_fitness": "other"}.get(
        content.get("activity_type"), content.get("activity_type", "other")
    )
    if activity not in {
        "running",
        "walking",
        "strength",
        "basketball",
        "other",
    }:
        raise HTTPException(422, "The saved activity type needs review before export")
    return (
        row,
        {
            "canonical_session_id": str(
                uuid5(
                    NAMESPACE_URL,
                    f"hafa-workouts:{user_id}:{generation}:{original.client_session_id}",
                )
            ),
            "revision": revision,
            "status": content["status"],
            "started_at": start.astimezone(UTC).isoformat(),
            "ended_at": end.astimezone(UTC).isoformat(),
            "active_seconds": duration,
            "activity": activity,
            "active_intervals": intervals,
        },
        None,
    )

"""Durable per-request cancellation; no provider admission or training writes."""

import asyncio
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import String, cast, func, select

from app.config import get_settings
from app.domains.workouts.automation_models import WorkoutCoachMessage
from app.domains.workouts.imports import require_ai_consent
from app.domains.workouts.lifecycle import membership_for, now
from app.models.ai import AIInvocation


async def message_quota_count(db, owner):
    requests = select(cast(WorkoutCoachMessage.request_id, String)).where(
        WorkoutCoachMessage.app_user_id == owner,
        WorkoutCoachMessage.created_at >= now() - timedelta(days=1),
    ).union(select(AIInvocation.request_id).where(
        AIInvocation.user_id == owner,
        AIInvocation.capability == "workout_coach",
        AIInvocation.created_at >= now() - timedelta(days=1),
    ))
    return await db.scalar(select(func.count()).select_from(requests.subquery()))


async def cancel_message(db, owner, generation, request_id, *, limit):
    # Completion and cancellation take the same first lock. Whichever commits
    # first is authoritative; never relabel a completed reply as stopped.
    await membership_for(db, owner, generation=generation, write=True)
    row = await db.scalar(select(WorkoutCoachMessage).where(
        WorkoutCoachMessage.app_user_id == owner,
        WorkoutCoachMessage.generation == generation,
        WorkoutCoachMessage.request_id == request_id,
    ))
    if row is None:
        # Stop can reach the server before Send. Bound these content-free
        # tombstones with the same retained daily receipt/quota accounting.
        if await message_quota_count(db, owner) >= limit:
            raise HTTPException(429, "The beta coach allows 50 messages per rolling day")
        row = WorkoutCoachMessage(
            id=uuid4(), app_user_id=owner, generation=generation, request_id=request_id,
            request_hash="0" * 64, user_message="", assistant_message="",
            proposals={"state": "failed", "cancelled": True, "hidden": True, "actions": []},
            used_health_context=False,
        )
        db.add(row)
    elif row.proposals.get("state") == "pending":
        row.proposals = {key: value for key, value in row.proposals.items()
                         if key in {"focus", "consent_at"}} | {
            "state": "failed", "cancelled": True, "actions": [],
        }
        row.assistant_message = "Reply stopped. No training changes were applied."
    else:
        await db.commit()
        return row
    from app.domains.workouts.export_service import invalidate_export_snapshots

    await invalidate_export_snapshots(db, owner, generation)
    await db.commit()  # Invalidate token durably before requesting local closure.
    return row


async def respond_while_current(provider, sessions, owner, generation, message_id, token, consent_at,
                                items, *, tools, poll_seconds=1):
    """Close this worker's provider request when another worker invalidates it.

    The durable receipt is the Stop acknowledgement. Closing local HTTP I/O
    cannot guarantee that the external provider stops billing admitted work.
    """
    async def monitor():
        while True:
            await asyncio.sleep(poll_seconds)
            async with asyncio.timeout(5), sessions() as db:
                configured = get_settings()
                if (not configured.workouts_api_enabled or not configured.workouts_ai_enabled
                        or not configured.is_ai_capability_enabled("workout_coach")):
                    raise HTTPException(503, "Coach processing is unavailable")
                await membership_for(db, owner, generation=generation)
                await require_ai_consent(db, owner, generation, expected=consent_at)
                row = await db.get(WorkoutCoachMessage, message_id, populate_existing=True)
                if (row is None or row.app_user_id != owner or row.generation != generation
                        or row.proposals.get("state") != "pending" or row.proposals.get("token") != token):
                    raise HTTPException(409, "This coach request is no longer active")

    response = asyncio.create_task(provider.respond(items, tools=tools))
    watching = asyncio.create_task(monitor())
    try:
        await asyncio.wait({response, watching}, return_when=asyncio.FIRST_COMPLETED)
        if watching.done():
            await watching  # Fail closed on cancellation, erasure or authority/DB errors.
        return await response
    finally:
        for task in (response, watching):
            if not task.done() and not task.cancelling():
                task.cancel()
        await asyncio.gather(response, watching, return_exceptions=True)

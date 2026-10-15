"""Request-owned provisional NDJSON; the durable receipt is always authoritative."""

import asyncio
import json
from datetime import datetime

from anyio import CancelScope, fail_after
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.domains.workouts.automation_models import WorkoutCoachMessage
from app.domains.workouts.imports import require_ai_consent
from app.domains.workouts.lifecycle import membership_for

MAX_QUEUED_EVENTS = 8


async def message_events(coach, owner, generation, request):
    """One stream owns one send task/session, including disconnect cleanup.

    Reconnecting uses the SAME UUID: pending/terminal replay never calls a
    provider again. Deltas are RAM-only and never replayed or treated as saved.
    """
    queue = asyncio.Queue(maxsize=MAX_QUEUED_EVENTS)
    disconnected = False

    async def offer(event, authorize):
        await queue.put((event, authorize))

    def terminal(status=503):
        # Terminal state must not wait behind a disconnected full delta queue.
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(({"type": "receipt", "status": status}, None))

    async def run():
        try:
            async with coach.sessions() as db:
                await coach.send(db, owner, generation, request, on_event=offer)
            terminal()
        except asyncio.CancelledError:
            if disconnected:
                raise
            # Durable Stop may cancel this exact task. Read its real receipt;
            # completion-first must never be relabeled as cancellation.
            terminal()
        except Exception as error:
            # Even a lost acknowledgement can follow a committed completion.
            terminal(error.status_code if isinstance(error, HTTPException) else 503)

    task = asyncio.create_task(run())
    try:
        while True:
            event, authorize = await queue.get()
            if authorize is not None:
                try:
                    await authorize()
                except Exception:
                    continue  # Retired/finished context supersedes provisional text.
            else:
                # Re-read at delivery, rather than trusting a queued stale answer
                # after Clear, Stop, erasure or another worker's completion.
                from app.domains.workouts.coach import get_settings, message_response
                from app.domains.workouts.router import content_digest

                try:
                    async with coach.sessions() as db:
                        if not get_settings().workouts_api_enabled:
                            raise HTTPException(404, "Product unavailable")
                        await membership_for(db, owner, generation=generation)
                        row = await db.scalar(select(WorkoutCoachMessage).where(
                            WorkoutCoachMessage.app_user_id == owner,
                            WorkoutCoachMessage.generation == generation,
                            WorkoutCoachMessage.request_id == request.request_id,
                        ))
                        digest = content_digest(request.model_dump(mode="json", exclude_none=True))
                        hidden_stop = row and row.proposals.get("hidden") is True and row.proposals.get("cancelled") is True
                        if row is None or (row.request_hash != digest and not hidden_stop):
                            raise HTTPException(409, "No matching receipt")
                        if row.proposals.get("state") in {"pending", "completed"}:
                            configured = get_settings()
                            if not configured.workouts_ai_enabled or not configured.is_ai_capability_enabled("workout_coach"):
                                raise HTTPException(503, "Coach unavailable")
                            await require_ai_consent(db, owner, generation,
                                expected=datetime.fromisoformat(row.proposals["consent_at"]))
                        event = {"type": "receipt", "receipt": message_response(row)}
                except Exception:
                    event = {"type": "error", "code": "coach_request_unavailable", "status": event.get("status", 503)}
            # Encode only the allowlisted event/receipt, using the same datetime
            # wire conversion as FastAPI JSON responses; never repr raw objects.
            wire = jsonable_encoder({**event, "request_id": str(request.request_id), "generation": generation})
            yield (json.dumps(wire, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
            if event["type"] in {"receipt", "error"}:
                return
    finally:
        disconnected = True
        if not task.done() and not task.cancelling():
            task.cancel()
        # Shield ASGI's repeated cancellation, with an independent finite drain
        # deadline. _send's failure transaction also has DB lock/statement limits.
        # Unlike an unbounded shield/retry loop, expiry propagates to the caller.
        with CancelScope(shield=True), fail_after(5):
            await asyncio.gather(task, return_exceptions=True)


class CoachStreamResponse(StreamingResponse):
    async def __call__(self, scope, receive, send):
        # Body/send deadline110s plus at most5s owned cleanup. Disconnect uses
        # the same bounded drain; no unbounded shield loop extends this deadline.
        try:
            async with asyncio.timeout(110):
                await super().__call__(scope, receive, send)
        finally:
            await self.body_iterator.aclose()


def streaming_response(coach, owner, generation, request):
    return CoachStreamResponse(message_events(coach, owner, generation, request),
        media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

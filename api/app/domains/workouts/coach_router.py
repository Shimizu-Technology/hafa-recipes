"""Mounted separately; all personal reads retain the master product/privacy gate."""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field, StrictBool
from sqlalchemy import select

from app.config import get_settings
from app.domains.workouts.automation_models import WorkoutCoachMessage, WorkoutProposal
from app.domains.workouts.coach import (
    CoachRequest,
    clear_conversation,
    message_response,
    workout_coach,
)
from app.domains.workouts.coach_actions import accept_action, receipt_for, undo_action
from app.domains.workouts.lifecycle import membership_for
from app.domains.workouts.router import Database, Generation, User, owned_record
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute


class CoachSendRoute(WorkoutsRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            configured = get_settings()
            if not configured.workouts_api_enabled:
                raise HTTPException(404, "Not found")
            if not configured.workouts_ai_enabled or not configured.is_ai_capability_enabled(
                "workout_coach"
            ):
                raise HTTPException(503, "Coach is unavailable; manual training remains available")
            return await original(request)

        return handler


router = APIRouter(prefix="/api/v1/workouts/coach", tags=["workouts"], route_class=WorkoutsRoute)
send_router = APIRouter(
    prefix="/api/v1/workouts/coach", tags=["workouts"], route_class=CoachSendRoute
)


@send_router.post("/messages")
async def send_message(request: CoachRequest, user: User, db: Database, generation: Generation):
    return await workout_coach.send(db, user.id, generation, request)


@router.get("/messages")
async def messages(user: User, db: Database, limit: int = 50, offset: int = 0):
    membership = await membership_for(db, user.id)
    if not 1 <= limit <= 100 or offset < 0 or offset > 10000:
        raise HTTPException(422, "Choose a bounded history page")
    rows = (
        await db.scalars(
            select(WorkoutCoachMessage)
            .where(
                WorkoutCoachMessage.app_user_id == user.id,
                WorkoutCoachMessage.generation == membership.generation,
                WorkoutCoachMessage.proposals["state"].astext != "cleared",
            )
            .order_by(WorkoutCoachMessage.created_at.desc(), WorkoutCoachMessage.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {"messages": [message_response(row) for row in rows], "limit": limit, "offset": offset}


@router.delete("/messages", status_code=204)
async def clear(user: User, db: Database, generation: Generation):
    await clear_conversation(db, user.id, generation)


@router.get("/actions/{proposal_id}")
async def inspect_action(proposal_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    await receipt_for(db, user.id, membership.generation, proposal_id)
    proposal = await owned_record(db, WorkoutProposal, proposal_id, user.id, membership.generation)
    return {
        "id": str(proposal.id),
        "kind": proposal.kind,
        "proposal": proposal.content,
        "profile_revision": proposal.profile_revision,
        "target_id": str(proposal.target_id) if proposal.target_id else None,
        "target_revision": proposal.target_revision,
        "expires_at": proposal.expires_at,
    }


class AcceptAction(DomainModel):
    title: str = Field(default="Training plan", min_length=1, max_length=200)
    confirm_return_baseline: StrictBool = False


@send_router.post("/actions/{proposal_id}/accept")
async def accept(
    proposal_id: UUID, request: AcceptAction, user: User, db: Database, generation: Generation
):
    return await accept_action(
        db,
        user.id,
        generation,
        proposal_id,
        title=request.title,
        confirm_return_baseline=request.confirm_return_baseline,
    )


@router.post("/actions/{proposal_id}/undo")
async def undo(proposal_id: UUID, user: User, db: Database, generation: Generation):
    return await undo_action(db, user.id, generation, proposal_id)

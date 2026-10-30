"""Explicit, deterministic day edits. Every proposal preserves an undo snapshot."""
from copy import deepcopy
from datetime import timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.domains.workouts.automation_models import WorkoutProposal
from app.domains.workouts.automation_router import (
    effective_profile,
    persist_proposal,
    validate_proposal_context,
)
from app.domains.workouts.coach_actions import recorded_program_ids, safe_program
from app.domains.workouts.coach_continuity import date_move_guard, logical_sessions
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import WorkoutsProgram, WorkoutsProgramVersion
from app.domains.workouts.programming import adapt_workout
from app.domains.workouts.router import owned_record
from app.domains.workouts.schedule import validate_other_program_dates
from app.domains.workouts.schemas import WorkoutContent


def today_guard(before, after, ids, recorded, today):
    originals, updated = logical_sessions(before), logical_sessions(after)
    if set(originals) != set(updated) or len(ids) != 1:
        raise HTTPException(409, "Refresh today's session before adjusting it")
    for key, original in originals.items():
        changed = updated[key]
        if key not in ids and changed != original:
            raise HTTPException(409, "An unrelated session changed")
        if key in ids and (key in recorded or original["date"] != today.isoformat()
                          or {k: v for k, v in original.items() if k != "workout"}
                          != {k: v for k, v in changed.items() if k != "workout"}):
            raise HTTPException(409, "Only today's unrecorded prescription can change")


async def prepare(db, user_id, generation, request, *, missed=False):
    profile, revision = await effective_profile(db, user_id, generation, request.profile_revision)
    if profile.readiness != "ready":
        raise HTTPException(409, "Confirm current readiness before changing your training")
    row = await safe_program(db, user_id, generation, request.program_id, request.program_revision)
    if row.content.get("schedule_state", {}).get("status") == "paused":
        raise HTTPException(409, "Return your paused plan before changing it")
    today = now().astimezone(ZoneInfo(profile.timezone)).date()
    recorded = await recorded_program_ids(db, user_id, generation, row.id)
    updated = deepcopy(row.content)
    sessions = updated["proposal"]["sessions"]
    ids, questions, warnings, changes = set(), [], [], []
    if missed:
        pending = sorted((s for s in sessions if s["id"] not in recorded and s["date"] < today.isoformat()), key=lambda s: (s["date"], s["id"]))
        for session in pending:
            old_date = session["date"]
            for offset in range(366):
                session["date"] = (today + timedelta(days=offset)).isoformat()
                try:
                    date_move_guard(row.content, updated, ids | {session["id"]}, recorded, profile, today)
                    await validate_other_program_dates(db, user_id, generation, row.id, updated, ids | {session["id"]})
                    break
                except HTTPException as exc:
                    if exc.status_code not in (409, 422):
                        raise
            else:
                session["date"] = old_date
                raise HTTPException(409, "No conflict-free dates found within a year; review your available days")
            ids.add(session["id"])
        if not ids:
            raise HTTPException(409, "No missed unrecorded sessions remain")
    else:
        selected = next((s for s in sessions if s["id"] == request.session_id), None)
        if selected is None:
            raise HTTPException(404, "Session not found")
        ids.add(selected["id"])
        today_guard(row.content, updated, ids, recorded, today)
        result = adapt_workout(WorkoutContent.model_validate(selected["workout"]), profile, minutes=request.minutes)
        questions, warnings, changes = result.questions, result.warnings, result.changes
        if result.status == "ready" and result.workout:
            selected["workout"] = result.workout.model_dump(mode="json")
        else:
            questions = questions or ["Review the source details before adjusting this session."]
    proposal = await persist_proposal(db, user_id, generation, "schedule", revision, {
        "status": "needs_information" if questions else "ready", "questions": questions,
        "warnings": warnings, "changes": changes,
        "quick_training": "missed" if missed else "today", "session_ids": sorted(ids),
        "before": row.content, "program": updated, "state": "proposed",
    }, target_id=row.id, target_revision=row.revision)
    await db.commit()
    return proposal


async def apply(db, user_id, generation, identifier, operation):
    proposal = await owned_record(db, WorkoutProposal, identifier, user_id, generation)
    if proposal.kind != "schedule" or proposal.content.get("quick_training") not in {"today", "missed"}:
        raise HTTPException(404, "Day adjustment not found")
    body = proposal.content
    row = await owned_record(db, WorkoutsProgram, proposal.target_id, user_id, generation)
    # Membership's owner lock serializes proposal/application/record writes.
    if operation == "accept" and body["state"] == "accepted" or operation == "undo" and body["state"] == "undone":
        return {"state": body["state"], "revision": body["after_revision"]}
    if body["state"] != ("proposed" if operation == "accept" else "accepted"):
        raise HTTPException(409, "This adjustment is no longer available")
    expected = proposal.target_revision if operation == "accept" else body["after_revision"]
    if row.revision != expected or row.content.get("schedule_state", {}).get("archived_at"):
        raise HTTPException(409, "Your plan changed; review a fresh adjustment")
    profile, _ = await effective_profile(db, user_id, generation)
    today = now().astimezone(ZoneInfo(profile.timezone)).date()
    if operation == "accept":
        await validate_proposal_context(db, proposal, user_id, generation)
        if proposal.expires_at <= now() or body["status"] != "ready":
            raise HTTPException(409, "Review a fresh ready adjustment")
    content = deepcopy(body["program"] if operation == "accept" else body["before"])
    ids = set(body["session_ids"])
    recorded = await recorded_program_ids(db, user_id, generation, row.id)
    if body["quick_training"] == "today":
        today_guard(row.content, content, ids, recorded, today)
    else:
        date_move_guard(row.content, content, ids, recorded, profile, today, restoring=operation == "undo")
        future_ids = {s["id"] for s in content["proposal"]["sessions"] if s["id"] in ids and s["date"] >= today.isoformat()}
        await validate_other_program_dates(db, user_id, generation, row.id, content, future_ids)
    row.content = content
    row.revision += 1
    row.updated_at = now()
    db.add(WorkoutsProgramVersion(app_user_id=user_id, generation=generation, program_id=row.id, revision=row.revision, content=content))
    proposal.content = body | {"state": "accepted" if operation == "accept" else "undone", "after_revision": row.revision}
    proposal.accepted_record_id = row.id
    proposal.accepted_at = now()
    await db.commit()
    return {"state": proposal.content["state"], "revision": row.revision}

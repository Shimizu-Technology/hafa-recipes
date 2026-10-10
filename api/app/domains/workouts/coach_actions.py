"""Validated coach tools. Model output proposes; only an explicit receipt accepts."""

from copy import deepcopy
from datetime import date
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import String, cast, select

from app.config import get_settings
from app.domains.workouts.automation_models import (
    WorkoutCoachMessage,
    WorkoutProposal,
    WorkoutReadiness,
)
from app.domains.workouts.automation_router import (
    effective_profile,
    persist_proposal,
    proposal_context_hash,
    store_workout,
)
from app.domains.workouts.coach_continuity import (
    bulk_schedule,
    comparable_progression,
    future_change_guard,
    running_geometry,
    running_progression,
    running_workout,
    shorter_workout,
    validate_calendar,
)
from app.domains.workouts.imports import require_ai_consent
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsProfile,
    WorkoutsProgram,
    WorkoutsProgramVersion,
    WorkoutsSession,
    WorkoutVersion,
)
from app.domains.workouts.programming import REVIEW_NOTICE, adapt_workout, build_program
from app.domains.workouts.router import content_digest, owned_record, validated_workout
from app.domains.workouts.schemas import (
    ActivityContext,
    DomainModel,
    TrainingProfile,
    WorkoutContent,
)


class PlanAction(DomainModel):
    start_date: date
    weeks: int = Field(ge=1, le=12, strict=True)
    source_workout_ids: list[UUID] = Field(max_length=12)


class AdaptAction(DomainModel):
    workout_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    minutes: int | None = Field(ge=5, le=180)


class PreferencesAction(DomainModel):
    primary_goal: (
        Literal[
            "general_fitness", "strength", "body_composition", "running", "athletic_conditioning"
        ]
        | None
    )
    experience: Literal["new", "returning", "regular"] | None
    equipment: list[str] | None = Field(max_length=100)
    available_days: list[int] | None = Field(max_length=7)
    session_minutes: int | None = Field(ge=5, le=180)


class ScheduleAction(DomainModel):
    program_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    session_id: str = Field(min_length=1, max_length=100)
    operation: Literal["move", "skip"]
    target_date: date | None


class ProgressionAction(DomainModel):
    workout_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    block_id: str = Field(min_length=1, max_length=100)
    exercise_index: int = Field(ge=0, le=99, strict=True)


class RunningAction(DomainModel):
    program_id: UUID
    expected_revision: int = Field(ge=1, strict=True)


class BulkScheduleAction(DomainModel):
    program_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    operation: Literal["shift", "pause", "return"]
    shift_days: int | None = Field(default=None, ge=-365, le=365, strict=True)
    start_date: date | None = None


class ProgramProgressionAction(DomainModel):
    program_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    session_id: str = Field(min_length=1, max_length=100)
    block_id: str = Field(min_length=1, max_length=100)
    exercise_index: int = Field(ge=0, le=99, strict=True)


class SessionAlternativeAction(DomainModel):
    program_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    session_id: str = Field(min_length=1, max_length=100)
    operation: Literal["swap", "shorten"]
    other_session_id: str | None = Field(default=None, max_length=100)
    minutes: int | None = Field(default=None, ge=5, le=180, strict=True)


TOOLS = {
    "propose_training_plan": (
        PlanAction,
        "Prepare a general fitness plan; source IDs must be from the inspected library.",
    ),
    "adapt_saved_workout": (
        AdaptAction,
        "Prepare a separate adapted copy of an inspected workout.",
    ),
    "update_training_preferences": (
        PreferencesAction,
        "Propose explicitly requested preferences. Body metrics and medical limitations require the profile editor.",
    ),
    "edit_future_schedule": (
        ScheduleAction,
        "Propose moving or skipping one future uncompleted training session, including recovery rescheduling.",
    ),
    "review_actual_progression": (
        ProgressionAction,
        "Evaluate comparable recorded actuals; the server chooses whether any load increase is supported.",
    ),
    "review_running_stage": (
        RunningAction,
        "Review three actual full-stage results and propose the next introductory stage; calendar weeks and shortened sessions do not prove completion.",
    ),
    "adjust_program_calendar": (
        BulkScheduleAction,
        "Preview a bulk future shift, pause or return. Return requires a direct user acceptance baseline confirmation and fresh readiness. Never stack missed sessions.",
    ),
    "review_program_exercise": (
        ProgramProgressionAction,
        "Review comparable actual round/set/side feedback for a future program exercise, then propose changes only to matching future prescriptions.",
    ),
    "prepare_session_alternative": (
        SessionAlternativeAction,
        "Preview swapping two future sessions or a shorter known timed walking/run-walk alternative. Unknown optional strength/source work requires clarification.",
    ),
}


def tool_definitions():
    def strict(node):
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            for value in node.values():
                strict(value)
        elif isinstance(node, list):
            for value in node:
                strict(value)

    result = []
    for name, (model, description) in TOOLS.items():
        schema = model.model_json_schema()
        strict(schema)
        result.append(
            {
                "type": "function",
                "name": name,
                "description": description,
                "parameters": schema,
                "strict": True,
            }
        )
    return result


def health_derived(value):
    """Conservative exclusion, also applied to nested immutable snapshots."""
    if isinstance(value, dict):
        for key, item in value.items():
            if (
                key in {"origin_id", "used_health_context", "ai_health_context"}
                or key.startswith("health_")
            ) and item:
                return True
            if key == "source_provider" and item in {"healthkit", "health_connect", "strava"}:
                return True
            if key == "source_url" and isinstance(item, str) and "strava" in item.lower():
                return True
            if health_derived(item):
                return True
    elif isinstance(value, list):
        return any(health_derived(item) for item in value)
    return False


async def safe_workout(db, user_id, generation, identifier, revision):
    row = await owned_record(db, WorkoutRecord, identifier, user_id, generation)
    if row.revision != revision:
        raise HTTPException(409, "Workout changed; inspect the current revision")
    if health_derived(row.content):
        raise HTTPException(409, "This workout needs provenance review before coaching")
    return row


async def current_actuals(db, user_id, generation, *, workout_id=None, program_id=None):
    later = WorkoutsSession.__table__.alias("later")
    query = select(WorkoutsSession).where(
        WorkoutsSession.app_user_id == user_id,
        WorkoutsSession.generation == generation,
        ~select(later.c.id).where(later.c.supersedes_session_id == WorkoutsSession.id).exists(),
    )
    if workout_id:
        query = query.where(WorkoutsSession.source_workout_id == workout_id)
    if program_id:
        query = query.where(WorkoutsSession.source_program_id == program_id)
    rows = (
        await db.scalars(
            query.order_by(WorkoutsSession.created_at.desc(), WorkoutsSession.id.desc()).limit(30)
        )
    ).all()
    return [row for row in rows if not health_derived(row.content)]


async def recorded_program_ids(db, user_id, generation, program_id):
    # Every historical recording freezes its prescription; no latest-30 coverage gap.
    identifiers = (
        await db.scalars(
            select(WorkoutsSession.content["program_session_id"].astext).where(
                WorkoutsSession.app_user_id == user_id,
                WorkoutsSession.generation == generation,
                WorkoutsSession.source_program_id == program_id,
            )
        )
    ).all()
    return {identifier for identifier in identifiers if identifier is not None}


async def owned_program_hash(db, user_id, generation):
    rows = (
        await db.execute(
            select(WorkoutsProgram.id, WorkoutsProgram.revision)
            .where(WorkoutsProgram.app_user_id == user_id, WorkoutsProgram.generation == generation)
            .order_by(WorkoutsProgram.id)
        )
    ).all()
    return content_digest([(str(identifier), revision) for identifier, revision in rows])


async def safe_program(db, user_id, generation, identifier, revision):
    row = await owned_record(db, WorkoutsProgram, identifier, user_id, generation)
    if row.revision != revision or health_derived(row.content):
        raise HTTPException(409, "Program changed or needs provenance review")
    return row


async def prepare_action(db, user_id, generation, name, arguments, *, compose_library_program=None):
    if name not in TOOLS:
        raise HTTPException(422, "Unknown coaching action")
    action = TOOLS[name][0].model_validate(arguments)
    profile, revision = await effective_profile(db, user_id, generation)
    # Imported activity context is never transferred into deterministic planning.
    profile = profile.model_copy(
        update={
            "other_activities": [item for item in profile.other_activities if not item.origin_id]
        }
    )
    activities = (
        await db.scalars(
            select(WorkoutsActivity)
            .where(
                WorkoutsActivity.app_user_id == user_id, WorkoutsActivity.generation == generation
            )
            .order_by(WorkoutsActivity.created_at.desc())
            .limit(500)
        )
    ).all()
    manual = [
        ActivityContext.model_validate(row.content)
        for row in activities
        if not health_derived(row.content)
    ]
    profile = profile.model_copy(
        update={"other_activities": (profile.other_activities + manual)[-500:]}
    )
    today = now().astimezone(ZoneInfo(profile.timezone)).date()
    target = None
    target_revision = None
    before = None
    source_revisions = []
    before_profile = None
    if isinstance(action, PlanAction):
        if action.start_date < today:
            raise HTTPException(422, "A new plan must start today or later")
        if action.source_workout_ids:
            if compose_library_program is None:
                raise HTTPException(409, "Source-based plan composition is unavailable")
            sources = []
            for identifier in action.source_workout_ids:
                row = await owned_record(db, WorkoutRecord, identifier, user_id, generation)
                await safe_workout(db, user_id, generation, row.id, row.revision)
                sources.append(
                    {"id": str(row.id), "revision": row.revision, "content": row.content}
                )
                source_revisions.append({"id": str(row.id), "revision": row.revision})
            proposal = await compose_library_program(
                profile, action.start_date, action.weeks, sources
            )
        else:
            proposal = build_program(profile, action.start_date, action.weeks)
        kind, content = "program", proposal.model_dump(mode="json")
    elif isinstance(action, AdaptAction):
        source = await safe_workout(
            db, user_id, generation, action.workout_id, action.expected_revision
        )
        kind = "adaptation"
        target, target_revision = source.id, source.revision
        content = adapt_workout(
            WorkoutContent.model_validate(source.content), profile, action.minutes
        ).model_dump(mode="json")
    elif isinstance(action, PreferencesAction):
        changes = action.model_dump(exclude_none=True)
        if not changes:
            raise HTTPException(422, "Choose at least one preference to update")
        # Read stored profile: never persist transient readiness or filtered activities.
        source = await db.get(WorkoutsProfile, user_id, populate_existing=True)
        updated = TrainingProfile.model_validate(source.content | changes).model_dump(mode="json")
        before = source.content
        kind, content = "profile", {"status": "ready", "changes": changes, "profile": updated}
        target_revision = source.revision
    elif isinstance(action, ScheduleAction):
        source = await owned_record(db, WorkoutsProgram, action.program_id, user_id, generation)
        if source.revision != action.expected_revision or health_derived(source.content):
            raise HTTPException(409, "Program changed or needs provenance review")
        content = deepcopy(source.content)
        sessions = content.get("proposal", {}).get("sessions", [])
        selected = next((item for item in sessions if item["id"] == action.session_id), None)
        if selected is None:
            raise HTTPException(404, "Scheduled session not found")
        recorded = await recorded_program_ids(db, user_id, generation, source.id)
        if date.fromisoformat(selected["date"]) <= today or action.session_id in recorded:
            raise HTTPException(409, "Only future uncompleted sessions may change")
        if action.operation == "skip":
            sessions.remove(selected)
        else:
            if action.target_date is None or action.target_date <= today:
                raise HTTPException(422, "Choose a future training date")
            if any(
                item["id"] != action.session_id and item["date"] == action.target_date.isoformat()
                for item in sessions
            ):
                raise HTTPException(409, "Another session already occupies that date")
            if any(
                item["id"] != action.session_id
                and abs((date.fromisoformat(item["date"]) - action.target_date).days) < 2
                for item in sessions
            ):
                raise HTTPException(409, "Keep a rest day between structured training sessions")
            if any(
                item.date == action.target_date and item.strenuous is not False
                for item in profile.other_activities
            ):
                raise HTTPException(
                    409, "Review the declared activity on that date before moving training"
                )
            selected["date"] = action.target_date.isoformat()
            sessions.sort(key=lambda item: (item["date"], item["id"]))
        before = source.content
        kind, target, target_revision = "schedule", source.id, source.revision
        content = {"status": "ready", "program": content, "session_id": action.session_id}
    elif isinstance(action, BulkScheduleAction):
        source = await safe_program(
            db, user_id, generation, action.program_id, action.expected_revision
        )
        recorded = await recorded_program_ids(db, user_id, generation, source.id)
        state = source.content.get("schedule_state", {})
        if action.operation == "return" and state.get("paused_at"):
            readiness = await db.get(WorkoutReadiness, user_id, populate_existing=True)
            from datetime import datetime

            if (
                not readiness
                or readiness.confirmed_at <= datetime.fromisoformat(state["paused_at"])
                or profile.readiness != "ready"
            ):
                raise HTTPException(
                    409, "Confirm fresh readiness and a comfortable baseline after the pause"
                )
        updated, ids = bulk_schedule(
            source.content,
            profile,
            recorded,
            today,
            action.operation,
            shift_days=action.shift_days,
            start_date=action.start_date,
        )
        future_change_guard(
            source.content,
            updated,
            set(ids),
            recorded,
            today,
            returning=action.operation == "return",
        )
        before = source.content
        kind, target, target_revision = "schedule", source.id, source.revision
        content = {
            "status": "ready",
            "operation": action.operation,
            "program": updated,
            "session_ids": ids,
            "confirmation_required": action.operation == "return",
            "review_notice": REVIEW_NOTICE,
        }
    elif isinstance(action, RunningAction):
        source = await safe_program(
            db, user_id, generation, action.program_id, action.expected_revision
        )
        records = await current_actuals(db, user_id, generation, program_id=source.id)
        records = [
            row
            for row in records
            if any(
                ex.get("exercise_id") == "easy_run"
                for block in row.content.get("prescription_snapshot", {}).get("blocks", [])
                for ex in block["exercises"]
            )
        ]
        decision, next_workout = running_progression(profile, records, as_of=today)
        stored_profile = await db.get(WorkoutsProfile, user_id, populate_existing=True)
        updated_profile = deepcopy(stored_profile.content)
        content = {
            "status": "needs_information",
            "evaluation": decision,
            "questions": [decision["reason"]],
        }
        kind, target, target_revision = "schedule", source.id, source.revision
        if next_workout is not None:
            updated_profile["running_baseline"]["accepted_stage"] = decision["suggested_stage"]
            updated = deepcopy(source.content)
            recorded = await recorded_program_ids(db, user_id, generation, source.id)
            baseline = running_workout(profile)
            ids = []
            for item in updated["proposal"]["sessions"]:
                if (
                    item["id"] not in recorded
                    and date.fromisoformat(item["date"]) > today
                    and running_geometry(WorkoutContent.model_validate(item["workout"]))
                    == running_geometry(baseline)
                ):
                    original = item["workout"]
                    replacement = next_workout.model_dump(mode="json")
                    replacement.update(
                        id=content_digest(
                            {"session": item["id"], "stage": decision["suggested_stage"]}
                        )[:24],
                        version=original.get("version", 1) + 1,
                        parent_version_id=original.get("id"),
                    )
                    item["workout"] = replacement
                    ids.append(item["id"])
            if ids:
                before, before_profile = source.content, stored_profile.content
                content = {
                    "status": "ready",
                    "operation": "running_stage",
                    "evaluation": decision,
                    "program": updated,
                    "profile": updated_profile,
                    "session_ids": ids,
                    "review_notice": REVIEW_NOTICE,
                }
            else:
                # A finished plan still allows a separately accepted next-stage profile.
                kind = "profile"
                before = stored_profile.content
                content = {
                    "status": "ready",
                    "operation": "running_stage_profile",
                    "evaluation": decision,
                    "profile": updated_profile,
                    "changes": {"running_baseline.accepted_stage": decision["suggested_stage"]},
                    "review_notice": REVIEW_NOTICE,
                }
    elif isinstance(action, ProgramProgressionAction):
        source = await safe_program(
            db, user_id, generation, action.program_id, action.expected_revision
        )
        recorded = await recorded_program_ids(db, user_id, generation, source.id)
        selected = next(
            (
                item
                for item in source.content["proposal"]["sessions"]
                if item["id"] == action.session_id
            ),
            None,
        )
        if not selected:
            raise HTTPException(404, "Scheduled session not found")
        if selected["id"] in recorded or date.fromisoformat(selected["date"]) <= today:
            raise HTTPException(409, "Choose an uncompleted future prescription")
        workout = WorkoutContent.model_validate(selected["workout"])
        records = await current_actuals(db, user_id, generation, program_id=source.id)
        records = [
            row
            for row in records
            if any(
                block["id"] == action.block_id
                for block in row.content.get("prescription_snapshot", {}).get("blocks", [])
            )
        ]
        decision, changed_workout = comparable_progression(
            workout, action.block_id, action.exercise_index, records, profile, as_of=today
        )
        updated = deepcopy(source.content)
        ids = []
        if changed_workout:
            original_block = next(block for block in workout.blocks if block.id == action.block_id)
            replacement_block = next(
                block for block in changed_workout["blocks"] if block["id"] == action.block_id
            )
            for item in updated["proposal"]["sessions"]:
                current_block = next(
                    (
                        block
                        for block in item["workout"]["blocks"]
                        if block["id"] == action.block_id
                    ),
                    None,
                )
                if (
                    item["id"] not in recorded
                    and date.fromisoformat(item["date"]) > today
                    and current_block
                    and content_digest(current_block)
                    == content_digest(original_block.model_dump(mode="json"))
                ):
                    item["workout"]["blocks"] = [
                        deepcopy(replacement_block) if block["id"] == action.block_id else block
                        for block in item["workout"]["blocks"]
                    ]
                    item["workout"]["provenance"] = "suggestion"
                    item["workout"]["parent_version_id"] = item["workout"].get("id")
                    item["workout"]["version"] = item["workout"].get("version", 1) + 1
                    item["workout"]["id"] = content_digest(
                        {"session": item["id"], "decision": decision}
                    )[:24]
                    ids.append(item["id"])
        kind, target, target_revision, before = (
            "schedule",
            source.id,
            source.revision,
            source.content,
        )
        content = {
            "status": "ready" if ids else "needs_information",
            "operation": "exercise_progression",
            "evaluation": decision,
            "program": updated if ids else None,
            "session_ids": ids,
            "review_notice": REVIEW_NOTICE,
        }
    elif isinstance(action, SessionAlternativeAction):
        source = await safe_program(
            db, user_id, generation, action.program_id, action.expected_revision
        )
        if source.content.get("schedule_state", {}).get("status") == "paused":
            raise HTTPException(409, "Return this paused program before changing active sessions")
        updated = deepcopy(source.content)
        selected = next(
            (item for item in updated["proposal"]["sessions"] if item["id"] == action.session_id),
            None,
        )
        if not selected:
            raise HTTPException(404, "Scheduled session not found")
        recorded = await recorded_program_ids(db, user_id, generation, source.id)
        ids = {selected["id"]}
        question = None
        if action.operation == "swap":
            other = next(
                (
                    item
                    for item in updated["proposal"]["sessions"]
                    if item["id"] == action.other_session_id
                ),
                None,
            )
            if not other or other["id"] == selected["id"]:
                raise HTTPException(422, "Choose a different scheduled session to swap")
            selected["date"], other["date"] = other["date"], selected["date"]
            ids.add(other["id"])
            updated["proposal"]["sessions"].sort(key=lambda item: (item["date"], item["id"]))
        else:
            if action.minutes is None:
                raise HTTPException(422, "Choose a shorter duration")
            shorter, question = shorter_workout(
                WorkoutContent.model_validate(selected["workout"]), action.minutes
            )
            if shorter:
                selected["workout"] = shorter.model_dump(mode="json")
        if question is None:
            future_change_guard(source.content, updated, ids, recorded, today)
            validate_calendar(updated, profile, ids)
        before, kind, target, target_revision = (
            source.content,
            "schedule",
            source.id,
            source.revision,
        )
        content = {
            "status": "needs_information" if question else "ready",
            "operation": action.operation,
            "program": updated if question is None else None,
            "session_ids": sorted(ids),
            "questions": [question] if question else [],
            "review_notice": REVIEW_NOTICE,
        }
    else:
        source = await safe_workout(
            db, user_id, generation, action.workout_id, action.expected_revision
        )
        workout = WorkoutContent.model_validate(source.content)
        records = await current_actuals(db, user_id, generation, workout_id=source.id)
        decision, changed = comparable_progression(
            workout, action.block_id, action.exercise_index, records, profile, as_of=today
        )
        kind, target, target_revision = "progression", source.id, source.revision
        content = {
            "status": "ready" if changed else "needs_information",
            "evaluation": decision,
            "workout": changed,
        }
    return {
        "name": name,
        "arguments": action.model_dump(mode="json"),
        "kind": kind,
        "profile_revision": revision,
        "content": content,
        "target_id": target,
        "target_revision": target_revision,
        "before": before,
        "source_revisions": source_revisions,
        "before_profile": before_profile,
    }


async def save_prepared(db, user_id, generation, prepared):
    row = await persist_proposal(
        db,
        user_id,
        generation,
        prepared["kind"],
        prepared["profile_revision"],
        prepared["content"],
        target_id=prepared["target_id"],
        target_revision=prepared["target_revision"],
    )
    return {
        "proposal_id": str(row.id),
        "kind": row.kind,
        "status": row.content.get("status"),
        "before": prepared["before"],
        "state": "proposed",
        "source_revisions": prepared["source_revisions"],
        "before_profile": prepared["before_profile"],
    }


async def receipt_for(db, user_id, generation, proposal_id):
    row = await db.scalar(
        select(WorkoutCoachMessage).where(
            WorkoutCoachMessage.app_user_id == user_id,
            WorkoutCoachMessage.generation == generation,
            WorkoutCoachMessage.proposals.contains(
                {"state": "completed", "actions": [{"proposal_id": str(proposal_id)}]}
            ),
        )
    )
    if row:
        metadata = deepcopy(row.proposals)
        for receipt in metadata.get("actions", []):
            if receipt["proposal_id"] == str(proposal_id):
                return row, metadata, receipt
    raise HTTPException(404, "Coach action receipt not found")


async def accept_action(
    db, user_id, generation, proposal_id, *, title="Training plan", confirm_return_baseline=False
):
    configured = get_settings()
    if (
        not configured.workouts_api_enabled
        or not configured.workouts_ai_enabled
        or not configured.is_ai_capability_enabled("workout_coach")
    ):
        raise HTTPException(
            503, "Coach acceptance is unavailable; manual training remains available"
        )
    await membership_for(db, user_id, generation=generation, write=True)
    consent = await require_ai_consent(db, user_id, generation)
    message, metadata, receipt = await receipt_for(db, user_id, generation, proposal_id)
    if consent.accepted_at.isoformat() != metadata["consent_at"]:
        raise HTTPException(409, "AI consent changed; prepare a new action")
    proposal = await owned_record(db, WorkoutProposal, proposal_id, user_id, generation)
    if receipt["state"] == "undone":
        raise HTTPException(409, "This action was undone; prepare a new proposal")
    if receipt["state"] == "accepted":
        return {
            "proposal_id": str(proposal.id),
            "record_id": receipt["record_id"],
            "revision": receipt["after_revision"],
            "state": "accepted",
        }
    profile, revision = await effective_profile(db, user_id, generation, proposal.profile_revision)
    if (
        proposal.expires_at <= now()
        or proposal.context_hash != await proposal_context_hash(db, user_id, generation)
        or proposal.content.get("status") != "ready"
    ):
        raise HTTPException(409, "Training context changed or the proposal needs information")
    if (
        proposal.kind != "profile"
        and proposal.content.get("operation") != "pause"
        and profile.readiness != "ready"
    ):
        raise HTTPException(409, "Confirm readiness before applying a training change")
    for pin in receipt.get("source_revisions", []):
        await safe_workout(db, user_id, generation, UUID(pin["id"]), pin["revision"])
    if proposal.kind == "program":
        today = now().astimezone(ZoneInfo(profile.timezone)).date()
        if any(date.fromisoformat(item["date"]) < today for item in proposal.content["sessions"]):
            raise HTTPException(409, "Plan start has passed; prepare a fresh future plan")
        if not title.strip() or len(title) > 200:
            raise HTTPException(422, "Choose a training plan title")
        saved = WorkoutsProgram(
            id=uuid4(),
            app_user_id=user_id,
            generation=generation,
            revision=1,
            content={"title": title, "proposal": proposal.content},
        )
        db.add(saved)
        db.add(
            WorkoutsProgramVersion(
                id=uuid4(),
                program_id=saved.id,
                app_user_id=user_id,
                generation=generation,
                revision=1,
                content=saved.content,
            )
        )
    elif proposal.kind in {"adaptation", "progression"}:
        source = await safe_workout(
            db, user_id, generation, proposal.target_id, proposal.target_revision
        )
        version = await db.scalar(
            select(WorkoutVersion.id).where(
                WorkoutVersion.workout_id == source.id, WorkoutVersion.revision == source.revision
            )
        )
        saved = store_workout(
            db,
            user_id,
            generation,
            validated_workout(
                WorkoutContent.model_validate(proposal.content["workout"]), authored=False
            ),
            parent_version_id=str(version),
        )
    elif proposal.kind == "profile":
        if proposal.content.get("operation") == "running_stage_profile":
            await safe_program(
                db, user_id, generation, proposal.target_id, proposal.target_revision
            )
        saved = await db.get(WorkoutsProfile, user_id, populate_existing=True)
        saved.content = TrainingProfile.model_validate(proposal.content["profile"]).model_dump(
            mode="json"
        )
        saved.revision = revision + 1
        saved.updated_at = now()
    else:
        saved = await owned_record(db, WorkoutsProgram, proposal.target_id, user_id, generation)
        if saved.revision != proposal.target_revision:
            raise HTTPException(409, "Program changed; prepare a fresh schedule edit")
        today = now().astimezone(ZoneInfo(profile.timezone)).date()
        ids = set(proposal.content.get("session_ids", [proposal.content.get("session_id")]))
        recorded = await recorded_program_ids(db, user_id, generation, saved.id)
        operation = proposal.content.get("operation")
        if operation == "return":
            if not confirm_return_baseline:
                raise HTTPException(
                    422,
                    "Explicitly confirm that the shown prescriptions match your current comfortable baseline",
                )
            if profile.interrupted:
                raise HTTPException(
                    409, "Confirm your current baseline in your profile before returning"
                )
            paused_at = saved.content.get("schedule_state", {}).get("paused_at")
            if paused_at:
                readiness = await db.get(WorkoutReadiness, user_id, populate_existing=True)
                from datetime import datetime

                if not readiness or readiness.confirmed_at <= datetime.fromisoformat(paused_at):
                    raise HTTPException(409, "Confirm fresh readiness after the pause")
        future_change_guard(
            saved.content,
            proposal.content["program"],
            ids,
            recorded,
            today,
            returning=operation == "return",
        )
        if operation != "pause":
            validate_calendar(proposal.content["program"], profile, ids)
        saved.content = deepcopy(proposal.content["program"])
        if operation == "pause":
            saved.content["schedule_state"]["paused_at"] = now().isoformat()
        if proposal.content.get("profile"):
            changed_profile = await db.get(WorkoutsProfile, user_id, populate_existing=True)
            changed_profile.content = TrainingProfile.model_validate(
                proposal.content["profile"]
            ).model_dump(mode="json")
            changed_profile.revision += 1
            changed_profile.updated_at = now()
            receipt["after_profile_revision"] = changed_profile.revision
        saved.revision += 1
        saved.updated_at = now()
        db.add(
            WorkoutsProgramVersion(
                id=uuid4(),
                program_id=saved.id,
                app_user_id=user_id,
                generation=generation,
                revision=saved.revision,
                content=saved.content,
            )
        )
    identifier = user_id if proposal.kind == "profile" else str(saved.id)
    proposal.accepted_record_id = None if proposal.kind == "profile" else saved.id
    proposal.accepted_at = now()
    await db.flush()
    receipt.update(
        state="accepted",
        record_id=identifier,
        after_revision=saved.revision,
        accepted_hash=await proposal_context_hash(db, user_id, generation),
        programs_hash=await owned_program_hash(db, user_id, generation),
    )
    message.proposals = metadata
    await db.commit()
    return {
        "proposal_id": str(proposal.id),
        "record_id": identifier,
        "revision": saved.revision,
        "state": "accepted",
    }


async def undo_action(db, user_id, generation, proposal_id):
    await membership_for(db, user_id, generation=generation, write=True)
    await require_ai_consent(db, user_id, generation)
    message, metadata, receipt = await receipt_for(db, user_id, generation, proposal_id)
    if receipt["state"] == "undone":
        return {"state": "undone", "proposal_id": str(proposal_id)}
    if receipt["state"] != "accepted" or receipt["accepted_hash"] != await proposal_context_hash(
        db, user_id, generation
    ):
        raise HTTPException(409, "Training history changed; inspect the current state before undo")
    proposal = await owned_record(db, WorkoutProposal, proposal_id, user_id, generation)
    if proposal.kind == "profile":
        saved = await db.get(WorkoutsProfile, user_id, populate_existing=True)
        if saved.revision != receipt["after_revision"] or receipt[
            "programs_hash"
        ] != await owned_program_hash(db, user_id, generation):
            raise HTTPException(409, "Profile or dependent plans changed after acceptance")
        saved.content = receipt["before"]
        saved.revision += 1
        saved.updated_at = now()
    elif proposal.kind == "schedule":
        saved = await owned_record(
            db, WorkoutsProgram, UUID(receipt["record_id"]), user_id, generation
        )
        profile, _ = await effective_profile(db, user_id, generation)
        today = now().astimezone(ZoneInfo(profile.timezone)).date()
        ids = set(proposal.content.get("session_ids", [proposal.content.get("session_id")]))
        recorded = await recorded_program_ids(db, user_id, generation, saved.id)
        if saved.revision != receipt["after_revision"]:
            raise HTTPException(409, "Program changed after acceptance")
        # Undo of a return may put unused future sessions back in its dormant pause queue.
        restoring_pause = receipt["before"].get("schedule_state", {}).get("status") == "paused"
        future_change_guard(
            saved.content,
            receipt["before"],
            ids,
            recorded,
            today,
            returning=restoring_pause,
            restoring=True,
        )
        if receipt.get("before_profile") is not None:
            changed_profile = await db.get(WorkoutsProfile, user_id, populate_existing=True)
            if changed_profile.revision != receipt["after_profile_revision"] or receipt[
                "programs_hash"
            ] != await owned_program_hash(db, user_id, generation):
                raise HTTPException(
                    409, "Training profile or dependent plans changed after stage acceptance"
                )
            changed_profile.content = receipt["before_profile"]
            changed_profile.revision += 1
            changed_profile.updated_at = now()
        saved.content = receipt["before"]
        saved.revision += 1
        saved.updated_at = now()
        db.add(
            WorkoutsProgramVersion(
                id=uuid4(),
                program_id=saved.id,
                app_user_id=user_id,
                generation=generation,
                revision=saved.revision,
                content=saved.content,
            )
        )
    else:
        model = WorkoutsProgram if proposal.kind == "program" else WorkoutRecord
        saved = await owned_record(db, model, UUID(receipt["record_id"]), user_id, generation)
        actual_column = (
            WorkoutsSession.source_program_id
            if model is WorkoutsProgram
            else WorkoutsSession.source_workout_id
        )
        used = await db.scalar(
            select(WorkoutsSession.id)
            .where(WorkoutsSession.app_user_id == user_id, actual_column == saved.id)
            .limit(1)
        )
        if saved.revision != receipt["after_revision"] or used:
            raise HTTPException(
                409, "This saved training item has changed or has actuals; it cannot be undone"
            )
        if model is WorkoutsProgram:
            profile, _ = await effective_profile(db, user_id, generation)
            today = now().astimezone(ZoneInfo(profile.timezone)).date()
            if any(
                date.fromisoformat(item["date"]) <= today
                for item in saved.content["proposal"]["sessions"]
            ):
                raise HTTPException(409, "Only an entirely future unused plan may be undone")
        else:
            # A pinned copy in a program is in use even when no actual is recorded.
            referenced = False
            for model in (WorkoutsProgram, WorkoutsProgramVersion):
                if await db.scalar(
                    select(model.id)
                    .where(
                        model.app_user_id == user_id,
                        model.generation == generation,
                        cast(model.content, String).contains(str(saved.id)),
                    )
                    .limit(1)
                ):
                    referenced = True
                    break
            version_ids = (
                await db.scalars(
                    select(WorkoutVersion.id).where(WorkoutVersion.workout_id == saved.id)
                )
            ).all()
            derived = await db.scalar(
                select(WorkoutRecord.id)
                .where(
                    WorkoutRecord.app_user_id == user_id,
                    WorkoutRecord.generation == generation,
                    WorkoutRecord.id != saved.id,
                    WorkoutRecord.content["parent_version_id"].astext.in_(
                        [str(identifier) for identifier in version_ids]
                    ),
                )
                .limit(1)
            )
            if derived or referenced:
                raise HTTPException(409, "A plan uses this workout; edit the plan first")
        await db.delete(saved)
    receipt["state"] = "undone"
    message.proposals = metadata
    await db.commit()
    return {"state": "undone", "proposal_id": str(proposal_id)}

"""Source review and deterministic proposals share the same private data domain."""

from datetime import date, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field, StrictBool, model_validator
from sqlalchemy import select

from app.config import get_settings
from app.domains.workouts.automation_models import WorkoutImport, WorkoutProposal, WorkoutReadiness
from app.domains.workouts.extraction import ExtractionRequest, WorkoutExtractionResult
from app.domains.workouts.imports import MAX_IMPORTS_PER_DAY, create_import, workout_import_worker
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
from app.domains.workouts.programming import adapt_workout
from app.domains.workouts.router import (
    Database,
    Generation,
    RecordResponse,
    User,
    content_digest,
    owned_record,
    record_response,
    validated_workout,
)
from app.domains.workouts.schemas import (
    ActivityContext,
    DomainModel,
    TrainingProfile,
    WorkoutContent,
)
from app.domains.workouts.security import WorkoutsImportRoute, WorkoutsRoute
from app.domains.workouts.source_planning import compose_library_program, convert_program_source

router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"], route_class=WorkoutsRoute)
imports_router = APIRouter(
    prefix="/api/v1/workouts", tags=["workouts"], route_class=WorkoutsImportRoute
)


@router.get("/capabilities")
async def capabilities(user: User, db: Database):
    membership = await membership_for(db, user.id)
    configured = get_settings()
    return {
        "generation": membership.generation,
        "public_beta": configured.workouts_public_access_enabled,
        "imports": configured.workouts_imports_enabled
        and configured.workouts_ai_enabled
        and configured.is_ai_capability_enabled("workout_extraction"),
        "coach": configured.workouts_ai_enabled
        and configured.is_ai_capability_enabled("workout_coach"),
        "health_sync": configured.workouts_health_sync_enabled,
        "limits": {
            "successful_or_pending_imports_per_rolling_day": MAX_IMPORTS_PER_DAY,
            "coach_messages_per_rolling_day": 50,
        },
        "billing_active": False,
    }


class ImportRequest(DomainModel):
    request_id: UUID
    source: ExtractionRequest


class ImportResponse(DomainModel):
    id: UUID
    generation: int
    status: Literal["queued", "processing", "ready", "incomplete", "failed", "cancelled", "expired"]
    attempt_count: int
    result: WorkoutExtractionResult | None
    expires_at: datetime
    accepted_workout_id: UUID | None


def import_response(row):
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "generation",
            "status",
            "attempt_count",
            "result",
            "expires_at",
            "accepted_workout_id",
        )
    }


@imports_router.post("/imports", status_code=202, response_model=ImportResponse)
async def import_source(request: ImportRequest, user: User, db: Database, generation: Generation):
    configured = get_settings()
    if (
        not configured.workouts_imports_enabled
        or not configured.workouts_ai_enabled
        or not configured.is_ai_capability_enabled("workout_extraction")
    ):
        raise HTTPException(503, "AI importing is unavailable; manual workouts remain available")
    if not request.source.ai_consent:
        raise HTTPException(403, "Explicit AI processing consent is required")
    row = await create_import(db, user.id, generation, request.request_id, request.source)
    workout_import_worker.notify()
    return import_response(row)


@router.get("/imports/{import_id}", response_model=ImportResponse)
async def get_import(import_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    row = await owned_record(db, WorkoutImport, import_id, user.id, membership.generation)
    if row.expires_at <= now():
        raise HTTPException(410, "Import expired; saved library workouts remain available")
    return import_response(row)


@router.get("/imports/{import_id}/source")
async def get_import_source(import_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    row = await owned_record(db, WorkoutImport, import_id, user.id, membership.generation)
    if row.expires_at <= now() or not row.payload:
        raise HTTPException(410, "The temporary capture has expired or was removed after review")
    return {"source": row.payload, "expires_at": row.expires_at}


@router.delete("/imports/{import_id}", response_model=ImportResponse)
async def cancel_import(import_id: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutImport, import_id, user.id, generation)
    row.status = "cancelled"
    row.payload = None
    row.result = None
    row.lease_token = None
    row.leased_until = None
    row.updated_at = now()
    await db.commit()
    workout_import_worker.cancel_owner(user.id)
    return import_response(row)


class AcceptImport(DomainModel):
    workout: WorkoutContent | None = None
    acknowledge_warnings: StrictBool = False


def store_workout(
    db, user_id, generation, content, *, original_content=None, parent_version_id=None
):
    identifier = uuid4()
    original_id = uuid4()
    first = dict(original_content or content) | {
        "id": str(identifier),
        "version": 1,
        "parent_version_id": parent_version_id,
    }
    changed = original_content is not None and content_digest(original_content) != content_digest(
        content
    )
    current = (
        (
            dict(content)
            | {"id": str(identifier), "version": 2, "parent_version_id": str(original_id)}
        )
        if changed
        else first
    )
    row = WorkoutRecord(
        id=identifier,
        app_user_id=user_id,
        generation=generation,
        revision=2 if changed else 1,
        content=current,
    )
    db.add(row)
    db.add(
        WorkoutVersion(
            id=original_id,
            workout_id=identifier,
            app_user_id=user_id,
            generation=generation,
            revision=1,
            content=first,
        )
    )
    if changed:
        db.add(
            WorkoutVersion(
                id=uuid4(),
                workout_id=identifier,
                app_user_id=user_id,
                generation=generation,
                revision=2,
                content=current,
            )
        )
    return row


@router.post("/imports/{import_id}/accept", response_model=RecordResponse)
async def accept_import(
    import_id: UUID, request: AcceptImport, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutImport, import_id, user.id, generation)
    if row.expires_at <= now():
        raise HTTPException(410, "Import expired")
    if row.status not in {"ready", "incomplete"} or not row.result or not row.result.get("workout"):
        raise HTTPException(409, "Wait for extraction or create a manual workout")
    if (
        row.status == "incomplete" or row.result.get("warnings")
    ) and not request.acknowledge_warnings:
        raise HTTPException(
            422, "Review missing values and source warnings before saving this draft"
        )
    workout = request.workout or WorkoutContent.model_validate(row.result["workout"])
    workout = workout.model_copy(
        update={
            "id": None,
            "version": 1,
            "parent_version_id": None,
            "capture_kind": row.result["workout"].get("capture_kind"),
        }
    )
    if workout.provenance == "suggestion" or any(
        ex.provenance == "suggestion" for block in workout.blocks for ex in block.exercises
    ):
        raise HTTPException(422, "An import cannot claim generated coaching provenance")
    content = validated_workout(workout, authored=False)
    original_content = validated_workout(
        WorkoutContent.model_validate(row.result["workout"]), authored=False
    )
    if content_digest(content) != content_digest(original_content):
        content["provenance"] = "user"
        original_exercises = {
            block["id"]: block["exercises"] for block in original_content["blocks"]
        }
        for block in content["blocks"]:
            original = original_exercises.get(block["id"], [])
            for index, exercise in enumerate(block["exercises"]):
                if index >= len(original) or content_digest(exercise) != content_digest(
                    original[index]
                ):
                    exercise["provenance"] = "user"
    digest = content_digest(content)
    if row.accepted_workout_id:
        if digest != row.accepted_content_hash:
            raise HTTPException(409, "Import already accepted with different content")
        return record_response(
            await owned_record(db, WorkoutRecord, row.accepted_workout_id, user.id, generation)
        )
    saved = store_workout(db, user.id, generation, content, original_content=original_content)
    row.payload = None
    row.accepted_workout_id = saved.id
    row.accepted_content_hash = digest
    await db.commit()
    return record_response(saved)


@router.delete("/library/{workout_id}", status_code=204)
async def remove_workout(workout_id: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutRecord, workout_id, user.id, generation)
    await db.delete(row)
    await db.commit()


class ReadinessRequest(DomainModel):
    state: Literal["ready", "limited", "unknown"]


@router.put("/readiness")
async def set_readiness(
    request: ReadinessRequest, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await db.get(WorkoutReadiness, user.id)
    if row is None:
        row = WorkoutReadiness(app_user_id=user.id, generation=generation)
        db.add(row)
    row.state = request.state
    row.confirmed_at = now()
    row.expires_at = row.confirmed_at + timedelta(hours=12)
    await db.commit()
    return {"state": row.state, "confirmed_at": row.confirmed_at, "expires_at": row.expires_at}


@router.get("/readiness")
async def get_readiness(user: User, db: Database):
    membership = await membership_for(db, user.id)
    row = await db.get(WorkoutReadiness, user.id)
    valid = row and row.generation == membership.generation and row.expires_at > now()
    return {
        "state": row.state if valid else "unknown",
        "confirmed_at": row.confirmed_at if valid else None,
        "expires_at": row.expires_at if valid else None,
    }


async def effective_profile(db, user_id, generation, expected_revision=None):
    row = await db.get(WorkoutsProfile, user_id, populate_existing=True)
    if not row or row.generation != generation:
        raise HTTPException(409, "Create your training profile first")
    if expected_revision is not None and row.revision != expected_revision:
        raise HTTPException(409, "Your profile changed; refresh before preparing a proposal")
    profile = TrainingProfile.model_validate(row.content)
    readiness = await db.get(WorkoutReadiness, user_id, populate_existing=True)
    state = (
        readiness.state
        if readiness and readiness.generation == generation and readiness.expires_at > now()
        else "unknown"
    )
    # Only deliberate manual activity enters this general profile. Imported
    # health rows and indirectly derived upstream records require their own
    # provenance/consent review and must not become AI context through this path.
    activities = [activity for activity in profile.other_activities if activity.origin_id is None]
    manual = (
        await db.scalars(
            select(WorkoutsActivity)
            .where(
                WorkoutsActivity.app_user_id == user_id,
                WorkoutsActivity.generation == generation,
                WorkoutsActivity.content["origin_id"].as_string().is_(None),
            )
            .order_by(WorkoutsActivity.created_at.desc())
            .limit(50)
        )
    ).all()
    activities = [ActivityContext.model_validate(record.content) for record in manual] + activities
    seen = set()
    unique = []
    for activity in activities:
        key = (activity.date, activity.name, activity.duration_minutes)
        if key not in seen:
            seen.add(key)
            unique.append(activity)
    return profile.model_copy(
        update={"readiness": state, "other_activities": unique[:500]}
    ), row.revision


class ProgramProposalRequest(DomainModel):
    start_date: date
    weeks: int = Field(default=4, strict=True, ge=1, le=12)
    profile_revision: int = Field(strict=True, ge=1)
    source_workout_ids: list[UUID] = Field(default_factory=list, max_length=10)
    source_mode: Literal["mixed", "selected"] = "mixed"
    reviewed_custom_routines: StrictBool = False
    source_minutes: dict[str, Annotated[int, Field(strict=True, ge=5, le=180)]] = Field(
        default_factory=dict, max_length=10
    )

    @model_validator(mode="after")
    def validate_sources(self):
        if len(set(self.source_workout_ids)) != len(self.source_workout_ids):
            raise ValueError("Selected source workouts must be unique")
        if not set(self.source_minutes) <= {str(value) for value in self.source_workout_ids}:
            raise ValueError("Source durations must refer to selected workouts")
        return self


class AdaptRequest(DomainModel):
    workout_id: UUID
    workout_revision: int = Field(strict=True, ge=1)
    profile_revision: int = Field(strict=True, ge=1)
    minutes: int | None = Field(default=None, strict=True, ge=5, le=180)


def proposal_response(row):
    return {
        "id": row.id,
        "generation": row.generation,
        "profile_revision": row.profile_revision,
        "proposal": row.content,
        "expires_at": row.expires_at,
        "accepted_record_id": row.accepted_record_id,
    }


async def proposal_context_hash(db, user_id, generation):
    profile = await db.get(WorkoutsProfile, user_id, populate_existing=True)
    readiness = await db.get(WorkoutReadiness, user_id, populate_existing=True)
    context = {
        "profile_revision": profile.revision if profile else 0,
        "readiness": [readiness.state, str(readiness.confirmed_at), str(readiness.expires_at)]
        if readiness and readiness.generation == generation
        else None,
    }
    for model, label in ((WorkoutsSession, "actuals"), (WorkoutsActivity, "activities")):
        rows = (
            await db.execute(
                select(model.id, model.created_at)
                .where(model.app_user_id == user_id, model.generation == generation)
                .order_by(model.created_at.desc(), model.id.desc())
                .limit(20)
            )
        ).all()
        context[label] = [(str(identifier), str(timestamp)) for identifier, timestamp in rows]
    return content_digest(context)


async def validate_proposal_context(db, row, user_id, generation):
    profile, _ = await effective_profile(db, user_id, generation, row.profile_revision)
    for pinned in row.source_versions or []:
        source = await owned_record(db, WorkoutRecord, UUID(pinned["id"]), user_id, generation)
        if source.revision != pinned["revision"]:
            raise HTTPException(409, "A selected source workout changed; prepare a fresh proposal")
    if profile.readiness != "ready" or row.context_hash != await proposal_context_hash(
        db, user_id, generation
    ):
        raise HTTPException(409, "Readiness or training history changed; prepare a fresh proposal")


async def persist_proposal(
    db, user_id, generation, kind, revision, content, *, target_id=None, target_revision=None
):
    row = WorkoutProposal(
        id=uuid4(),
        app_user_id=user_id,
        generation=generation,
        kind=kind,
        profile_revision=revision,
        context_hash=await proposal_context_hash(db, user_id, generation),
        target_id=target_id,
        target_revision=target_revision,
        content=content,
        expires_at=now() + timedelta(hours=12),
    )
    db.add(row)
    await db.flush()
    return row


@router.post("/program-proposals")
async def propose_program(
    request: ProgramProposalRequest, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    profile, revision = await effective_profile(db, user.id, generation, request.profile_revision)
    sources = [
        await owned_record(db, WorkoutRecord, identifier, user.id, generation)
        for identifier in request.source_workout_ids
    ]
    proposal = compose_library_program(
        profile,
        request.start_date,
        request.weeks,
        [(row.id, WorkoutContent.model_validate(row.content)) for row in sources],
        mode=request.source_mode,
        reviewed_custom=request.reviewed_custom_routines,
        declared_minutes=request.source_minutes,
    )
    row = await persist_proposal(
        db, user.id, generation, "program", revision, proposal.model_dump(mode="json")
    )
    row.source_versions = [
        {"id": str(source.id), "revision": source.revision} for source in sources
    ]
    await db.commit()
    return proposal_response(row)


@router.post("/adaptation-proposals")
async def propose_adaptation(
    request: AdaptRequest, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    profile, revision = await effective_profile(db, user.id, generation, request.profile_revision)
    source = await owned_record(db, WorkoutRecord, request.workout_id, user.id, generation)
    if source.revision != request.workout_revision:
        raise HTTPException(409, "Workout changed; refresh before adapting")
    result = adapt_workout(
        WorkoutContent.model_validate(source.content), profile, minutes=request.minutes
    )
    row = await persist_proposal(
        db,
        user.id,
        generation,
        "adaptation",
        revision,
        result.model_dump(mode="json"),
        target_id=source.id,
        target_revision=source.revision,
    )
    await db.commit()
    return proposal_response(row)


class SourceProgramDay(DomainModel):
    day_offset: int = Field(strict=True, ge=0, le=365)
    block_ids: list[str] = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    duration_minutes: int = Field(strict=True, ge=5, le=180)

    @model_validator(mode="after")
    def unique_blocks(self):
        if len(set(self.block_ids)) != len(self.block_ids):
            raise ValueError("A source block can occur once in each planned session")
        return self


class SourceProgramRequest(DomainModel):
    workout_id: UUID
    workout_revision: int = Field(strict=True, ge=1)
    profile_revision: int = Field(strict=True, ge=1)
    start_date: date
    days: list[SourceProgramDay] = Field(min_length=1, max_length=366)
    reviewed_custom_routines: StrictBool = False


@router.post("/program-proposals/from-source")
async def propose_source_program(
    request: SourceProgramRequest, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    profile, revision = await effective_profile(db, user.id, generation, request.profile_revision)
    source = await owned_record(db, WorkoutRecord, request.workout_id, user.id, generation)
    if source.revision != request.workout_revision:
        raise HTTPException(409, "Source program changed; refresh before assigning days")
    workout = WorkoutContent.model_validate(source.content)
    if workout.kind != "program":
        raise HTTPException(422, "Choose an imported program for explicit day assignment")
    result = convert_program_source(
        profile,
        request.start_date,
        workout,
        request.days,
        reviewed_custom=request.reviewed_custom_routines,
    )
    row = await persist_proposal(
        db, user.id, generation, "program", revision, result.model_dump(mode="json")
    )
    row.source_versions = [{"id": str(source.id), "revision": source.revision}]
    await db.commit()
    return proposal_response(row)


class AcceptProposal(DomainModel):
    title: str = Field(min_length=1, max_length=200)


@router.post("/program-proposals/{proposal_id}/accept", response_model=RecordResponse)
async def accept_program(
    proposal_id: UUID, request: AcceptProposal, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutProposal, proposal_id, user.id, generation)
    if row.kind != "program":
        raise HTTPException(404, "Program proposal not found")
    if row.accepted_record_id:
        return record_response(
            await owned_record(db, WorkoutsProgram, row.accepted_record_id, user.id, generation)
        )
    await validate_proposal_context(db, row, user.id, generation)
    if row.expires_at <= now() or row.content.get("status") != "ready":
        raise HTTPException(409, "The proposal needs current information or has expired")
    if not request.title.strip():
        raise HTTPException(422, "Program title cannot be blank")
    identifier = uuid4()
    content = {"title": request.title, "proposal": row.content}
    saved = WorkoutsProgram(
        id=identifier, app_user_id=user.id, generation=generation, revision=1, content=content
    )
    db.add(saved)
    db.add(
        WorkoutsProgramVersion(
            id=uuid4(),
            program_id=identifier,
            app_user_id=user.id,
            generation=generation,
            revision=1,
            content=content,
        )
    )
    row.accepted_record_id = identifier
    row.accepted_at = now()
    await db.commit()
    return record_response(saved)


@router.post("/adaptation-proposals/{proposal_id}/accept", response_model=RecordResponse)
async def accept_adaptation(proposal_id: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutProposal, proposal_id, user.id, generation)
    if row.kind != "adaptation":
        raise HTTPException(404, "Adaptation proposal not found")
    if row.accepted_record_id:
        return record_response(
            await owned_record(db, WorkoutRecord, row.accepted_record_id, user.id, generation)
        )
    await validate_proposal_context(db, row, user.id, generation)
    source = await owned_record(db, WorkoutRecord, row.target_id, user.id, generation)
    if source.revision != row.target_revision:
        raise HTTPException(409, "Workout changed; adapt the current version")
    if (
        row.expires_at <= now()
        or row.content.get("status") != "ready"
        or not row.content.get("workout")
    ):
        raise HTTPException(409, "Adaptation needs current information or has expired")
    source_version = await db.scalar(
        select(WorkoutVersion.id).where(
            WorkoutVersion.workout_id == source.id,
            WorkoutVersion.revision == source.revision,
            WorkoutVersion.app_user_id == user.id,
        )
    )
    saved = store_workout(
        db,
        user.id,
        generation,
        validated_workout(WorkoutContent.model_validate(row.content["workout"]), authored=False),
        parent_version_id=str(source_version),
    )
    row.accepted_record_id = saved.id
    row.accepted_at = now()
    await db.commit()
    return record_response(saved)

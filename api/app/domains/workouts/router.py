"""Private Workouts account/data API. Prescriptions never rewrite recorded actuals."""

import hashlib
import json
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import AwareDatetime, Field, StrictBool, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth import ClerkUser
from app.db import get_db
from app.domains.workouts.lifecycle import erase_product_data, lock_owner, membership_for, now
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsConsent,
    WorkoutsGrant,
    WorkoutsMembership,
    WorkoutsProfile,
    WorkoutsProgram,
    WorkoutsProgramVersion,
    WorkoutsSession,
    WorkoutVersion,
)
from app.domains.workouts.programming import RULE_VERSION, SOURCES
from app.domains.workouts.schemas import (
    ActivityContext,
    DomainModel,
    ProgramProposal,
    TrainingProfile,
    WorkoutContent,
)
from app.domains.workouts.security import WorkoutsRoute, require_workouts_user

router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"], route_class=WorkoutsRoute)
User = Annotated[ClerkUser, Depends(require_workouts_user)]
Database = Annotated[AsyncSession, Depends(get_db)]
Generation = Annotated[int, Header(alias="X-Workouts-Generation", ge=1, le=2_147_483_647)]
Limit = Annotated[int, Query(ge=1, le=50)]
Offset = Annotated[int, Query(ge=0, le=1_000_000)]
Revision = Annotated[int, Query(ge=1, le=2_147_483_647)]
CreationKey = Annotated[UUID | None, Header(alias="Idempotency-Key")]
DISCLOSURE_VERSION = 1
GrantScope = Literal[
    "recipes_library_context",
    "recipes_meal_plan_context",
    "health_activity_read",
    "health_activity_write",
    "health_body_measurements_read",
    "ai_health_context",
]


class EnrollmentRequest(DomainModel):
    adult_confirmed: StrictBool
    shared_account_deletion_acknowledged: StrictBool
    disclosure_version: int = Field(strict=True, ge=1, le=1)
    expected_generation: int | None = Field(default=None, strict=True, ge=1, le=2_147_483_647)

    @model_validator(mode="after")
    def require_acknowledgments(self):
        if not self.adult_confirmed or not self.shared_account_deletion_acknowledged:
            raise ValueError(
                "Adult confirmation and shared-account deletion acknowledgment are required"
            )
        return self


class EnrollmentResponse(DomainModel):
    enrolled: bool
    generation: int | None
    disclosure_version: int = DISCLOSURE_VERSION
    adult_confirmed: bool
    shared_account_deletion_acknowledged: bool
    enrolled_at: datetime | None


def enrollment_response(membership):
    active = membership is not None and membership.status == "active"
    return EnrollmentResponse(
        enrolled=active,
        generation=membership.generation if membership else None,
        adult_confirmed=active,
        shared_account_deletion_acknowledged=active,
        enrolled_at=membership.enrolled_at if active else None,
    )


class RecordResponse(DomainModel):
    id: UUID
    generation: int
    revision: int
    content: dict
    created_at: datetime
    updated_at: datetime


def record_response(record):
    return RecordResponse(
        id=record.id,
        generation=record.generation,
        revision=record.revision,
        content=record.content,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def bounded_content(content):
    def check(value):
        if isinstance(value, str) and len(value) > 4000:
            raise HTTPException(422, "A Workouts text field exceeds 4000 characters")
        if isinstance(value, dict):
            for item in value.values():
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)

    check(content)
    if len(json.dumps(content, ensure_ascii=False).encode()) > 240 * 1024:
        raise HTTPException(422, "Workouts content exceeds the saved-record limit")
    return content


def validated_workout(workout, *, authored=True):
    if not workout.title.strip() or any(
        not block.id.strip()
        or not block.label.strip()
        or any(not exercise.name.strip() for exercise in block.exercises)
        for block in workout.blocks
    ):
        raise HTTPException(422, "Workout title, block names, and exercise names cannot be blank")
    if authored and {"id", "version", "parent_version_id"} & workout.model_fields_set:
        raise HTTPException(422, "Workout identity and versions are assigned by the server")
    if workout.source_url:
        parsed = urlsplit(workout.source_url)
        try:
            parsed.port
        except ValueError as exc:
            raise HTTPException(422, "Invalid source URL") from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or any(ord(char) < 33 for char in workout.source_url)
        ):
            raise HTTPException(422, "Source URL must be an http(s) URL without credentials")
    if workout.provenance == "source" and not workout.source_url:
        raise HTTPException(422, "Source provenance requires a source URL")
    # A client-authored save cannot claim the server generated a recommendation.
    if authored and workout.provenance == "suggestion":
        raise HTTPException(422, "Save generated suggestions through the proposal acceptance flow")
    if len({block.id for block in workout.blocks}) != len(workout.blocks):
        raise HTTPException(422, "Workout block identifiers must be unique")
    for block in workout.blocks:
        for exercise in block.exercises:
            if exercise.provenance == "source" and not workout.source_url:
                raise HTTPException(422, "Source exercise provenance requires a source URL")
            if authored and exercise.provenance == "suggestion":
                raise HTTPException(
                    422, "Client-authored exercises cannot claim server suggestions"
                )
    return bounded_content(workout.model_dump(mode="json"))


def expected_profile_revision(value):
    if value is None:
        raise HTTPException(428, "If-Match profile revision is required")
    text = value.strip().strip('"')
    if not text.isdecimal() or len(text) > 10 or int(text) > 2_147_483_647:
        raise HTTPException(422, "If-Match must name one profile revision")
    return int(text)


async def owned_record(db, model, record_id, user_id, generation):
    record = await db.scalar(
        select(model).where(
            model.id == record_id, model.app_user_id == user_id, model.generation == generation
        )
    )
    if record is None:
        raise HTTPException(404, "Record not found")
    return record


async def list_owned(db, model, user_id, generation, limit, offset):
    return (
        await db.scalars(
            select(model)
            .where(model.app_user_id == user_id, model.generation == generation)
            .order_by(model.created_at.desc(), model.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()


def content_digest(content):
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def replay_creation(db, model, user_id, generation, key, digest):
    if key is None:
        return None
    existing = await db.scalar(
        select(model).where(
            model.app_user_id == user_id,
            model.generation == generation,
            model.creation_request_id == key,
        )
    )
    if existing and existing.creation_request_hash != digest:
        raise HTTPException(409, "Creation identity was already used for different content")
    return existing


@router.get("/enrollment", response_model=EnrollmentResponse)
async def get_enrollment(user: User, db: Database):
    return enrollment_response(await db.get(WorkoutsMembership, user.id))


@router.post("/enrollment", response_model=EnrollmentResponse)
async def enroll(request: EnrollmentRequest, user: User, db: Database):
    await lock_owner(db, user.id)
    membership = await db.get(WorkoutsMembership, user.id)
    if membership is None:
        if request.expected_generation is not None:
            raise HTTPException(409, "Enrollment generation changed; refresh before enrolling")
        membership = WorkoutsMembership(
            app_user_id=user.id,
            generation=1,
            status="active",
            disclosure_version=DISCLOSURE_VERSION,
            adult_confirmed_at=now(),
            deletion_acknowledged_at=now(),
            enrolled_at=now(),
        )
        db.add(membership)
    else:
        if membership.status == "deleted" and request.expected_generation != membership.generation:
            raise HTTPException(409, "Explicit current-generation re-enrollment is required")
        if (
            request.expected_generation is not None
            and request.expected_generation != membership.generation
        ):
            raise HTTPException(409, "Enrollment generation changed; refresh before enrolling")
        if membership.status == "deleted":
            membership.status = "active"
            membership.disclosure_version = DISCLOSURE_VERSION
            membership.adult_confirmed_at = membership.deletion_acknowledged_at = (
                membership.enrolled_at
            ) = now()
            membership.deleted_at = None
    await db.commit()
    return enrollment_response(membership)


@router.get("/profile", response_model=TrainingProfile | None)
async def get_profile(response: Response, user: User, db: Database):
    membership = await membership_for(db, user.id)
    profile = await db.get(WorkoutsProfile, user.id)
    if profile and profile.generation != membership.generation:
        raise HTTPException(409, "Profile generation changed")
    revision = profile.revision if profile else 0
    response.headers["X-Workouts-Revision"] = str(revision)
    response.headers["ETag"] = f'"{revision}"'
    response.headers["Cache-Control"] = "no-store"
    return profile.content if profile else None


@router.put("/profile", response_model=TrainingProfile)
async def put_profile(
    profile: TrainingProfile,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
    if_match: Annotated[str | None, Header()] = None,
):
    revision = expected_profile_revision(if_match)
    await membership_for(db, user.id, generation=generation, write=True)
    existing = await db.get(WorkoutsProfile, user.id)
    if existing and existing.generation != generation:
        raise HTTPException(409, "Profile generation changed; refresh before saving")
    if (existing.revision if existing else 0) != revision:
        raise HTTPException(409, "Profile changed; refresh before saving")
    if "adult_confirmed" in profile.model_fields_set and not profile.adult_confirmed:
        raise HTTPException(422, "The enrolled adult profile cannot revoke adult confirmation")
    content = bounded_content(
        profile.model_copy(update={"adult_confirmed": True}).model_dump(mode="json")
    )
    if existing is None:
        existing = WorkoutsProfile(
            app_user_id=user.id, generation=generation, revision=1, content=content
        )
        db.add(existing)
    else:
        existing.content = content
        existing.revision += 1
        existing.updated_at = now()
    await db.commit()
    response.headers["X-Workouts-Revision"] = str(existing.revision)
    response.headers["ETag"] = f'"{existing.revision}"'
    response.headers["Cache-Control"] = "no-store"
    return existing.content


@router.get("/library", response_model=list[RecordResponse])
async def list_library(user: User, db: Database, limit: Limit = 20, offset: Offset = 0):
    membership = await membership_for(db, user.id)
    return [
        record_response(row)
        for row in await list_owned(
            db, WorkoutRecord, user.id, membership.generation, limit, offset
        )
    ]


@router.post("/library", response_model=RecordResponse, status_code=201)
async def create_workout(
    workout: WorkoutContent,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
    idempotency_key: CreationKey = None,
):
    await membership_for(db, user.id, generation=generation, write=True)
    content = validated_workout(workout)
    digest = content_digest(content)
    existing = await replay_creation(
        db, WorkoutRecord, user.id, generation, idempotency_key, digest
    )
    if existing:
        response.status_code = 200
        return record_response(existing)
    identifier = uuid4()
    content.update(id=str(identifier), version=1, parent_version_id=None)
    row = WorkoutRecord(
        id=identifier,
        app_user_id=user.id,
        generation=generation,
        revision=1,
        content=content,
        creation_request_id=idempotency_key,
        creation_request_hash=digest,
    )
    db.add(row)
    await db.flush()
    db.add(
        WorkoutVersion(
            app_user_id=user.id,
            generation=generation,
            workout_id=identifier,
            revision=1,
            content=content,
        )
    )
    await db.commit()
    return record_response(row)


@router.get("/library/{workout_id}", response_model=RecordResponse)
async def get_workout(workout_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    return record_response(
        await owned_record(db, WorkoutRecord, workout_id, user.id, membership.generation)
    )


@router.put("/library/{workout_id}", response_model=RecordResponse)
async def update_workout(
    workout_id: UUID,
    workout: WorkoutContent,
    user: User,
    db: Database,
    generation: Generation,
    expected_revision: Revision,
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutRecord, workout_id, user.id, generation)
    if row.revision != expected_revision:
        raise HTTPException(409, "Workout changed; refresh before saving")
    content = validated_workout(workout)
    prior = await db.scalar(
        select(WorkoutVersion.id).where(
            WorkoutVersion.workout_id == row.id, WorkoutVersion.revision == row.revision
        )
    )
    row.revision += 1
    content.update(id=str(row.id), version=row.revision, parent_version_id=str(prior))
    row.content = content
    row.updated_at = now()
    db.add(
        WorkoutVersion(
            app_user_id=user.id,
            generation=generation,
            workout_id=row.id,
            revision=row.revision,
            content=content,
        )
    )
    await db.commit()
    return record_response(row)


@router.get("/library/{workout_id}/versions", response_model=list[RecordResponse])
async def workout_versions(
    workout_id: UUID, user: User, db: Database, limit: Limit = 20, offset: Offset = 0
):
    membership = await membership_for(db, user.id)
    await owned_record(db, WorkoutRecord, workout_id, user.id, membership.generation)
    rows = (
        await db.scalars(
            select(WorkoutVersion)
            .where(
                WorkoutVersion.workout_id == workout_id,
                WorkoutVersion.app_user_id == user.id,
                WorkoutVersion.generation == membership.generation,
            )
            .order_by(WorkoutVersion.revision.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [
        RecordResponse(
            id=row.id,
            generation=row.generation,
            revision=row.revision,
            content=row.content,
            created_at=row.created_at,
            updated_at=row.created_at,
        )
        for row in rows
    ]


class ProgramRequest(DomainModel):
    title: str = Field(min_length=1, max_length=200)
    proposal: ProgramProposal

    @model_validator(mode="after")
    def validate_program(self):
        proposal = self.proposal
        if not self.title.strip():
            raise ValueError("Program title cannot be blank")
        if proposal.status != "ready":
            raise ValueError("Resolve program questions/conflicts before scheduling")
        if proposal.rule_version != RULE_VERSION or any(
            source not in SOURCES for source in proposal.source_ids
        ):
            raise ValueError("Unrecognized programming rule/source provenance")
        if not 1 <= len(proposal.sessions) <= 366:
            raise ValueError("A program requires 1 through 366 sessions")
        if len({session.id for session in proposal.sessions}) != len(proposal.sessions):
            raise ValueError("Program session identifiers must be unique")
        return self


def program_content(request):
    for session in request.proposal.sessions:
        validated_workout(session.workout, authored=False)
    return bounded_content(request.model_dump(mode="json"))


@router.get("/programs", response_model=list[RecordResponse])
async def list_programs(user: User, db: Database, limit: Limit = 20, offset: Offset = 0):
    membership = await membership_for(db, user.id)
    return [
        record_response(row)
        for row in await list_owned(
            db, WorkoutsProgram, user.id, membership.generation, limit, offset
        )
    ]


@router.post("/programs", response_model=RecordResponse, status_code=201)
async def create_program(
    request: ProgramRequest,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
    idempotency_key: CreationKey = None,
):
    await membership_for(db, user.id, generation=generation, write=True)
    content = program_content(request)
    digest = content_digest(content)
    existing = await replay_creation(
        db, WorkoutsProgram, user.id, generation, idempotency_key, digest
    )
    if existing:
        response.status_code = 200
        return record_response(existing)
    row = WorkoutsProgram(
        id=uuid4(),
        app_user_id=user.id,
        generation=generation,
        revision=1,
        content=content,
        creation_request_id=idempotency_key,
        creation_request_hash=digest,
    )
    db.add(row)
    await db.flush()
    db.add(
        WorkoutsProgramVersion(
            app_user_id=user.id,
            generation=generation,
            program_id=row.id,
            revision=1,
            content=row.content,
        )
    )
    await db.commit()
    return record_response(row)


@router.get("/programs/{program_id}", response_model=RecordResponse)
async def get_program(program_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    return record_response(
        await owned_record(db, WorkoutsProgram, program_id, user.id, membership.generation)
    )


@router.put("/programs/{program_id}", response_model=RecordResponse)
async def update_program(
    program_id: UUID,
    request: ProgramRequest,
    user: User,
    db: Database,
    generation: Generation,
    expected_revision: Revision,
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutsProgram, program_id, user.id, generation)
    if row.revision != expected_revision:
        raise HTTPException(409, "Program changed; refresh before saving")
    row.content = program_content(request)
    row.revision += 1
    row.updated_at = now()
    db.add(
        WorkoutsProgramVersion(
            app_user_id=user.id,
            generation=generation,
            program_id=row.id,
            revision=row.revision,
            content=row.content,
        )
    )
    await db.commit()
    return record_response(row)


@router.get("/programs/{program_id}/versions", response_model=list[RecordResponse])
async def program_versions(
    program_id: UUID, user: User, db: Database, limit: Limit = 20, offset: Offset = 0
):
    membership = await membership_for(db, user.id)
    await owned_record(db, WorkoutsProgram, program_id, user.id, membership.generation)
    rows = (
        await db.scalars(
            select(WorkoutsProgramVersion)
            .where(
                WorkoutsProgramVersion.program_id == program_id,
                WorkoutsProgramVersion.app_user_id == user.id,
                WorkoutsProgramVersion.generation == membership.generation,
            )
            .order_by(WorkoutsProgramVersion.revision.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [
        RecordResponse(
            id=row.id,
            generation=row.generation,
            revision=row.revision,
            content=row.content,
            created_at=row.created_at,
            updated_at=row.created_at,
        )
        for row in rows
    ]


class ActualSet(DomainModel):
    block_id: str = Field(min_length=1, max_length=100)
    exercise_index: int = Field(strict=True, ge=0, le=99)
    set_index: int = Field(strict=True, ge=1, le=100)
    round_index: int = Field(default=1, strict=True, ge=1, le=100)
    side: Literal["left", "right", "both"] | None = None
    effort: float | None = Field(default=None, strict=True, ge=0, le=10)
    reps: int | None = Field(default=None, strict=True, ge=0, le=1000)
    duration_seconds: int | None = Field(default=None, strict=True, ge=0, le=86400)
    distance_meters: float | None = Field(default=None, strict=True, ge=0, le=1000000)
    load: float | None = Field(default=None, strict=True, ge=0, le=2000)
    load_unit: Literal["kg", "lb"] | None = None
    load_convention: Literal["total", "per_hand", "added", "assistance"] | None = None
    completed: StrictBool = False
    difficulty: Literal["easy", "manageable", "hard"] | None = None
    pain_reported: StrictBool | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_load(self):
        if self.load is not None and (self.load_unit is None or self.load_convention is None):
            raise ValueError("Actual load requires a unit and convention")
        return self


class SessionRequest(DomainModel):
    client_session_id: UUID
    workout_id: UUID | None = None
    workout_revision: int | None = Field(default=None, strict=True, ge=1)
    program_id: UUID | None = None
    program_revision: int | None = Field(default=None, strict=True, ge=1)
    program_session_id: str | None = Field(default=None, max_length=100)
    started_at: AwareDatetime
    finished_at: AwareDatetime
    status: Literal["completed", "partial"]
    actuals: list[ActualSet] = Field(default_factory=list, max_length=1000)
    notes: str | None = Field(default=None, max_length=4000)
    supersedes_session_id: UUID | None = None

    @model_validator(mode="after")
    def validate_session(self):
        if self.finished_at < self.started_at:
            raise ValueError("Session finish must not precede start")
        if bool(self.workout_id) == bool(self.program_id):
            raise ValueError("Select exactly one owned workout or program session")
        if self.workout_id and (
            self.workout_revision is None or self.program_revision or self.program_session_id
        ):
            raise ValueError("Workout sessions require a workout revision only")
        if self.program_id and (
            self.program_revision is None or not self.program_session_id or self.workout_revision
        ):
            raise ValueError("Program sessions require a program revision and session identifier")
        keys = [
            (item.block_id, item.exercise_index, item.round_index, item.set_index, item.side)
            for item in self.actuals
        ]
        if len(set(keys)) != len(keys):
            raise ValueError("Actual set identities must be unique")
        return self


class SessionResponse(DomainModel):
    id: UUID
    generation: int
    client_session_id: UUID
    content: dict
    created_at: datetime


def session_response(row):
    return SessionResponse(
        id=row.id,
        generation=row.generation,
        client_session_id=row.client_session_id,
        content=row.content,
        created_at=row.created_at,
    )


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    user: User,
    db: Database,
    limit: Limit = 20,
    offset: Offset = 0,
    include_superseded: bool = False,
):
    membership = await membership_for(db, user.id)
    statement = select(WorkoutsSession).where(
        WorkoutsSession.app_user_id == user.id, WorkoutsSession.generation == membership.generation
    )
    if not include_superseded:
        correction = aliased(WorkoutsSession)
        statement = statement.where(
            ~select(correction.id)
            .where(
                correction.supersedes_session_id == WorkoutsSession.id,
                correction.app_user_id == user.id,
                correction.generation == membership.generation,
            )
            .exists()
        )
    rows = (
        await db.scalars(
            statement.order_by(WorkoutsSession.created_at.desc(), WorkoutsSession.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [session_response(row) for row in rows]


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    return session_response(
        await owned_record(db, WorkoutsSession, session_id, user.id, membership.generation)
    )


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def record_session(
    request: SessionRequest, response: Response, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    content = bounded_content(request.model_dump(mode="json"))
    digest = hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    existing = await db.scalar(
        select(WorkoutsSession).where(
            WorkoutsSession.app_user_id == user.id,
            WorkoutsSession.generation == generation,
            WorkoutsSession.client_session_id == request.client_session_id,
        )
    )
    if existing:
        if existing.request_hash != digest:
            raise HTTPException(
                409, "Client session identity was already used for different actuals"
            )
        response.status_code = 200
        return session_response(existing)
    if request.supersedes_session_id:
        previous = await owned_record(
            db, WorkoutsSession, request.supersedes_session_id, user.id, generation
        )
        corrected = await db.scalar(
            select(WorkoutsSession.id).where(WorkoutsSession.supersedes_session_id == previous.id)
        )
        if corrected:
            raise HTTPException(409, "Correct the latest session revision")
    if request.workout_id:
        source = await owned_record(db, WorkoutRecord, request.workout_id, user.id, generation)
        snapshot = await db.scalar(
            select(WorkoutVersion.content).where(
                WorkoutVersion.workout_id == source.id,
                WorkoutVersion.revision == request.workout_revision,
                WorkoutVersion.app_user_id == user.id,
            )
        )
    else:
        source = await owned_record(db, WorkoutsProgram, request.program_id, user.id, generation)
        program_snapshot = await db.scalar(
            select(WorkoutsProgramVersion.content).where(
                WorkoutsProgramVersion.program_id == source.id,
                WorkoutsProgramVersion.revision == request.program_revision,
                WorkoutsProgramVersion.app_user_id == user.id,
            )
        )
        snapshot = next(
            (
                item["workout"]
                for item in (program_snapshot or {}).get("proposal", {}).get("sessions", [])
                if item["id"] == request.program_session_id
            ),
            None,
        )
    if snapshot is None:
        raise HTTPException(409, "The selected prescription version does not exist")
    blocks = {block["id"]: block for block in snapshot["blocks"]}
    for actual in request.actuals:
        block = blocks.get(actual.block_id)
        if block is None or actual.exercise_index >= len(block["exercises"]):
            raise HTTPException(422, "An actual set does not reference the saved prescription")
    content["prescription_snapshot"] = snapshot
    row = WorkoutsSession(
        app_user_id=user.id,
        generation=generation,
        client_session_id=request.client_session_id,
        request_hash=digest,
        source_workout_id=request.workout_id,
        source_program_id=request.program_id,
        supersedes_session_id=request.supersedes_session_id,
        content=bounded_content(content),
    )
    db.add(row)
    await db.commit()
    return session_response(row)


class ConsentRequest(DomainModel):
    accepted: StrictBool
    disclosure_version: int = Field(strict=True, ge=1, le=1)


class ConsentResponse(DomainModel):
    accepted: bool
    disclosure_version: int = DISCLOSURE_VERSION
    accepted_at: datetime | None


def consent_response(row):
    return ConsentResponse(
        accepted=bool(row and row.accepted_at), accepted_at=row.accepted_at if row else None
    )


@router.get("/ai-consent", response_model=ConsentResponse)
async def get_ai_consent(user: User, db: Database):
    await membership_for(db, user.id)
    return consent_response(await db.get(WorkoutsConsent, user.id))


@router.put("/ai-consent", response_model=ConsentResponse)
async def update_ai_consent(
    request: ConsentRequest, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await db.get(WorkoutsConsent, user.id)
    if row is None:
        row = WorkoutsConsent(
            app_user_id=user.id, generation=generation, disclosure_version=DISCLOSURE_VERSION
        )
        db.add(row)
    row.accepted_at = now() if request.accepted else None
    await db.commit()
    return consent_response(row)


class GrantRequest(DomainModel):
    scopes: list[GrantScope] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def unique_scopes(self):
        if len(set(self.scopes)) != len(self.scopes):
            raise ValueError("Grant scopes must be unique")
        return self


class GrantResponse(DomainModel):
    scope: GrantScope
    granted_at: datetime


async def grants_for(db, user_id, generation):
    return [
        GrantResponse(scope=row.scope, granted_at=row.granted_at)
        for row in (
            await db.scalars(
                select(WorkoutsGrant)
                .where(WorkoutsGrant.app_user_id == user_id, WorkoutsGrant.generation == generation)
                .order_by(WorkoutsGrant.scope)
            )
        ).all()
    ]


@router.get("/grants", response_model=list[GrantResponse])
async def get_grants(user: User, db: Database):
    membership = await membership_for(db, user.id)
    return await grants_for(db, user.id, membership.generation)


@router.put("/grants", response_model=list[GrantResponse])
async def replace_grants(request: GrantRequest, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    await db.execute(delete(WorkoutsGrant).where(WorkoutsGrant.app_user_id == user.id))
    for scope in request.scopes:
        db.add(WorkoutsGrant(app_user_id=user.id, generation=generation, scope=scope))
    await db.commit()
    return await grants_for(db, user.id, generation)


class ActivityResponse(DomainModel):
    id: UUID
    generation: int
    content: ActivityContext
    created_at: datetime


@router.get("/activities", response_model=list[ActivityResponse])
async def list_activities(user: User, db: Database, limit: Limit = 20, offset: Offset = 0):
    membership = await membership_for(db, user.id)
    return [
        ActivityResponse(
            id=row.id, generation=row.generation, content=row.content, created_at=row.created_at
        )
        for row in await list_owned(
            db, WorkoutsActivity, user.id, membership.generation, limit, offset
        )
    ]


@router.post("/activities", response_model=ActivityResponse, status_code=201)
async def create_activity(
    activity: ActivityContext, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    if activity.origin_id is not None:
        raise HTTPException(
            422, "External activity provenance is assigned by the synchronization service"
        )
    row = WorkoutsActivity(
        app_user_id=user.id,
        generation=generation,
        content=bounded_content(activity.model_dump(mode="json")),
    )
    db.add(row)
    await db.commit()
    return ActivityResponse(
        id=row.id, generation=generation, content=row.content, created_at=row.created_at
    )


@router.delete("/data", response_model=EnrollmentResponse)
async def delete_data(user: User, db: Database, generation: Generation):
    membership = await membership_for(db, user.id, write=True, active=False)
    await erase_product_data(db, membership, generation)
    await db.commit()
    return enrollment_response(membership)


class ExportResponse(DomainModel):
    schema_version: Literal[1] = 1
    generated_at: datetime
    enrollment: EnrollmentResponse
    profile: TrainingProfile | None
    profile_revision: int
    ai_consent: ConsentResponse
    grants: list[GrantResponse]
    datasets: dict[str, list[dict]]
    totals: dict[str, int]
    has_more: dict[str, bool]
    offset: int
    limit: int


@router.get("/export", response_model=ExportResponse)
async def export_data(
    response: Response,
    user: User,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=10)] = 10,
    offset: Offset = 0,
):
    membership = await membership_for(db, user.id)
    profile = await db.get(WorkoutsProfile, user.id)
    datasets, totals = {}, {}
    for name, model in (
        ("workouts", WorkoutRecord),
        ("workout_versions", WorkoutVersion),
        ("programs", WorkoutsProgram),
        ("program_versions", WorkoutsProgramVersion),
        ("sessions", WorkoutsSession),
        ("activities", WorkoutsActivity),
    ):
        records = await list_owned(db, model, user.id, membership.generation, limit, offset)
        totals[name] = await db.scalar(
            select(func.count())
            .select_from(model)
            .where(model.app_user_id == user.id, model.generation == membership.generation)
        )
        datasets[name] = [
            {
                "id": str(row.id),
                "content": row.content,
                "revision": getattr(row, "revision", None),
                "created_at": row.created_at.isoformat(),
                "client_session_id": str(row.client_session_id)
                if model is WorkoutsSession
                else None,
                "workout_id": str(row.workout_id) if model is WorkoutVersion else None,
                "program_id": str(row.program_id) if model is WorkoutsProgramVersion else None,
            }
            for row in records
        ]
    response.headers["Cache-Control"] = "no-store"
    return ExportResponse(
        generated_at=now(),
        enrollment=enrollment_response(membership),
        profile=profile.content if profile else None,
        profile_revision=profile.revision if profile else 0,
        ai_consent=consent_response(await db.get(WorkoutsConsent, user.id)),
        grants=await grants_for(db, user.id, membership.generation),
        datasets=datasets,
        totals=totals,
        has_more={name: offset + len(rows) < totals[name] for name, rows in datasets.items()},
        offset=offset,
        limit=limit,
    )

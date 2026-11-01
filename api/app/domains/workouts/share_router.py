"""Restricted link intake: no library reads, edits, Clerk JWTs, or Recipes authority."""

import hashlib
import secrets
from datetime import timedelta
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field, StrictBool, field_validator
from sqlalchemy import delete, func, select

from app.config import get_settings
from app.domains.workouts.automation_models import WorkoutImport
from app.domains.workouts.discover import require_discover
from app.domains.workouts.extraction import ExtractionFailure, ExtractionRequest, _safe_url
from app.domains.workouts.imports import create_import, require_ai_consent, workout_import_worker
from app.domains.workouts.lifecycle import membership_for, now, optional_table_exists
from app.domains.workouts.router import Database, Generation, User
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute
from app.domains.workouts.share_models import WorkoutShareCredential
from app.grocery_sync import grocery_account_scope_id
from app.publishing import require_current_publishing_disclosure

router = APIRouter(prefix="/api/v1/workouts/share", tags=["workouts"], route_class=WorkoutsRoute)
security = HTTPBearer(auto_error=False)


def digest(value):
    return hashlib.sha256(b"hafa:workouts-share:v1\0" + value.encode()).hexdigest()


def parse_token(token):
    try:
        prefix, identifier, secret = token.split(".", 2)
        if len(token) > 256 or prefix != "hfws_v1" or not 40 <= len(secret) <= 128:
            return None
        if not all(char.isascii() and (char.isalnum() or char in "-_") for char in secret):
            return None
        return UUID(identifier), digest(secret)
    except (ValueError, TypeError):
        return None


async def require_share_schema(db):
    if not await optional_table_exists(db, "workouts_share_credentials"):
        raise HTTPException(503, "Workout sharing is being prepared; use Import in the app")


async def share_credential(
    db: Database,
    bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
):
    await require_share_schema(db)
    parsed = parse_token(bearer.credentials) if bearer else None
    row = await db.get(WorkoutShareCredential, parsed[0]) if parsed else None
    if row is None or not secrets.compare_digest(row.token_hash, parsed[1]):
        raise HTTPException(401, "Reconnect workout sharing in Håfa Workouts")
    await membership_for(db, row.app_user_id, generation=row.generation, write=True)
    row = await db.scalar(
        select(WorkoutShareCredential).where(WorkoutShareCredential.id == parsed[0])
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise HTTPException(401, "Reconnect workout sharing in Håfa Workouts")
    configured = get_settings()
    if (
        row.revoked_at is not None
        or row.expires_at <= now()
        or not secrets.compare_digest(row.token_hash, parsed[1])
        or (
            not configured.workouts_public_access_enabled
            and row.app_user_id not in configured.workouts_testers
        )
    ):
        raise HTTPException(401, "Reconnect workout sharing in Håfa Workouts")
    return row


Credential = Annotated[WorkoutShareCredential, Depends(share_credential)]


class SessionRequest(DomainModel):
    installation_id: UUID
    is_public: StrictBool = False


@router.post("/session", status_code=201)
async def provision(request: SessionRequest, user: User, db: Database, generation: Generation):
    await require_share_schema(db)
    await membership_for(db, user.id, generation=generation, write=True)
    consent = await require_ai_consent(db, user.id, generation)
    if request.is_public:
        await require_discover(db)
        await require_current_publishing_disclosure(db, user.id)
    await db.execute(
        delete(WorkoutShareCredential).where(
            WorkoutShareCredential.app_user_id == user.id,
            WorkoutShareCredential.expires_at <= now(),
        )
    )
    installation = digest(str(request.installation_id))
    row = await db.scalar(
        select(WorkoutShareCredential).where(
            WorkoutShareCredential.app_user_id == user.id,
            WorkoutShareCredential.generation == generation,
            WorkoutShareCredential.installation_hash == installation,
        )
    )
    if row is None:
        count = await db.scalar(
            select(func.count())
            .select_from(WorkoutShareCredential)
            .where(
                WorkoutShareCredential.app_user_id == user.id,
                WorkoutShareCredential.revoked_at.is_(None),
            )
        )
        if count >= 5:
            raise HTTPException(409, "Too many sharing installations; reconnect an existing one")
        row = WorkoutShareCredential(
            id=uuid4(), app_user_id=user.id, generation=generation, installation_hash=installation
        )
        db.add(row)
    secret = secrets.token_urlsafe(32)
    row.token_hash = digest(secret)
    row.is_public = request.is_public
    row.display_name = (user.display_name or "Håfa member")[:100]
    row.ai_accepted_at = consent.accepted_at
    row.expires_at = now() + timedelta(days=30)
    row.revoked_at = None
    await db.commit()
    return {
        "credential_id": str(row.id),
        "token": f"hfws_v1.{row.id}.{secret}",
        "account_scope_id": grocery_account_scope_id(user.id),
        "generation": generation,
        "expires_at": row.expires_at,
        "is_public": row.is_public,
    }


@router.delete("/session", status_code=204)
async def revoke(db: Database, credential: Credential):
    credential.revoked_at = now()
    await db.commit()
    return Response(status_code=204)


class CaptureRequest(DomainModel):
    capture_id: UUID
    url: str = Field(min_length=1, max_length=2000)
    is_public: StrictBool = False
    typed_formats: StrictBool = False  # The sharing build runs EMOM/for-time/work-rest formats.

    @field_validator("url")
    @classmethod
    def validate_source(cls, value):
        try:
            return _safe_url(value)
        except ExtractionFailure as error:
            raise ValueError("Share a public http(s) workout link") from error


@router.post("/imports", status_code=202)
async def submit(request: CaptureRequest, db: Database, credential: Credential):
    configured = get_settings()
    if not configured.workouts_imports_enabled or not configured.workouts_ai_enabled:
        raise HTTPException(503, "Workout importing is unavailable; your capture remains saved")
    if not configured.is_ai_capability_enabled("workout_extraction"):
        raise HTTPException(503, "Workout extraction is temporarily unavailable")
    await require_ai_consent(
        db, credential.app_user_id, credential.generation, expected=credential.ai_accepted_at
    )
    if request.is_public:
        if not credential.is_public:
            raise HTTPException(403, "Open Workouts to enable sharing to Discover")
        await require_discover(db)
        await require_current_publishing_disclosure(db, credential.app_user_id)
    source = ExtractionRequest(kind="url", source_url=request.url, ai_consent=True,
                               typed_formats=request.typed_formats)
    existing = await db.scalar(
        select(WorkoutImport).where(
            WorkoutImport.app_user_id == credential.app_user_id,
            WorkoutImport.generation == credential.generation,
            WorkoutImport.request_id == request.capture_id,
        )
    )
    row = await create_import(
        db,
        credential.app_user_id,
        credential.generation,
        request.capture_id,
        source,
        auto_save=True,
        is_public=request.is_public,
        display_name=credential.display_name,
    )
    workout_import_worker.notify()
    return {
        "capture_id": str(request.capture_id),
        "job_id": str(row.id),
        "generation": row.generation,
        "workout_id": str(row.accepted_workout_id) if row.accepted_workout_id else None,
        "replayed": existing is not None,
    }

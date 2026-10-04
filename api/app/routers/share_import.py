"""Provision/revoke a native link-import capability and accept durable captures."""

from datetime import datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import String, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.grocery_sync import grocery_account_scope_id
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob
from app.models.share_import import ShareImportCredential, ShareImportReceipt
from app.publishing import require_current_publishing_disclosure
from app.routers.extract import ExtractRequest, start_extraction_job
from app.share_credentials import SCOPE, TTL, get_share_credential, installation_hash, issue_token
from app.widget_credentials import utc_now

router = APIRouter(prefix="/api/share", tags=["share-import"])


class CredentialRequest(BaseModel):
    installation_id: UUID
    location: str = Field(default="Guam", min_length=1, max_length=100)
    is_public: bool = False
    model_config = ConfigDict(extra="forbid")


class CredentialResponse(BaseModel):
    credential_id: UUID
    token: str
    account_scope_id: str
    expires_at: datetime
    location: str
    is_public: bool


class ImportRequest(BaseModel):
    capture_id: UUID
    url: str = Field(min_length=1, max_length=2048)
    # Older extensions omit these fields and retain their credential defaults.
    # New captures snapshot intent so a later preference change cannot publish
    # a previously private capture, or change its cost-estimate location.
    is_public: bool | None = None
    location: str | None = Field(default=None, min_length=1, max_length=100)
    model_config = ConfigDict(extra="forbid")

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        value = value.strip()
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError("A recipe http(s) link is required")
        return value


@router.post("/credentials", response_model=CredentialResponse, status_code=201)
async def provision(
    request: CredentialRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    if await db.scalar(select(AppUser.id).where(AppUser.id == user.id).with_for_update()) is None:
        raise HTTPException(404, "Account not found")
    if request.is_public:
        await require_current_publishing_disclosure(db, user.id)
    now = utc_now()
    await db.execute(
        delete(ShareImportCredential).where(
            ShareImportCredential.app_user_id == user.id, ShareImportCredential.expires_at <= now
        )
    )
    digest = installation_hash(request.installation_id)
    credential = await db.scalar(
        select(ShareImportCredential)
        .where(
            ShareImportCredential.app_user_id == user.id,
            ShareImportCredential.installation_hash == digest,
        )
        .with_for_update()
    )
    if credential is None:
        count = await db.scalar(
            select(func.count())
            .select_from(ShareImportCredential)
            .where(
                ShareImportCredential.app_user_id == user.id,
                ShareImportCredential.revoked_at.is_(None),
            )
        )
        if count >= 5:
            raise HTTPException(409, "Too many active sharing installations")
        credential = ShareImportCredential(
            id=uuid4(), app_user_id=user.id, installation_hash=digest
        )
        db.add(credential)
    token, credential.token_hash = issue_token(credential.id)
    credential.scope = SCOPE
    credential.location = request.location
    credential.is_public = request.is_public
    credential.display_name = user.display_name[:200]
    credential.issued_at = now
    credential.expires_at = now + TTL
    credential.revoked_at = None
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return CredentialResponse(
        credential_id=credential.id,
        token=token,
        account_scope_id=grocery_account_scope_id(user.id),
        expires_at=credential.expires_at,
        location=credential.location,
        is_public=credential.is_public,
    )


@router.delete("/session", status_code=204)
async def revoke(
    db: AsyncSession = Depends(get_db),
    credential: ShareImportCredential = Depends(get_share_credential),
):
    credential.revoked_at = utc_now()
    await db.commit()
    return Response(status_code=204)


@router.post("/imports", status_code=202)
async def submit(
    request: ImportRequest,
    db: AsyncSession = Depends(get_db),
    credential: ShareImportCredential = Depends(get_share_credential),
):
    existing = await db.get(ShareImportReceipt, (credential.app_user_id, request.capture_id))
    if existing:
        if existing.url != request.url:
            raise HTTPException(409, "Capture ID was already used for another link")
        return {
            "capture_id": str(request.capture_id),
            "job_id": str(existing.job_id) if existing.job_id else None,
            "recipe_id": str(existing.recipe_id) if existing.recipe_id else None,
            "replayed": True,
        }
    is_public = credential.is_public if request.is_public is None else request.is_public
    if is_public and not credential.is_public:
        raise HTTPException(403, "Open Håfa to enable public recipe sharing")
    if is_public:
        await require_current_publishing_disclosure(db, credential.app_user_id)
    # Enqueue commits the job before its receipt. Count both durable records,
    # deduplicated by capture, while the account lock still serializes intake.
    # A crash in that gap must neither free budget nor block replay recovery.
    job_key = f"share:{request.capture_id}"
    recovering_job = await db.scalar(
        select(ExtractionJob.id).where(
            ExtractionJob.user_id == credential.app_user_id,
            ExtractionJob.idempotency_key == job_key,
        )
    )
    cutoff = utc_now() - timedelta(hours=1)
    recent_captures = select(cast(ShareImportReceipt.capture_id, String)).where(
            ShareImportReceipt.app_user_id == credential.app_user_id,
            ShareImportReceipt.created_at >= cutoff,
    ).union(
        select(func.substr(ExtractionJob.idempotency_key, 7)).where(
            ExtractionJob.user_id == credential.app_user_id,
            ExtractionJob.idempotency_key.like("share:%"),
            ExtractionJob.created_at >= cutoff,
        )
    )
    recent_count = await db.scalar(select(func.count()).select_from(recent_captures.subquery()))
    if recent_count >= 30 and recovering_job is None:
        raise HTTPException(
            429, "Sharing limit reached; try again later", headers={"Retry-After": "3600"}
        )
    actor = ClerkUser(
        id=credential.app_user_id,
        clerk_user_id="share-extension",
        clerk_issuer="share-extension",
        clerk_environment="share-extension",
        first_name=credential.display_name,
    )
    result = await start_extraction_job(
        ExtractRequest(
            url=request.url,
            location=credential.location if request.location is None else request.location,
            is_public=is_public,
        ),
        idempotency_key=job_key,
        db=db,
        user=actor,
    )
    # The domain enqueue commits before returning. Reacquire the stable-user
    # lock for the receipt transaction; account deletion/revocation serialize.
    owner = await db.scalar(
        select(AppUser.id).where(AppUser.id == credential.app_user_id).with_for_update()
    )
    if owner is None:
        raise HTTPException(401, "Account no longer available")
    receipt = await db.get(ShareImportReceipt, (credential.app_user_id, request.capture_id))
    if receipt is None:
        db.add(
            ShareImportReceipt(
                app_user_id=credential.app_user_id,
                capture_id=request.capture_id,
                url=request.url,
                job_id=UUID(result["job_id"]) if result.get("job_id") else None,
                recipe_id=UUID(result["recipe_id"]) if result.get("recipe_id") else None,
            )
        )
    elif receipt.url != request.url:
        raise HTTPException(409, "Capture ID was already used for another link")
    await db.commit()
    return {
        "capture_id": str(request.capture_id),
        "job_id": result.get("job_id"),
        "recipe_id": result.get("recipe_id"),
        "replayed": False,
    }

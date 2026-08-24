"""One-use mobile handoff from Clerk development to Clerk production."""

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user, verify_clerk_token
from app.config import ClerkEnvironment, get_settings
from app.db import get_db
from app.deletion_cleanup import hash_auth_identity
from app.models.deletion import DeletedAuthIdentity
from app.models.identity import AppUser, ClerkIdentity, ClerkMigrationGrant
from app.services.clerk import ClerkBackendClient

router = APIRouter(prefix="/api/auth/clerk-transition", tags=["auth"])
settings = get_settings()
migration_grant_security = HTTPBearer(auto_error=False)

MIGRATION_GRANT_TTL = timedelta(days=90)
SIGN_IN_TICKET_TTL_SECONDS = 60
MAX_ACTIVE_GRANTS_PER_USER = 10
GENERIC_INVALID_GRANT = "Migration grant is invalid or unavailable"
PRODUCTION_APP_USER_PATTERN = re.compile(r"^app_[a-f0-9]{32}$")


class MigrationGrantResponse(BaseModel):
    grant: str
    expires_at: datetime


class CreateMigrationGrantRequest(BaseModel):
    installation_id: str = Field(
        min_length=40,
        max_length=128,
        pattern=r"^cmi_[A-Za-z0-9_-]+$",
    )


class SignInTicketResponse(BaseModel):
    ticket: str


class ProductionOnboardingRequest(CreateMigrationGrantRequest):
    intent: Literal["create_account"]


class ProductionOnboardingResponse(BaseModel):
    status: Literal["created", "existing"]
    app_user_id: str


def _production_environment() -> ClerkEnvironment:
    environment = next(
        (item for item in settings.clerk_environments if item.is_production),
        None,
    )
    if environment is None or not environment.secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Production authentication is not ready",
        )
    return environment


def _hash_grant(grant: str) -> str:
    return hashlib.sha256(grant.encode("utf-8")).hexdigest()


def _grant_from_authorization(
    credentials: HTTPAuthorizationCredentials | None,
) -> str:
    grant = (
        credentials.credentials
        if credentials and credentials.scheme.lower() == "bearer"
        else ""
    )
    if not 40 <= len(grant) <= 128 or re.fullmatch(r"cmg_[A-Za-z0-9_-]+", grant) is None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=GENERIC_INVALID_GRANT,
        )
    return grant


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def _production_identity(
    db: AsyncSession,
    *,
    app_user_id: str,
    issuer: str,
) -> ClerkIdentity | None:
    result = await db.execute(
        select(ClerkIdentity).where(
            ClerkIdentity.app_user_id == app_user_id,
            ClerkIdentity.issuer == issuer,
        )
    )
    return result.scalar_one_or_none()


@router.post("/onboard", response_model=ProductionOnboardingResponse)
async def onboard_production_user(
    payload: ProductionOnboardingRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(
        migration_grant_security
    ),
    db: AsyncSession = Depends(get_db),
) -> ProductionOnboardingResponse:
    """Synchronously create an application owner only for explicit sign-up."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = verify_clerk_token(credentials.credentials)
    production = _production_environment()
    if token.issuer != production.issuer or token.environment_name != "production":
        raise HTTPException(status_code=403, detail="Production authentication is required")

    lock_key = int.from_bytes(
        hashlib.sha256(f"{token.issuer}\0{token.subject}".encode()).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})

    deleted_identity = await db.scalar(
        select(DeletedAuthIdentity.id).where(
            DeletedAuthIdentity.issuer == token.issuer,
            DeletedAuthIdentity.clerk_user_id_hash
            == hash_auth_identity(token.issuer, token.subject),
        )
    )
    if deleted_identity is not None:
        await db.rollback()
        raise HTTPException(status_code=401, detail="Account has been deleted")

    existing = await db.scalar(
        select(ClerkIdentity).where(
            ClerkIdentity.issuer == token.issuer,
            ClerkIdentity.clerk_user_id == token.subject,
        )
    )
    if existing is not None:
        app_user_id = existing.app_user_id
        await db.rollback()
        return ProductionOnboardingResponse(status="existing", app_user_id=app_user_id)

    client = ClerkBackendClient(production)
    try:
        profile = await client.get_user(token.subject)
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        await db.rollback()
        raise HTTPException(status_code=503, detail="Account verification is unavailable") from error
    if profile is None or profile.clerk_user_id != token.subject:
        await db.rollback()
        raise HTTPException(status_code=503, detail="Account verification is unavailable")
    if not profile.email_verified:
        await db.rollback()
        raise HTTPException(status_code=403, detail="A verified email address is required")

    app_user_id = profile.external_id
    if app_user_id is not None:
        app_user = await db.get(AppUser, app_user_id)
        if app_user is not None:
            existing_owner_identity = await _production_identity(
                db,
                app_user_id=app_user_id,
                issuer=token.issuer,
            )
            if existing_owner_identity is not None:
                await db.rollback()
                raise HTTPException(status_code=409, detail="Identity conflict")
        elif PRODUCTION_APP_USER_PATTERN.fullmatch(app_user_id) is None:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Identity conflict")
    else:
        legacy_owner = await db.scalar(
            select(ClerkMigrationGrant.app_user_id)
            .where(ClerkMigrationGrant.device_hash == _hash_grant(payload.installation_id))
            .limit(1)
        )
        if legacy_owner is not None:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Account recovery required")

        app_user_id = f"app_{uuid4().hex}"
        try:
            updated_profile = await client.set_external_id(token.subject, app_user_id)
        except (httpx.HTTPError, RuntimeError, ValueError) as error:
            await db.rollback()
            raise HTTPException(status_code=503, detail="Account provisioning is unavailable") from error
        if (
            updated_profile is None
            or updated_profile.clerk_user_id != token.subject
            or not updated_profile.email_verified
            or updated_profile.external_id != app_user_id
        ):
            await db.rollback()
            raise HTTPException(status_code=503, detail="Account provisioning is unavailable")

    app_user = await db.get(AppUser, app_user_id)
    if app_user is None:
        db.add(AppUser(id=app_user_id))
        await db.flush()
    db.add(
        ClerkIdentity(
            app_user_id=app_user_id,
            issuer=token.issuer,
            clerk_user_id=token.subject,
            last_authenticated_at=datetime.now(timezone.utc),
        )
    )
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Identity conflict") from error

    return ProductionOnboardingResponse(status="created", app_user_id=app_user_id)


@router.post("/grants", response_model=MigrationGrantResponse)
async def create_migration_grant(
    payload: CreateMigrationGrantRequest,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
) -> MigrationGrantResponse:
    """Mint a hash-at-rest bridge credential for a development-key client."""
    if user.clerk_environment not in {"development", "legacy"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Migration grants require a legacy session",
        )

    production = _production_environment()
    identity = await _production_identity(
        db,
        app_user_id=user.id,
        issuer=production.issuer,
    )
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Production account has not been provisioned",
        )

    now = datetime.now(timezone.utc)
    expires_at = now + MIGRATION_GRANT_TTL
    device_hash = _hash_grant(payload.installation_id)
    for _attempt in range(3):
        raw_grant = f"cmg_{secrets.token_urlsafe(32)}"
        user_lock_result = await db.execute(
            select(AppUser.id)
            .where(AppUser.id == user.id)
            .with_for_update()
        )
        if user_lock_result.scalar_one_or_none() is None:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stable account is not available",
            )
        await db.execute(
            delete(ClerkMigrationGrant).where(
                ClerkMigrationGrant.app_user_id == user.id,
                or_(
                    ClerkMigrationGrant.redeemed_at.is_not(None),
                    ClerkMigrationGrant.expires_at <= now,
                ),
            )
        )
        existing_result = await db.execute(
            select(ClerkMigrationGrant)
            .where(
                ClerkMigrationGrant.app_user_id == user.id,
                ClerkMigrationGrant.device_hash == device_hash,
            )
            .with_for_update()
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            existing.token_hash = _hash_grant(raw_grant)
            existing.created_at = now
            existing.expires_at = expires_at
            existing.redeemed_at = None
        else:
            active_count = await db.scalar(
                select(func.count())
                .select_from(ClerkMigrationGrant)
                .where(ClerkMigrationGrant.app_user_id == user.id)
            )
            if (active_count or 0) >= MAX_ACTIVE_GRANTS_PER_USER:
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many active migration devices",
                )
            db.add(
                ClerkMigrationGrant(
                    app_user_id=user.id,
                    device_hash=device_hash,
                    token_hash=_hash_grant(raw_grant),
                    expires_at=expires_at,
                )
            )
        try:
            await db.commit()
            return MigrationGrantResponse(grant=raw_grant, expires_at=expires_at)
        except IntegrityError:
            await db.rollback()

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not create a migration grant",
    )


@router.post("/redeem", response_model=SignInTicketResponse)
async def redeem_migration_grant(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        migration_grant_security
    ),
    db: AsyncSession = Depends(get_db),
) -> SignInTicketResponse:
    """Exchange one valid grant for an immediate production Clerk ticket."""
    production = _production_environment()
    raw_grant = _grant_from_authorization(credentials)
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(ClerkMigrationGrant)
        .where(ClerkMigrationGrant.token_hash == _hash_grant(raw_grant))
        .with_for_update()
    )
    grant = result.scalar_one_or_none()
    if (
        grant is None
        or grant.redeemed_at is not None
        or _aware(grant.expires_at) <= now
    ):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=GENERIC_INVALID_GRANT,
        )

    identity = await _production_identity(
        db,
        app_user_id=grant.app_user_id,
        issuer=production.issuer,
    )
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=GENERIC_INVALID_GRANT,
        )

    try:
        ticket = await ClerkBackendClient(production).create_sign_in_token(
            identity.clerk_user_id,
            expires_in_seconds=SIGN_IN_TICKET_TTL_SECONDS,
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Production sign-in is temporarily unavailable",
        ) from error

    grant.redeemed_at = now
    await db.commit()
    return SignInTicketResponse(ticket=ticket)

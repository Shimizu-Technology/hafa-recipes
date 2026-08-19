"""Issuer-scoped Clerk authentication resolved to stable application users."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ClerkEnvironment, get_settings
from app.db import get_db
from app.models.identity import AppUser, ClerkIdentity
from app.services.clerk import ClerkBackendClient, ClerkProfile

logger = logging.getLogger(__name__)
settings = get_settings()
security = HTTPBearer(auto_error=False)
MAX_TOKEN_BYTES = 16 * 1024
IDENTITY_TOUCH_INTERVAL = timedelta(minutes=15)


class ClerkUser(BaseModel):
    """Authenticated request identity.

    ``id`` is the stable application owner ID. The issuer-scoped Clerk subject
    remains available for Clerk Backend API operations only.
    """

    id: str
    clerk_user_id: str
    clerk_issuer: str
    clerk_environment: str
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    image_url: str | None = None
    role: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def display_name(self) -> str:
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name}"
        if self.first_name:
            return self.first_name
        if self.email:
            return self.email.split("@")[0]
        return "A chef"


class VerifiedClerkToken(BaseModel):
    subject: str
    environment_name: str
    issuer: str
    claims: dict[str, Any]


_jwks_clients: dict[str, PyJWKClient] = {}


def _get_jwks_client(environment: ClerkEnvironment) -> PyJWKClient:
    client = _jwks_clients.get(environment.issuer)
    if client is None:
        client = PyJWKClient(
            environment.jwks_url,
            cache_keys=True,
            lifespan=3600,
        )
        _jwks_clients[environment.issuer] = client
    return client


def _unauthorized(detail: str = "Invalid or expired token") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_clerk_token(token: str) -> VerifiedClerkToken:
    """Cryptographically verify a token against its exact configured issuer."""
    if not token or len(token.encode("utf-8")) > MAX_TOKEN_BYTES:
        raise _unauthorized()

    try:
        unverified = jwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_aud": False,
                "verify_iss": False,
            },
            algorithms=["RS256"],
        )
        environment = settings.clerk_environment_for_issuer(unverified.get("iss"))
        if environment is None:
            logger.warning("Rejected Clerk token from an unrecognized issuer")
            raise _unauthorized()

        signing_key = _get_jwks_client(environment).get_signing_key_from_jwt(token)
        decode_options: dict[str, Any] = {
            "key": signing_key.key,
            "algorithms": ["RS256"],
            "issuer": environment.issuer,
            "leeway": 60,
            "options": {
                "verify_aud": environment.audience is not None,
                "require": ["exp", "iss", "sub"],
            },
        }
        if environment.audience is not None:
            decode_options["audience"] = environment.audience
        claims = jwt.decode(token, **decode_options)

        authorized_party = claims.get("azp")
        missing_required_party = (
            environment.require_authorized_party and not authorized_party
        )
        invalid_present_party = (
            bool(authorized_party)
            and bool(environment.authorized_parties)
            and authorized_party not in environment.authorized_parties
        )
        if missing_required_party or invalid_present_party:
            logger.warning(
                "Rejected Clerk token with invalid authorized party for %s",
                environment.name,
            )
            raise _unauthorized()

        return VerifiedClerkToken(
            subject=claims["sub"],
            environment_name=environment.name,
            issuer=environment.issuer,
            claims=claims,
        )
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError as error:
        raise _unauthorized("Token has expired") from error
    except (jwt.InvalidTokenError, PyJWKClientError, ValueError, TypeError) as error:
        logger.warning("Clerk token verification failed: %s", type(error).__name__)
        raise _unauthorized() from error


async def _find_identity(
    db: AsyncSession,
    *,
    issuer: str,
    clerk_user_id: str,
) -> ClerkIdentity | None:
    result = await db.execute(
        select(ClerkIdentity).where(
            ClerkIdentity.issuer == issuer,
            ClerkIdentity.clerk_user_id == clerk_user_id,
        )
    )
    return result.scalar_one_or_none()


async def _touch_identity(db: AsyncSession, identity: ClerkIdentity) -> None:
    now = datetime.now(timezone.utc)
    last_seen = identity.last_authenticated_at
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen is None or now - last_seen >= IDENTITY_TOUCH_INTERVAL:
        identity.last_authenticated_at = now
        await db.commit()


async def _attach_identity(
    db: AsyncSession,
    *,
    app_user_id: str,
    issuer: str,
    clerk_user_id: str,
    allow_create_user: bool,
) -> ClerkIdentity | None:
    """Attach exactly one subject per user/issuer, handling concurrent auth."""
    app_user = await db.get(AppUser, app_user_id)
    if app_user is None:
        if not allow_create_user:
            return None
        db.add(AppUser(id=app_user_id))

    result = await db.execute(
        select(ClerkIdentity).where(
            ClerkIdentity.app_user_id == app_user_id,
            ClerkIdentity.issuer == issuer,
        )
    )
    existing_for_issuer = result.scalar_one_or_none()
    if existing_for_issuer is not None:
        return existing_for_issuer if existing_for_issuer.clerk_user_id == clerk_user_id else None

    db.add(
        ClerkIdentity(
            app_user_id=app_user_id,
            issuer=issuer,
            clerk_user_id=clerk_user_id,
            last_authenticated_at=datetime.now(timezone.utc),
        )
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        identity = await _find_identity(
            db,
            issuer=issuer,
            clerk_user_id=clerk_user_id,
        )
        return identity if identity and identity.app_user_id == app_user_id else None

    return await _find_identity(db, issuer=issuer, clerk_user_id=clerk_user_id)


async def _resolve_identity(
    db: AsyncSession,
    token: VerifiedClerkToken,
) -> tuple[ClerkIdentity, ClerkProfile | None]:
    identity = await _find_identity(
        db,
        issuer=token.issuer,
        clerk_user_id=token.subject,
    )
    if identity is not None:
        await _touch_identity(db, identity)
        return identity, None

    environment = settings.clerk_environment_for_issuer(token.issuer)
    if environment is None:
        raise _unauthorized()

    if environment.is_development:
        # Safe lazy adoption: the development subject is the stable owner ID,
        # exactly matching all pre-migration ownership columns.
        identity = await _attach_identity(
            db,
            app_user_id=token.subject,
            issuer=token.issuer,
            clerk_user_id=token.subject,
            allow_create_user=True,
        )
        if identity is None:
            raise HTTPException(status_code=403, detail="Identity conflict")
        return identity, None

    # A production subject is never adopted by subject or email alone. The
    # Backend API must confirm a verified primary email and a stable external ID
    # written by the production provisioner.
    try:
        profile = await ClerkBackendClient(environment).get_user(token.subject)
    except (httpx.HTTPError, ValueError):
        logger.warning("Unable to verify unknown production Clerk identity")
        profile = None
    if (
        profile is None
        or not profile.email_verified
        or not profile.external_id
    ):
        raise HTTPException(status_code=403, detail="Unable to safely match this account")

    identity = await _attach_identity(
        db,
        app_user_id=profile.external_id,
        issuer=token.issuer,
        clerk_user_id=token.subject,
        allow_create_user=False,
    )
    if identity is None:
        raise HTTPException(status_code=403, detail="Identity conflict")
    return identity, profile


def _claim(claims: dict[str, Any], name: str, fallback: str | None = None) -> str | None:
    value = claims.get(name)
    if value is None and fallback:
        value = claims.get(fallback)
    return str(value) if value is not None else None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> ClerkUser:
    if credentials is None:
        raise _unauthorized("Not authenticated")

    token = verify_clerk_token(credentials.credentials)
    identity, profile = await _resolve_identity(db, token)
    public_metadata = token.claims.get("public_metadata") or {}
    if not isinstance(public_metadata, dict):
        public_metadata = {}

    return ClerkUser(
        id=identity.app_user_id,
        clerk_user_id=token.subject,
        clerk_issuer=token.issuer,
        clerk_environment=token.environment_name,
        email=profile.email if profile else _claim(token.claims, "email", "primary_email_address"),
        first_name=profile.first_name if profile else _claim(token.claims, "first_name"),
        last_name=profile.last_name if profile else _claim(token.claims, "last_name"),
        image_url=_claim(token.claims, "image_url"),
        role=_claim(public_metadata, "role"),
    )


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> ClerkUser | None:
    if credentials is None:
        return None
    # Supplying an invalid or expired credential is not the same as making an
    # anonymous request. Preserve the 401 so clients can recover their session
    # instead of silently receiving guest-shaped data.
    return await get_current_user(credentials=credentials, db=db)

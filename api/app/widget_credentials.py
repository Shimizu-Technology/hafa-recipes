"""Least-privilege authentication for the native iOS grocery widget."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.db.database import AsyncSessionLocal
from app.models.grocery import GroceryWidgetCredential
from app.models.identity import AppUser

WIDGET_TOKEN_PREFIX = "hfw_v1"
WIDGET_TOKEN_MAX_BYTES = 256
WIDGET_TOKEN_SECRET_BYTES = 32
WIDGET_CREDENTIAL_TTL = timedelta(days=90)
WIDGET_CREDENTIAL_SCOPE = "grocery:read grocery:set_checked"
WIDGET_CREDENTIAL_SCOPES = ("grocery:read", "grocery:set_checked")
WIDGET_LAST_USED_INTERVAL = timedelta(minutes=15)
MAX_WIDGET_INSTALLATIONS_PER_USER = 5
INSTALLATION_HASH_NAMESPACE = b"hafa-recipes:grocery-widget-installation:v1\0"
TOKEN_HASH_NAMESPACE = b"hafa-recipes:grocery-widget-token:v1\0"

widget_security = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class WidgetCredentialContext:
    """A currently valid widget capability and its presented secret digest."""

    credential: GroceryWidgetCredential
    token_hash: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def widget_installation_hash(installation_id: UUID) -> str:
    """Return a non-reversible server identifier for an app installation."""

    return hashlib.sha256(
        INSTALLATION_HASH_NAMESPACE + str(installation_id).encode("ascii")
    ).hexdigest()


def widget_token_hash(secret: str) -> str:
    """Hash a high-entropy widget secret for lookup-safe storage."""

    return hashlib.sha256(TOKEN_HASH_NAMESPACE + secret.encode("ascii")).hexdigest()


def issue_widget_token(credential_id: UUID) -> tuple[str, str]:
    """Create an opaque bearer token and the digest retained by the API."""

    secret = secrets.token_urlsafe(WIDGET_TOKEN_SECRET_BYTES)
    token = f"{WIDGET_TOKEN_PREFIX}.{credential_id}.{secret}"
    return token, widget_token_hash(secret)


def parse_widget_token(token: str) -> tuple[UUID, str] | None:
    """Strictly parse the versioned credential without accepting Clerk JWTs."""

    try:
        if not token or len(token.encode("utf-8")) > WIDGET_TOKEN_MAX_BYTES:
            return None
        prefix, raw_id, secret = token.split(".", 2)
        if prefix != WIDGET_TOKEN_PREFIX or not secret or len(secret) > 128:
            return None
        if not all(character.isalnum() or character in "-_" for character in secret):
            return None
        return UUID(raw_id), widget_token_hash(secret)
    except (UnicodeEncodeError, ValueError, TypeError):
        return None


def widget_unauthorized(detail: str = "Invalid or expired widget credential") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def validate_widget_credential(
    credential: GroceryWidgetCredential | None,
    presented_hash: str,
    *,
    now: datetime | None = None,
) -> GroceryWidgetCredential:
    """Validate revocation, expiry, exact scope, and the bearer digest."""

    now = now or utc_now()
    if (
        credential is None
        or credential.revoked_at is not None
        or _aware(credential.expires_at) <= now
        or credential.scope != WIDGET_CREDENTIAL_SCOPE
        or not secrets.compare_digest(credential.token_hash, presented_hash)
    ):
        raise widget_unauthorized()
    return credential


async def get_widget_credential(
    credentials: HTTPAuthorizationCredentials | None = Depends(widget_security),
    db: AsyncSession = Depends(get_db),
) -> WidgetCredentialContext:
    """Authenticate and lock a widget token at the stable-user boundary.

    Widget use, rotation, revocation, list transitions, and account deletion all
    take the same application-user lock. A token cannot pass validation and then
    race a revocation or membership change into a different list scope.
    """

    if credentials is None:
        raise widget_unauthorized("Widget credential required")
    parsed = parse_widget_token(credentials.credentials)
    if parsed is None:
        raise widget_unauthorized()
    credential_id, presented_hash = parsed

    initial = validate_widget_credential(
        await db.get(GroceryWidgetCredential, credential_id),
        presented_hash,
    )

    locked_user = await db.scalar(
        select(AppUser.id)
        .where(AppUser.id == initial.app_user_id)
        .with_for_update()
    )
    if locked_user is None:
        raise widget_unauthorized()

    credential = validate_widget_credential(
        (
            await db.execute(
                select(GroceryWidgetCredential)
                .where(GroceryWidgetCredential.id == credential_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none(),
        presented_hash,
    )

    now = utc_now()
    last_used = credential.last_used_at
    if last_used is None or now - _aware(last_used) >= WIDGET_LAST_USED_INTERVAL:
        credential.last_used_at = now
    return WidgetCredentialContext(credential=credential, token_hash=presented_hash)


async def verify_widget_credential_schema(session_factory=AsyncSessionLocal) -> None:
    """Fail startup before serving if migration 024 is incomplete."""

    async with session_factory() as db:
        migration_applied = await db.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 24
            )
        """))
        table_ready = await db.scalar(text("""
            SELECT to_regclass('public.grocery_widget_credentials') IS NOT NULL
        """))
        columns = set(
            (
                await db.execute(text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'grocery_widget_credentials'
                """))
            ).scalars().all()
        ) if table_ready else set()
        constraints = set(
            (
                await db.execute(text("""
                    SELECT conname
                    FROM pg_constraint
                    WHERE conrelid = 'grocery_widget_credentials'::regclass
                      AND convalidated
                """))
            ).scalars().all()
        ) if table_ready else set()

        required_columns = {
            "id",
            "app_user_id",
            "list_id",
            "installation_hash",
            "token_hash",
            "scope",
            "issued_at",
            "expires_at",
            "last_used_at",
            "revoked_at",
        }
        required_constraints = {
            "grocery_widget_credentials_pkey",
            "fk_grocery_widget_credentials_user",
            "fk_grocery_widget_credentials_list",
            "uq_grocery_widget_credential_user_installation",
            "grocery_widget_credentials_token_hash_key",
            "ck_grocery_widget_credentials_scope",
            "ck_grocery_widget_credentials_expiry",
        }
        if not (
            migration_applied
            and table_ready
            and required_columns.issubset(columns)
            and required_constraints.issubset(constraints)
        ):
            raise RuntimeError("Database migration 024 is missing or incomplete")

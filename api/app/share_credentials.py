"""Opaque link-import capability; no Clerk JWT or recipe-edit authority."""

import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.identity import AppUser
from app.models.share_import import ShareImportCredential
from app.widget_credentials import _aware, utc_now

SCOPE = "recipe:import_link"
TTL = timedelta(days=30)
security = HTTPBearer(auto_error=False)


def installation_hash(installation_id: UUID) -> str:
    return hashlib.sha256(
        b"hafa:share-installation:v1\0" + str(installation_id).encode()
    ).hexdigest()


def token_hash(secret: str) -> str:
    return hashlib.sha256(b"hafa:share-token:v1\0" + secret.encode("ascii")).hexdigest()


def issue_token(credential_id: UUID) -> tuple[str, str]:
    secret = secrets.token_urlsafe(32)
    return f"hfs_v1.{credential_id}.{secret}", token_hash(secret)


def parse_token(token: str) -> tuple[UUID, str] | None:
    try:
        if len(token.encode()) > 256:
            return None
        prefix, raw_id, secret = token.split(".", 2)
        if (
            prefix != "hfs_v1"
            or not 40 <= len(secret) <= 128
            or not all(c.isascii() and (c.isalnum() or c in "-_") for c in secret)
        ):
            return None
        return UUID(raw_id), token_hash(secret)
    except (ValueError, UnicodeError):
        return None


def validate_credential(credential, digest):
    if (
        credential is None
        or credential.revoked_at is not None
        or _aware(credential.expires_at) <= utc_now()
        or credential.scope != SCOPE
        or not secrets.compare_digest(credential.token_hash, digest)
    ):
        raise HTTPException(
            401, "Reconnect recipe sharing in Håfa", headers={"WWW-Authenticate": "Bearer"}
        )
    return credential


async def get_share_credential(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    parsed = parse_token(credentials.credentials) if credentials else None
    if not parsed:
        raise HTTPException(401, "Share credential required")
    identifier, digest = parsed
    initial = validate_credential(await db.get(ShareImportCredential, identifier), digest)
    owner = await db.scalar(
        select(AppUser.id).where(AppUser.id == initial.app_user_id).with_for_update()
    )
    if owner is None:
        raise HTTPException(401, "Account no longer available")
    current = await db.scalar(
        select(ShareImportCredential)
        .where(ShareImportCredential.id == identifier)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return validate_credential(current, digest)

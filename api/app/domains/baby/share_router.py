"""Restricted original capture, with deferred admission under existing limits."""

import hashlib
import secrets
from datetime import timedelta
from types import SimpleNamespace
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, Field, model_validator
from sqlalchemy import func, select, text

from app.domains.baby.dependencies import Database, Generation, User
from app.domains.baby.imports import admit_import
from app.domains.baby.lifecycle import digest, membership_for, now
from app.domains.baby.models import BabyImport, BabyRecord
from app.domains.baby.schemas import (
    DEFAULT_SOURCE_TITLE,
    DomainModel,
    ImportCreate,
    RecordCreate,
    SourceData,
)
from app.domains.baby.security import BabyRoute
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from app.security import is_public_http_url

router = APIRouter(prefix="/api/v1/baby/share", tags=["baby"], route_class=BabyRoute)
security = HTTPBearer(auto_error=False)


def token_hash(secret):
    return hashlib.sha256(b"hafa:baby-share:v1\0" + secret.encode()).hexdigest()


def parse_token(token):
    try:
        prefix, identifier, secret = token.split(".", 2)
        if prefix != "hfbs_v1" or len(token) > 256 or not 40 <= len(secret) <= 128:
            return None
        if not all(c.isascii() and (c.isalnum() or c in "-_") for c in secret):
            return None
        return UUID(identifier), token_hash(secret)
    except (ValueError, TypeError):
        return None


async def share_schema_available(db):
    return bool(
        await db.scalar(
            text(
                "SELECT to_regclass('public.baby_share_credentials') IS NOT NULL AND to_regclass('public.baby_share_captures') IS NOT NULL"
            )
        )
    )


async def require_schema(db):
    if not await share_schema_available(db):
        raise HTTPException(
            503, "Baby sharing is being prepared; your original remains on this phone"
        )


async def share_credential(
    db: Database, bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]
):
    await require_schema(db)
    parsed = parse_token(bearer.credentials) if bearer else None
    row = await db.get(BabyShareCredential, parsed[0]) if parsed else None
    if row is None or not secrets.compare_digest(row.token_hash, parsed[1]):
        raise HTTPException(401, "Reconnect sharing in Baby")
    await membership_for(db, row.app_user_id, generation=row.generation, write=True)
    await db.refresh(row)
    if (
        row.revoked_at is not None
        or row.expires_at <= now()
        or not secrets.compare_digest(row.token_hash, parsed[1])
    ):
        raise HTTPException(401, "Reconnect sharing in Baby")
    return row


Credential = Annotated[BabyShareCredential, Depends(share_credential)]


class SessionRequest(DomainModel):
    installation_id: UUID


@router.post("/session", status_code=201)
async def provision(body: SessionRequest, user: User, db: Database, generation: Generation):
    await require_schema(db)
    member = await membership_for(db, user.id, generation=generation, write=True)
    installation = token_hash(str(body.installation_id))
    row = await db.scalar(
        select(BabyShareCredential).where(
            BabyShareCredential.app_user_id == user.id,
            BabyShareCredential.generation == generation,
            BabyShareCredential.installation_hash == installation,
        )
    )
    if row is None:
        count = await db.scalar(
            select(func.count())
            .select_from(BabyShareCredential)
            .where(
                BabyShareCredential.app_user_id == user.id,
                BabyShareCredential.revoked_at.is_(None),
                BabyShareCredential.expires_at > now(),
            )
        )
        if count >= 5:
            raise HTTPException(409, "Reconnect an existing sharing installation")
        row = BabyShareCredential(
            id=uuid4(), app_user_id=user.id, generation=generation, installation_hash=installation
        )
        db.add(row)
    secret = secrets.token_urlsafe(32)
    row.token_hash, row.expires_at, row.revoked_at = (
        token_hash(secret),
        now() + timedelta(days=30),
        None,
    )
    await db.commit()
    return {
        "credential_id": str(row.id),
        "token": f"hfbs_v1.{row.id}.{secret}",
        "generation": generation,
        "auto_process_epoch": member.profile.get("auto_process_epoch", 0),
        "expires_at": row.expires_at,
    }


@router.delete("/session", status_code=204)
async def revoke(db: Database, credential: Credential):
    credential.revoked_at = now()
    await db.commit()
    return Response(status_code=204)


class CaptureRequest(DomainModel):
    automatic_epoch: Annotated[int, Field(strict=True, ge=0)] = 0
    capture_id: UUID
    occurred_at: AwareDatetime
    url: str | None = Field(default=None, max_length=2000)
    text: str | None = Field(default=None, max_length=100000)

    @model_validator(mode="after")
    def original(self):
        if self.url and not is_public_http_url(self.url):
            raise ValueError("Share a public http(s) link")
        if not self.url and not (self.text and self.text.strip()):
            raise ValueError("Share a link or text")
        return self

    def original_record(self):
        return RecordCreate(
            id=self.capture_id,
            kind="source",
            title=(self.text or "").strip().splitlines()[0][:100]
            if (self.text or "").strip()
            else DEFAULT_SOURCE_TITLE,
            body="",
            child_id=None,
            occurred_at=self.occurred_at,
            data=SourceData(url=self.url, source_text=self.text, status="saved").model_dump(
                mode="json"
            ),
        )


async def admit_capture(db, capture, member):
    """Caller holds the stable account lock. No original is removed on refusal."""
    if capture.status != "deferred":
        return
    capture.last_attempt_at = now()
    if not (
        member.profile.get("ai_consent") and member.profile.get("auto_process_shares")
    ) or capture.request.get("automatic_epoch", 0) != member.profile.get("auto_process_epoch", 0):
        # Revocation is final for already pending automatic work. A later opt-in
        # does not retroactively send previously saved private originals to AI.
        capture.status = "saved"
        await db.commit()
        return
    source = await db.get(BabyRecord, capture.record_id)
    if source is None or source.deleted_at is not None:
        capture.status = "saved"
        await db.commit()
        return
    body = ImportCreate(
        id=capture.id,
        record_id=capture.record_id,
        automatic_epoch=member.profile.get("auto_process_epoch", 0),
    )
    try:
        await admit_import(
            body, SimpleNamespace(id=capture.app_user_id), db, capture.generation, automatic=True
        )
    except HTTPException as error:
        if error.status_code not in {409, 410, 429}:
            raise
        await db.rollback()
        await db.refresh(capture)
        capture.last_attempt_at = now()
        await db.commit()
        return
    # Admission commits its durable import before this optional receipt update.
    # Replay sees the same import UUID after an interrupted receipt update.
    capture.status = "queued"
    await db.commit()


async def drain_deferred_captures(db, *, limit=20):
    """Own session, called before worker claim; optional migration absence is safe."""
    if not await share_schema_available(db):
        return 0
    candidates = list(
        (
            await db.execute(
                select(
                    BabyShareCapture.id, BabyShareCapture.app_user_id, BabyShareCapture.generation
                )
                .where(BabyShareCapture.status == "deferred")
                .order_by(
                    BabyShareCapture.last_attempt_at.asc().nullsfirst(), BabyShareCapture.created_at
                )
                .limit(limit)
            )
        ).all()
    )
    admitted = 0
    for identifier, owner, generation in candidates:
        try:
            member = await membership_for(db, owner, generation=generation, write=True)
        except HTTPException:
            await db.rollback()
            continue
        capture = await db.get(BabyShareCapture, identifier, populate_existing=True)
        if capture is not None:
            await admit_capture(db, capture, member)
            if capture.status == "queued":
                admitted += 1
        await db.commit()
    return admitted


@router.post("/captures", status_code=202)
async def submit(body: CaptureRequest, db: Database, credential: Credential):
    member = await membership_for(
        db, credential.app_user_id, generation=credential.generation, write=True
    )
    immutable = body.model_dump(mode="json")
    if not body.automatic_epoch:
        immutable.pop("automatic_epoch", None)
    fingerprint = digest(immutable)
    capture = await db.get(BabyShareCapture, body.capture_id)
    replayed = capture is not None
    if capture:
        if (
            capture.app_user_id != credential.app_user_id
            or capture.generation != credential.generation
            or capture.creation_hash != fingerprint
        ):
            raise HTTPException(409, "Capture identity already used")
    else:
        original = body.original_record()
        original_hash = digest(original.model_dump(mode="json"))
        source = await db.get(BabyRecord, original.id)
        if source:
            if (
                source.app_user_id != credential.app_user_id
                or source.generation != credential.generation
                or source.creation_hash != original_hash
                or source.deleted_at is not None
            ):
                raise HTTPException(409, "Source identity already used")
        else:
            db.add(
                BabyRecord(
                    **original.model_dump(),
                    app_user_id=credential.app_user_id,
                    generation=credential.generation,
                    revision=1,
                    creation_hash=original_hash,
                    created_at=now(),
                    updated_at=now(),
                )
            )
        capture = BabyShareCapture(
            id=body.capture_id,
            app_user_id=credential.app_user_id,
            generation=credential.generation,
            record_id=body.capture_id,
            creation_hash=fingerprint,
            request={"automatic_epoch": body.automatic_epoch},
            created_at=now(),
            status="deferred"
            if member.profile.get("ai_consent") and member.profile.get("auto_process_shares")
            else "saved",
        )
        db.add(capture)
        # Original and receipt commit together, before capped processing admission.
        await db.commit()
    await admit_capture(db, capture, member)
    await db.refresh(capture)
    job = await db.get(BabyImport, capture.id)
    return {
        "capture_id": str(capture.id),
        "record_id": str(capture.record_id),
        "generation": capture.generation,
        "status": "queued"
        if job and job.status in {"queued", "processing"}
        else "saved"
        if job
        else capture.status,
        "import_id": str(job.id) if job else None,
        "replayed": replayed,
    }

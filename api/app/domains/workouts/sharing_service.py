"""Publish only a reviewed frozen projection; bearer links never grant identity."""

import base64
import copy
import hashlib
import json
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qsl, urlsplit
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.config import get_settings
from app.domains.workouts.catalog import EXERCISES
from app.domains.workouts.connection_models import (
    WorkoutCopyReceipt,
    WorkoutShare,
    WorkoutSharePreview,
)
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsMembership,
    WorkoutsProgram,
    WorkoutsProgramVersion,
    WorkoutVersion,
)
from app.domains.workouts.programming import RULE_VERSION
from app.domains.workouts.router import bounded_content, owned_record
from app.domains.workouts.schemas import ProgramProposal, ScheduledPrescription, WorkoutContent

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
COPY_WARNING = "This shared program is not personalized. Review equipment, schedule, prescriptions and declared limitations before adopting it; no progression is automatic."
PRIVATE_CONTEXT_KEYS = {
    "profile",
    "health_context",
    "health_data",
    "health_context_used",
    "rehabilitation",
    "medical_conditions",
}


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def token_hash(token):
    if not TOKEN_PATTERN.fullmatch(token):
        raise HTTPException(404, "Shared content not found")
    return hashlib.sha256(token.encode()).hexdigest()


def sharing_key():
    configured = getattr(get_settings(), "workouts_share_encryption_key", None) or os.environ.get(
        "WORKOUTS_SHARE_ENCRYPTION_KEY", ""
    )
    try:
        if not isinstance(configured, str) or not re.fullmatch(
            r"[A-Za-z0-9_+/\-]{43}=?", configured
        ):
            raise ValueError("Invalid key encoding")
        key = base64.urlsafe_b64decode(configured + "=" * (-len(configured) % 4))
    except (ValueError, TypeError):
        key = b""
    if len(key) != 32:
        raise HTTPException(
            503, "Sharing is not configured; other Workouts features remain available"
        )
    return key


def encrypt_token(token, share):
    nonce = os.urandom(12)
    aad = f"hafa-workouts:share:v1:{share.id}:{share.app_user_id}:{share.generation}".encode()
    cipher = AESGCM(sharing_key()).encrypt(nonce, token.encode(), aad)
    return base64.urlsafe_b64encode(nonce + cipher).decode()


def decrypt_token(share):
    aad = f"hafa-workouts:share:v1:{share.id}:{share.app_user_id}:{share.generation}".encode()
    try:
        data = base64.urlsafe_b64decode(share.encrypted_token)
        token = AESGCM(sharing_key()).decrypt(data[:12], data[12:], aad).decode()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            503, "This link cannot be retrieved right now. You can still revoke it."
        ) from None
    if token_hash(token) != share.token_hash:
        raise HTTPException(
            503, "This link cannot be retrieved right now. You can still revoke it."
        )
    return token


def safe_source_url(value):
    if not value:
        return None
    parsed = urlsplit(value)
    forbidden = {
        "token",
        "access_token",
        "authorization",
        "api_key",
        "key",
        "signature",
        "sig",
        "x-amz-signature",
        "x-amz-credential",
    }
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or any(key.lower() in forbidden for key, _ in parse_qsl(parsed.query))
        or "token=" in parsed.fragment.lower()
    ):
        raise HTTPException(422, "A source link contains private credentials; omit it from sharing")
    return value


def project_workout(raw, *, include_source_url=False):
    try:
        source = WorkoutContent.model_validate(raw)
    except ValidationError:
        raise HTTPException(422, "Correct this workout before sharing") from None
    # An explicit whitelist remains private even if the internal schema later
    # gains personalization, importer, or health-context fields.
    source_data = source.model_dump(mode="json")
    projected = {
        key: source_data[key]
        for key in (
            "title",
            "kind",
            "equipment_required",
            "equipment_optional",
            "estimated_minutes",
        )
    }
    projected.update(
        id=None,
        version=1,
        parent_version_id=None,
        notes=[],
        provenance="user",
        source_url=safe_source_url(source.source_url) if include_source_url else None,
        blocks=[],
    )
    incomplete = not source.blocks
    for index, source_block in enumerate(source_data["blocks"]):
        block = {
            key: source_block[key] for key in ("grouping", "rounds", "rest_between_rounds_seconds")
        }
        block["exercises"] = [
            {
                key: exercise[key]
                for key in (
                    "exercise_id",
                    "name",
                    "sets",
                    "reps_min",
                    "reps_max",
                    "per_side",
                    "duration_seconds",
                    "distance_meters",
                    "rest_seconds",
                    "tempo",
                    "load",
                    "load_unit",
                    "load_convention",
                )
            }
            for exercise in source_block["exercises"]
        ]
        block["id"] = f"block-{index + 1}"
        block["label"] = f"Block {index + 1}"
        block["evidence"] = []
        if not block["exercises"]:
            incomplete = True
        for exercise in block["exercises"]:
            exercise["notes"] = None
            exercise["effort"] = None
            if exercise["tempo"] and not re.fullmatch(r"[0-9Xx:/\- ]{1,30}", exercise["tempo"]):
                exercise["tempo"] = None
            exercise["evidence"] = []
            exercise["provenance"] = "user"
            # Arbitrary identifiers can contain private integration references.
            if exercise["exercise_id"] not in EXERCISES:
                exercise["exercise_id"] = None
            if all(
                exercise.get(field) is None
                for field in ("reps_min", "reps_max", "duration_seconds", "distance_meters")
            ):
                incomplete = True
        projected["blocks"].append(block)
    WorkoutContent.model_validate(projected)
    return projected, incomplete


def project_program(raw, *, include_source_url=False):
    if any(raw.get(key) for key in PRIVATE_CONTEXT_KEYS):
        raise HTTPException(
            422, "A health-derived program requires a separate reviewed sharing policy"
        )
    try:
        proposal = ProgramProposal.model_validate(raw["proposal"])
    except (KeyError, ValidationError):
        raise HTTPException(422, "Correct this program before sharing") from None
    if proposal.status != "ready" or proposal.questions or proposal.rule_version != RULE_VERSION:
        raise HTTPException(422, "Resolve program readiness and source provenance before sharing")
    if not 1 <= len(proposal.sessions) <= 366:
        raise HTTPException(422, "Shared programs require 1 through 366 sessions")
    first_date = min(session.date for session in proposal.sessions)
    sessions, incomplete = [], bool(proposal.warnings)
    for sequence, session in enumerate(proposal.sessions, start=1):
        offset = (session.date - first_date).days
        if offset > 365:
            raise HTTPException(422, "Shared program spacing is limited to one year")
        workout, uncertain = project_workout(
            session.workout.model_dump(mode="json"), include_source_url=include_source_url
        )
        workout["title"] = f"Session {sequence}"
        sessions.append({"sequence": sequence, "day_offset": offset, "workout": workout})
        incomplete |= uncertain
    return {
        "title": "Shared training program",
        "sessions": sessions,
        "notice": COPY_WARNING,
    }, incomplete


async def make_preview(db, user_id, generation, request):
    await membership_for(db, user_id, generation=generation, write=True)
    model = WorkoutRecord if request.kind == "workout" else WorkoutsProgram
    record_id = request.workout_id if request.kind == "workout" else request.program_id
    row = await owned_record(db, model, record_id, user_id, generation)
    if row.revision != request.expected_revision:
        raise HTTPException(409, "Content changed; refresh before previewing")
    if request.kind == "workout":
        if row.content.get("kind") == "program":
            raise HTTPException(422, "Share a structured program from Plans instead")
        content, incomplete = project_workout(
            row.content, include_source_url=request.include_source_url
        )
    else:
        content, incomplete = project_program(
            row.content, include_source_url=request.include_source_url
        )
    if incomplete and not request.allow_incomplete:
        raise HTTPException(
            409, "This content needs review; explicitly choose to share a reviewed draft"
        )
    if request.title:
        content["title"] = request.title
    snapshot = bounded_content(
        {
            "kind": request.kind,
            "content": content,
            "attribution": {
                "shared_by_display_name": request.display_name,
                "source_revision": row.revision,
                "original_source_included": bool(content.get("source_url"))
                if request.kind == "workout"
                else any(item["workout"].get("source_url") for item in content["sessions"]),
            },
            "review_required": incomplete,
        }
    )
    preview = WorkoutSharePreview(
        app_user_id=user_id,
        generation=generation,
        kind=request.kind,
        record_id=row.id,
        source_revision=row.revision,
        snapshot=snapshot,
        snapshot_digest=digest(snapshot),
        expires_at=now() + timedelta(minutes=10),
        link_expires_at=now() + timedelta(days=request.expires_in_days),
    )
    db.add(preview)
    await db.flush()
    return preview


async def confirm_preview(db, user_id, generation, preview_id, expected_digest):
    await membership_for(db, user_id, generation=generation, write=True)
    preview = await owned_record(db, WorkoutSharePreview, preview_id, user_id, generation)
    if preview.snapshot_digest != expected_digest:
        raise HTTPException(409, "Preview changed; review the exact public snapshot")
    if preview.confirmed_share_id:
        return await owned_record(db, WorkoutShare, preview.confirmed_share_id, user_id, generation)
    if preview.expires_at <= now():
        raise HTTPException(409, "Preview expired; review a new preview")
    model = WorkoutRecord if preview.kind == "workout" else WorkoutsProgram
    current = await owned_record(db, model, preview.record_id, user_id, generation)
    if current.revision != preview.source_revision:
        raise HTTPException(409, "Content changed since preview; review again")
    token = secrets.token_urlsafe(32)
    share = WorkoutShare(
        id=uuid4(),
        app_user_id=user_id,
        generation=generation,
        kind=preview.kind,
        record_id=preview.record_id,
        source_revision=preview.source_revision,
        token_hash=token_hash(token),
        snapshot=copy.deepcopy(preview.snapshot),
        snapshot_digest=preview.snapshot_digest,
        expires_at=preview.link_expires_at,
    )
    share.encrypted_token = encrypt_token(token, share)
    db.add(share)
    await db.flush()
    preview.confirmed_share_id = share.id
    return share


async def public_share(db, token, *, lock=False):
    query = select(WorkoutShare).where(WorkoutShare.token_hash == token_hash(token))
    if lock:
        query = query.with_for_update()
    share = await db.scalar(query)
    if (
        share is None
        or share.scope != "training:preview_copy"
        or share.revoked_at
        or share.expires_at <= now()
    ):
        raise HTTPException(404, "Shared content not found")
    owner = await db.get(WorkoutsMembership, share.app_user_id)
    if owner is None or owner.status != "active" or owner.generation != share.generation:
        raise HTTPException(404, "Shared content not found")
    # Also hides hard-deleted source records, without exposing their IDs publicly.
    model = WorkoutRecord if share.kind == "workout" else WorkoutsProgram
    if (
        await db.scalar(
            select(model.id).where(
                model.id == share.record_id,
                model.app_user_id == share.app_user_id,
                model.generation == share.generation,
            )
        )
        is None
    ):
        raise HTTPException(404, "Shared content not found")
    return share


async def copy_share(db, user_id, generation, token, request):
    await membership_for(db, user_id, generation=generation, write=True)
    requested_token_hash = token_hash(token)
    request_hash = digest(request.model_dump(mode="json", exclude_unset=True))
    receipt = await db.scalar(
        select(WorkoutCopyReceipt).where(
            WorkoutCopyReceipt.app_user_id == user_id,
            WorkoutCopyReceipt.generation == generation,
            WorkoutCopyReceipt.copy_request_id == request.copy_request_id,
        )
    )
    if receipt:
        if (
            receipt.snapshot_digest != request.snapshot_digest
            or receipt.source_token_hash != requested_token_hash
            or receipt.request_hash != request_hash
        ):
            raise HTTPException(409, "Copy identity was used for a different shared snapshot")
        model = WorkoutRecord if receipt.kind == "workout" else WorkoutsProgram
        row = await db.scalar(
            select(model).where(
                model.id == receipt.record_id,
                model.app_user_id == user_id,
                model.generation == generation,
            )
        )
        if row is None:
            raise HTTPException(410, "This saved copy was removed; start a new deliberate copy")
        return row, receipt, True
    # Lock the share after the recipient AppUser. Do not lock the creator AppUser:
    # reciprocal copies must not deadlock. Creator deletion/revocation waits on
    # this share-row lock, so a copy either precedes it or observes it afterwards.
    share = await public_share(db, token, lock=True)
    if share.snapshot_digest != request.snapshot_digest:
        raise HTTPException(409, "Shared preview changed; review again")
    content = copy.deepcopy(share.snapshot["content"])
    identifier = uuid4()
    if share.kind == "workout":
        if request.start_date is not None:
            raise HTTPException(422, "A single workout does not take a program start date")
        content.update(id=str(identifier), version=1, parent_version_id=None)
        row = WorkoutRecord(
            id=identifier, app_user_id=user_id, generation=generation, revision=1, content=content
        )
        db.add(row)
        await db.flush()
        db.add(
            WorkoutVersion(
                app_user_id=user_id,
                generation=generation,
                workout_id=row.id,
                revision=1,
                content=content,
            )
        )
    else:
        if request.start_date is None:
            raise HTTPException(422, "Choose your own program start date")
        try:
            sessions = [
                ScheduledPrescription(
                    id=str(uuid4()),
                    date=request.start_date + timedelta(days=item["day_offset"]),
                    purpose="Shared session requiring personal review",
                    workout=WorkoutContent.model_validate(item["workout"]),
                )
                for item in content["sessions"]
            ]
        except (ValueError, OverflowError):
            raise HTTPException(
                422, "Choose a start date that can accommodate the full program"
            ) from None
        proposal = ProgramProposal(
            status="needs_information",
            rule_version=RULE_VERSION,
            sessions=sessions,
            questions=[
                "Review the shared prescriptions against your equipment, availability, and declared limitations before adopting."
            ],
            warnings=[COPY_WARNING],
            progression_policy="No progression or personalization is inferred from copying.",
        )
        content = {"title": content["title"], "proposal": proposal.model_dump(mode="json")}
        row = WorkoutsProgram(
            id=identifier, app_user_id=user_id, generation=generation, revision=1, content=content
        )
        db.add(row)
        await db.flush()
        db.add(
            WorkoutsProgramVersion(
                app_user_id=user_id,
                generation=generation,
                program_id=row.id,
                revision=1,
                content=content,
            )
        )
    receipt = WorkoutCopyReceipt(
        app_user_id=user_id,
        generation=generation,
        copy_request_id=request.copy_request_id,
        share_id=share.id,
        source_token_hash=requested_token_hash,
        request_hash=request_hash,
        kind=share.kind,
        snapshot_digest=share.snapshot_digest,
        attribution=copy.deepcopy(share.snapshot["attribution"]),
        record_id=row.id,
    )
    db.add(receipt)
    await db.flush()
    return row, receipt, False

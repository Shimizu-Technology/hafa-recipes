"""Owner-row locks serialize mutations, media completion, and privacy erasure."""

import hashlib
import json
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMembership,
    BabyMessage,
    BabyRecord,
)
from app.models.identity import AppUser


def now():
    return datetime.now(UTC)


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


async def lock_owner(db, owner):
    if await db.scalar(select(AppUser.id).where(AppUser.id == owner).with_for_update()) is None:
        raise HTTPException(404, "Account unavailable")


async def membership_for(db, owner, *, generation=None, write=False, active=True):
    if write:
        await lock_owner(db, owner)
    row = await db.scalar(
        select(BabyMembership)
        .where(BabyMembership.app_user_id == owner)
        .execution_options(populate_existing=True)
    )
    if row is None or (active and row.status != "active"):
        raise HTTPException(409, "Open Baby and deliberately start a new library before saving")
    if generation is not None and generation != row.generation:
        raise HTTPException(409, "Baby data changed; refresh before saving")
    return row


async def owned(db, model, owner, generation, identifier):
    row = await db.scalar(
        select(model)
        .where(model.id == identifier, model.app_user_id == owner, model.generation == generation)
        .execution_options(populate_existing=True)
    )
    if row is None or getattr(row, "deleted_at", None) is not None:
        raise HTTPException(404, "Item unavailable")
    return row


async def validate_relations(db, owner, generation, child_id, data, *, record_id=None):
    if child_id:
        await owned(db, BabyChild, owner, generation, child_id)
    for identifier in data.get("attachment_ids", []):
        from uuid import UUID

        row = await owned(db, BabyAttachment, owner, generation, UUID(str(identifier)))
        if row.state != "ready":
            raise HTTPException(409, "Attachment is not ready")
    for identifier in data.get("record_ids", []):
        from uuid import UUID

        if str(identifier) == str(record_id):
            raise HTTPException(422, "A collection cannot contain itself")
        await owned(db, BabyRecord, owner, generation, UUID(str(identifier)))


async def owned_cleanup_prefixes(db, owner):
    exists = await db.scalar(text("SELECT to_regclass('public.baby_attachments') IS NOT NULL"))
    if not exists:
        return []
    from app.domains.baby.attachments import attachment_prefix

    return [
        attachment_prefix(row.id, owner, row.generation)
        for row in await db.scalars(
            select(BabyAttachment).where(BabyAttachment.app_user_id == owner)
        )
    ]


async def erase_account_data(db, owner):
    """Caller holds shared AppUser lock; cleanup survives all local cascades."""
    if not await db.scalar(text("SELECT to_regclass('public.baby_memberships') IS NOT NULL")):
        return
    from app.domains.baby.attachments import cleanup_job

    prefixes = await owned_cleanup_prefixes(db, owner)
    if prefixes:
        db.add(cleanup_job(owner, prefixes))
    # Sharing is additive/optional during rolling deployment. Product erasure
    # retires its capabilities and receipts as well as the original records.
    from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential

    for model in (BabyShareCapture, BabyShareCredential):
        if await db.scalar(
            text("SELECT to_regclass(:name) IS NOT NULL"), {"name": "public." + model.__tablename__}
        ):
            await db.execute(delete(model).where(model.app_user_id == owner))
    for model in (BabyMessage, BabyConversation, BabyImport, BabyRecord, BabyChild, BabyAttachment):
        await db.execute(delete(model).where(model.app_user_id == owner))


async def erase_product_data(db, member, generation):
    if member.status == "deleted" and member.generation == generation + 1:
        return
    if member.status != "active" or member.generation != generation:
        raise HTTPException(409, "Baby data changed; refresh before deleting")
    await erase_account_data(db, member.app_user_id)
    member.status = "deleted"
    member.generation += 1
    member.consent_epoch += 1
    member.profile = {}
    member.updated_at = now()

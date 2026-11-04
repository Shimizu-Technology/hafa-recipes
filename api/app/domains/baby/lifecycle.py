"""Owner-row locks serialize mutations, media completion, and privacy erasure."""

import hashlib
import json
from datetime import UTC, datetime, timedelta

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
from app.domains.baby.stats import care_query
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
    if write:
        from app.domains.baby.spaces import ensure_personal_space

        await ensure_personal_space(db, row)
    return row


async def owned(db, model, owner, generation, identifier):
    if hasattr(owner, "condition"):
        return await owner.row(
            db,
            model,
            identifier,
            write=owner.target is not None and owner.target.transaction is not None,
        )
    row = await db.scalar(
        select(model)
        .where(model.id == identifier, model.app_user_id == owner, model.generation == generation)
        .execution_options(populate_existing=True)
    )
    if row is None or getattr(row, "deleted_at", None) is not None:
        raise HTTPException(404, "Item unavailable")
    return row


def check_visit_link(event, child_id):
    """A question or note about one baby can't sit on another's visit. General ones fit any, and any fits a family one."""
    if event.kind != "event":
        raise HTTPException(422, "Choose an event from your calendar")
    if child_id and event.child_id and child_id != event.child_id:
        raise HTTPException(422, "Choose a visit for the same baby")


async def validate_relations(db, owner, generation, child_id, data, *, record_id=None, kind=None):
    if getattr(owner, "enabled", False):
        return await space_relations(db, owner, child_id, data, record_id=record_id, kind=kind)
    if child_id:
        await owned(db, BabyChild, owner, generation, child_id)
    for identifier in data.get("attachment_ids", []):
        from uuid import UUID

        row = await owned(db, BabyAttachment, owner, generation, UUID(str(identifier)))
        if row.state != "ready":
            raise HTTPException(409, "Attachment is not ready")
    if data.get("event_id"):
        from uuid import UUID

        check_visit_link(await owned(db, BabyRecord, owner, generation, UUID(str(data["event_id"]))), child_id)
    for identifier in data.get("record_ids", []):
        from uuid import UUID

        if str(identifier) == str(record_id):
            raise HTTPException(422, "A collection cannot contain itself")
        await owned(db, BabyRecord, owner, generation, UUID(str(identifier)))


async def space_relations(db, access, child_id, data, *, record_id, kind):
    from uuid import UUID

    target = access.target

    async def same_space(model, identifier):
        row = await access.row(db, model, UUID(str(identifier)))
        if row.space_id != target.id:
            raise HTTPException(422, "Related items must be in the same Baby space")
        return row

    if child_id:
        child = await access.row(db, BabyChild, child_id)
        personal_journal = kind == "journal" and target.space.kind == "personal"
        if child.space_id != target.id and not personal_journal:
            if kind in {"feeding", "sleep", "diaper", "contraction", "kick_session", "pumping",
                        "medicine", "temperature", "growth", "milestone", "custom", "routine", "event"}:
                # Reuse the moved-row protocol so queued care can retarget to its child.
                await access.row(db, BabyChild, child_id, write=True)
            raise HTTPException(422, "Related items must be in the same Baby space")
    for identifier in data.get("attachment_ids", []):
        from app.domains.baby.attachments import attachment_for

        row = await attachment_for(db, access, UUID(str(identifier)))
        if row.space_id != target.id:
            raise HTTPException(422, "Related items must be in the same Baby space")
        if row.state != "ready":
            raise HTTPException(409, "Attachment is not ready")
    for identifier in data.get("record_ids", []):
        if str(identifier) == str(record_id):
            raise HTTPException(422, "A collection cannot contain itself")
        await same_space(BabyRecord, identifier)
    if data.get("event_id"):
        check_visit_link(await same_space(BabyRecord, data["event_id"]), child_id)
    suggestion = data.get("suggested_category") or {}
    if suggestion.get("collection_id"):
        row = await same_space(BabyRecord, suggestion["collection_id"])
        if row.kind != "collection":
            raise HTTPException(422, "Choose a category")


async def readable_journal_children(db, rows, access):
    ids = {row.child_id for row in rows if row.kind == "journal" and row.child_id}
    if not ids or not getattr(access, "enabled", False):
        return ids
    return set(await db.scalars(select(BabyChild.id).where(
        BabyChild.id.in_(ids), access.condition(BabyChild), BabyChild.deleted_at.is_(None))))


# A phone's clock can run a little ahead. Further ahead is a plan or a typo, not a feed under way.
FEED_START_TOLERANCE = timedelta(minutes=5)


async def settle_running_feeds(db, owner, generation, child_id, *, changed=None):
    """Per child, only the newest breastfeed can be running; ties go to the higher record ID.

    Worked out from the live feeds each time, so arrival order cannot matter and undoing the
    newest feed restores the one before it. A finish still wins: it can arrive after this.
    A feed dated ahead neither runs nor ends one that does, and is left alone until its time.
    ``changed`` is the row the caller has already counted as a new revision.
    """
    await db.flush()
    latest = now() + FEED_START_TOLERANCE
    feeds = care_query(owner, generation, child_id, BabyRecord).where(BabyRecord.kind == "feeding")
    if getattr(owner, "enabled", False):
        feeds = feeds.where(BabyRecord.space_id == owner.target.id)
    newest = await db.scalar(
        feeds.where(
            BabyRecord.data["method"].as_string() == "breast", BabyRecord.occurred_at <= latest
        )
        .order_by(BabyRecord.occurred_at.desc(), BabyRecord.id.desc())
        .limit(1)
    )
    if newest is None:
        return
    running = await db.scalars(feeds.where(BabyRecord.data["state"].as_string() == "running"))
    for row in {item.id: item for item in (*running, newest)}.values():
        if row.occurred_at > latest:
            continue
        wanted = "running" if row.id == newest.id else "unknown_end"
        if row.data.get("state") in {"running", "unknown_end"} and row.data["state"] != wanted:
            row.data = {**row.data, "state": wanted}
            if row.id != changed:
                row.revision, row.updated_at = row.revision + 1, now()
            if getattr(owner, "enabled", False):
                from app.domains.baby.access import touch

                await touch(row, owner.grant(row))


async def owned_cleanup_prefixes(db, owner):
    exists = await db.scalar(text("SELECT to_regclass('public.baby_attachments') IS NOT NULL"))
    if not exists:
        return []
    from app.domains.baby.attachments import stored_prefix

    return [
        stored_prefix(row)
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

    from app.domains.baby.spaces import ensure_personal_space

    await ensure_personal_space(db, member)

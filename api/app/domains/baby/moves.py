"""Transactional moves preserve creator IDs and publish removals in the old space."""
from dataclasses import replace
from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.domains.baby.access import SpaceAccess, touch
from app.domains.baby.attachments import (
    acquire_asset_lock,
    attachment_prefix,
    cleanup_job,
    put_payload,
    read_bytes,
)
from app.domains.baby.lifecycle import now, validate_relations
from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyImport,
    BabyMovedOut,
    BabyRecord,
    BabySpace,
    BabySpaceMember,
)
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential


async def require_contract(db):
    if not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=58)")):
        raise HTTPException(409, "Baby family setup is not ready")


async def moved_out(db, identifier, grant):
    await touch(grant.space, grant)
    db.add(BabyMovedOut(space_id=grant.id, seq=grant.space.change_seq, record_id=identifier))


async def rotate_credentials(db, access):
    for row in await db.scalars(select(BabyShareCredential).where(
            BabyShareCredential.app_user_id == access.actor, BabyShareCredential.revoked_at.is_(None))):
        row.revoked_at = now()
        grant = next(g for g in access.locked_spaces + access.spaces if g.id == row.space_id)
        await touch(row, grant)


async def prepare_move_files(db, actor, access, record_id=None):
    """Stage immutable copies before account/space locks; receipts cover retries."""
    from types import SimpleNamespace

    if record_id is None and any(g.space.kind == "family" for g in access.spaces):
        await db.rollback()
        db.info["baby_move_files"] = {}
        return
    query = select(BabyRecord).where(access.condition(BabyRecord), BabyRecord.deleted_at.is_(None))
    if record_id is not None:
        query = query.where(BabyRecord.id == record_id)
    else:
        query = query.where(BabyRecord.space_id == access.personal_space_id, BabyRecord.kind != "journal",
                            BabyRecord.data["just_me"].as_boolean().is_distinct_from(True))
    rows = list(await db.scalars(query))
    moving_ids = {row.id for row in rows}
    identifiers = {UUID(key) for row in rows for key in row.data.get("attachment_ids", [])}
    snapshots = [SimpleNamespace(id=asset.id, object_key=asset.object_key, byte_hash=asset.byte_hash,
        size=asset.size, space_id=asset.space_id, generation=asset.generation, mime_type=asset.mime_type)
        for asset in await db.scalars(select(BabyAttachment).where(
            access.condition(BabyAttachment), BabyAttachment.id.in_(identifiers), BabyAttachment.state == "ready"))]
    snapshots = [asset for asset in snapshots if await db.scalar(select(BabyRecord.id).where(
        BabyRecord.space_id == asset.space_id, BabyRecord.deleted_at.is_(None),
        BabyRecord.id.not_in(moving_ids), BabyRecord.data["attachment_ids"].contains([str(asset.id)])).limit(1))]
    # Rollback releases even the discovery transaction before storage I/O.
    await db.rollback()
    prepared = {}
    for asset in snapshots:
        identifier = uuid4()
        # The physical prefix is stored independently of destination generation.
        prefix = attachment_prefix(identifier, actor, asset.generation)
        async with async_sessionmaker(db.bind, expire_on_commit=False)() as receipts:
            receipt = cleanup_job(actor, [prefix], after=now() + timedelta(hours=1))
            receipts.add(receipt)
            await receipts.commit()
            receipt_id = receipt.id
        payload = await read_bytes(asset)
        await put_payload(prefix + "asset", payload, asset.mime_type)
        prepared[asset.id] = ((asset.object_key, asset.byte_hash, asset.size, asset.space_id, asset.generation),
                              identifier, prefix, receipt_id)
    db.info["baby_move_files"] = prepared


async def move_file(db, access, asset, source, destination, record_id, batch_ids):
    await acquire_asset_lock(db, asset.id)
    other = await db.scalar(select(BabyRecord.id).where(
        BabyRecord.space_id == source.id, BabyRecord.deleted_at.is_(None), BabyRecord.id != record_id, BabyRecord.id.not_in(batch_ids),
        BabyRecord.data["attachment_ids"].contains([str(asset.id)])).limit(1))
    if other is None:
        await moved_out(db, asset.id, source)
        asset.space_id, asset.generation = destination.id, destination.generation
        await touch(asset, destination)
        return asset.id
    prepared = db.info.get("baby_move_files", {}).get(asset.id)
    signature = (asset.object_key, asset.byte_hash, asset.size, asset.space_id, asset.generation)
    if prepared is None or prepared[0] != signature:
        raise HTTPException(409, "Attached files changed; retry the move")
    _, identifier, prefix, receipt_id = prepared
    copy = BabyAttachment(id=identifier, app_user_id=access.actor, space_id=destination.id,
        generation=destination.generation, name=asset.name, mime_type=asset.mime_type,
        size=asset.size, object_key=prefix + "asset", byte_hash=asset.byte_hash, state="ready",
        cleanup_job_id=receipt_id)
    await touch(copy, destination)
    from app.models.deletion import DeletionCleanupJob

    intent = await db.get(DeletionCleanupJob, receipt_id)
    intent.status, intent.completed_at, intent.storage_prefixes = "completed", now(), []
    return identifier


async def clean_links(db, access, row, source, batch_ids):
    """Remove incoming and outgoing references that would cross the space boundary."""
    for related in await db.scalars(select(BabyRecord).where(
            BabyRecord.space_id == source.id, BabyRecord.id != row.id, BabyRecord.id.not_in(batch_ids), BabyRecord.deleted_at.is_(None))):
        data = dict(related.data)
        if str(row.id) in data.get("record_ids", []):
            data["record_ids"] = [key for key in data["record_ids"] if key != str(row.id)]
        if (data.get("suggested_category") or {}).get("collection_id") == str(row.id):
            data.pop("suggested_category", None)
        if data.get("event_id") == str(row.id):
            data.pop("event_id", None)
        if data != related.data:
            related.data, related.revision, related.updated_at = data, related.revision + 1, now()
            await touch(related, source)


async def move_record(db, access, row, destination, *, just_me=False, batch_ids=frozenset(), file_map=None):
    source = access.grant(row)
    if source.role != "parent" or destination.role != "parent":
        raise HTTPException(403, "Only parents can move shared entries")
    if row.kind == "journal" and row.app_user_id != access.actor:
        raise HTTPException(403, "Only the writer can share or un-share a journal entry")
    if destination.space.kind == "personal" and destination.id != access.personal_space_id:
        raise HTTPException(403, "Choose your own personal space")
    if (source.space.kind == "family" and destination.space.kind == "personal"
            and row.app_user_id is not None and row.app_user_id != access.actor):
        raise HTTPException(403, "Only the creator can make this shared entry personal")
    if source.id == destination.id:
        data = dict(row.data)
        if just_me:
            data["just_me"] = True
        else:
            data.pop("just_me", None)
        if data != row.data:
            row.data, row.revision, row.updated_at = data, row.revision + 1, now()
            await touch(row, source)
        return row
    file_map = file_map if file_map is not None else {}
    # Discover every relation before the first row mutation/autoflush.
    data = dict(row.data)
    child_id = row.child_id
    if child_id and row.kind in {"source", "collection"} and destination.space.kind == "personal":
        child = await db.get(BabyChild, child_id)
        if child is None or child.space_id != destination.id:
            child_id = None
    attachment_ids = set(data.get("attachment_ids", []))
    assets = list(await db.scalars(select(BabyAttachment).where(
        BabyAttachment.id.in_([UUID(key) for key in attachment_ids - file_map.keys()]),
        BabyAttachment.space_id == source.id, BabyAttachment.generation == source.generation)))
    if len(assets) + len(attachment_ids & file_map.keys()) != len(attachment_ids) or any(asset.state != "ready" for asset in assets):
        raise HTTPException(409, "An attached file is unavailable")
    jobs = list(await db.scalars(select(BabyImport).where(BabyImport.record_id == row.id,
                                                          BabyImport.space_id == source.id)))
    captures = list(await db.scalars(select(BabyShareCapture).where(BabyShareCapture.record_id == row.id,
                                                                   BabyShareCapture.space_id == source.id)))
    for key in ("record_ids",):
        if key in data:
            readable = set(await db.scalars(select(BabyRecord.id).where(
                BabyRecord.id.in_([UUID(value) for value in data[key]]),
                BabyRecord.space_id == destination.id, BabyRecord.deleted_at.is_(None)))) | set(batch_ids)
            data[key] = [value for value in data[key] if UUID(value) in readable]
    for key, identifier in (("event_id", data.get("event_id")),
                            ("suggested_category", (data.get("suggested_category") or {}).get("collection_id"))):
        if identifier and UUID(identifier) not in batch_ids:
            related = await db.get(BabyRecord, UUID(identifier))
            if related is None or related.space_id != destination.id or related.deleted_at is not None:
                data.pop(key, None)
    await clean_links(db, access, row, source, batch_ids)
    replacements = {key: value for key, value in file_map.items() if key in attachment_ids}
    for asset in sorted(assets, key=lambda item: item.id):
        replacements[str(asset.id)] = str(await move_file(db, access, asset, source, destination, row.id, batch_ids))
    file_map.update(replacements)
    if "attachment_ids" in data:
        data["attachment_ids"] = [replacements[key] for key in data["attachment_ids"]]
    if row.kind in {"source", "collection", "journal"}:
        if just_me:
            data["just_me"] = True
        else:
            data.pop("just_me", None)
    target = replace(access, target=destination)
    # During Create family, batch relations are validated after the final move.
    if not batch_ids:
        await validate_relations(db, target, destination.generation, child_id, data,
                                 record_id=row.id, kind=row.kind)
    await moved_out(db, row.id, source)
    row.space_id, row.generation, row.data, row.child_id = destination.id, destination.generation, data, child_id
    row.revision, row.updated_at = row.revision + 1, now()
    await touch(row, destination)
    for job in jobs:
        await moved_out(db, job.id, source)
        request = dict(job.request)
        if "attachment_ids" in request:
            request["attachment_ids"] = [replacements.get(key, key) for key in request["attachment_ids"]]
        job.space_id, job.generation, job.request = destination.id, destination.generation, request
        if job.status in {"queued", "processing"}:
            job.status, job.error, job.lease_token, job.lease_until = "queued", None, None, None
            job.updated_at = now()
        await touch(job, destination)
    for capture in captures:
        await moved_out(db, capture.id, source)
        capture.space_id, capture.generation = destination.id, destination.generation
        await touch(capture, destination)
    return row


async def create_family(db, access):
    await require_contract(db)
    existing = [g for g in access.spaces if g.space.kind == "family"]
    if existing:
        if len(existing) != 1 or existing[0].role != "parent":
            raise HTTPException(409, "You already belong to a family")
        return existing[0].space
    personal = next(g for g in access.spaces if g.id == access.personal_space_id)
    rows = list(await db.scalars(select(BabyRecord).where(
        BabyRecord.space_id == personal.id, BabyRecord.generation == personal.generation,
        BabyRecord.deleted_at.is_(None)).order_by(BabyRecord.id)))
    moving = [row for row in rows if row.kind != "journal" and not row.data.get("just_me")]
    children = list(await db.scalars(select(BabyChild).where(
        BabyChild.space_id == personal.id, BabyChild.generation == personal.generation,
        BabyChild.deleted_at.is_(None)).order_by(BabyChild.id)))
    space = BabySpace(id=uuid4(), kind="family", created_by=access.actor, generation=1,
                      timezone=personal.space.timezone)
    db.add(space)
    await db.flush()
    db.add(BabySpaceMember(space_id=space.id, app_user_id=access.actor, role="parent"))
    # A new uncommitted space is exclusively ours; no other actor can lock it.
    destination = SpaceAccess(space, "parent", 1, db, db.get_transaction())
    access = replace(access, spaces=access.spaces + (destination,), locked_spaces=access.locked_spaces + (destination,))
    for child in children:
        await moved_out(db, child.id, personal)
        child.space_id, child.generation, child.revision = space.id, 1, child.revision + 1
        await touch(child, destination)
    moved_children = {child.id for child in children}
    for row in rows:
        if row not in moving and row.kind != "journal" and row.child_id in moved_children:
            # Just me posts stay private; only journals retain a family child link.
            row.child_id, row.revision, row.updated_at = None, row.revision + 1, now()
            await touch(row, personal)
    ids = frozenset(row.id for row in moving)
    file_map = {}
    for row in moving:
        await move_record(db, access, row, destination, batch_ids=ids, file_map=file_map)
    for row in moving:
        await validate_relations(db, replace(access, target=destination), 1, row.child_id, row.data,
                                 record_id=row.id, kind=row.kind)
    await rotate_credentials(db, access)
    return space

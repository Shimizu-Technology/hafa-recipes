"""Bounded, commit-ordered per-space snapshots and deltas for client 3."""
import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select

from app.domains.baby.access import access_for, family_enabled
from app.domains.baby.attachments import attachment_visibility, metadata
from app.domains.baby.chat import conversation_response, conversation_scope, message_response
from app.domains.baby.dependencies import Database, User
from app.domains.baby.imports import import_response
from app.domains.baby.lifecycle import readable_journal_children
from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMessage,
    BabyMovedOut,
    BabyRecord,
)
from app.domains.baby.security import BabyRoute
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential

router = APIRouter(tags=["baby"], route_class=BabyRoute)
ENTITIES = (("child", BabyChild), ("record", BabyRecord), ("attachment", BabyAttachment),
    ("import", BabyImport), ("conversation", BabyConversation), ("message", BabyMessage),
    ("capture", BabyShareCapture), ("credential", BabyShareCredential))
MAX_SPACES = 8


def cursor_map(raw):
    try:
        value = json.loads(raw)
        if not isinstance(value, dict) or len(value) > MAX_SPACES:
            raise ValueError()
        result = {}
        for key, seq in value.items():
            if type(seq) is not int or not 0 <= seq <= 2**63 - 1:
                raise ValueError()
            result[UUID(key)] = seq
        return result
    except (TypeError, ValueError):
        raise HTTPException(422, "Use a bounded Baby cursor map with nonnegative integer sequences") from None


async def changes_access(request: Request, user: User, db: Database):
    if not family_enabled():
        raise HTTPException(404, "Not found")
    if request.headers.get("X-Baby-Client") != "3":
        raise HTTPException(403, "Update Baby before fetching space changes")
    # A short read transaction locks the same membership graph as writers. No
    # external processing occurs here; removal cannot change a page's visibility.
    return await access_for(db, user.id, client="3", write=True, bootstrap=True)


ChangesAccess = Annotated[object, Depends(changes_access)]


@router.get("/changes")
async def changes(db: Database, access: ChangesAccess,
                  cursor: Annotated[str, Query(max_length=2048)] = "{}",
                  access_version: Annotated[str, Query(max_length=2048)] = "{}",
                  limit: Annotated[int, Query(ge=1, le=100)] = 100):
    from app.domains.baby.router import child_response, record_response

    cursors, versions = cursor_map(cursor), cursor_map(access_version)
    if len(access.spaces) > MAX_SPACES:
        raise HTTPException(409, "Too many Baby spaces; refresh bootstrap")
    pages = []
    for grant in access.spaces:
        start, ceiling = cursors.get(grant.id, 0), grant.space.change_seq
        reset = (grant.id in versions and versions[grant.id] != grant.access_version) or start > ceiling
        if reset:
            pages.append({"id": str(grant.id), "generation": grant.generation,
                "access_version": grant.access_version, "cursor": 0, "items": [], "has_more": False, "reset": True})
            continue
        candidates = []
        for entity, model in ENTITIES:
            scope = conversation_scope(model, access) if model in (BabyConversation, BabyMessage) else access.condition(model)
            if model in (BabyShareCapture, BabyShareCredential):
                scope &= model.app_user_id == access.actor
            if model is BabyAttachment:
                scope &= (model.state == "deleted") | attachment_visibility(access)
            query = select(model).where(scope, model.space_id == grant.id,
                model.change_seq > start, model.change_seq <= ceiling).order_by(model.change_seq).limit(limit + 1)
            candidates.extend((row.change_seq, entity, row) for row in await db.scalars(query))
        tombstones = await db.scalars(select(BabyMovedOut).where(BabyMovedOut.space_id == grant.id,
            BabyMovedOut.seq > start, BabyMovedOut.seq <= ceiling).order_by(BabyMovedOut.seq).limit(limit + 1))
        candidates.extend((row.seq, "removed", row) for row in tombstones)
        candidates.sort(key=lambda item: item[0])
        selected = candidates[:limit]
        journal_children = await readable_journal_children(db, [row for _, entity, row in selected if entity == "record"], access)
        child_ids = {row.child_id for _, entity, row in selected if entity == "conversation" and row.child_id}
        readable_children = set(await db.scalars(select(BabyChild.id).where(BabyChild.id.in_(child_ids),
            access.condition(BabyChild), BabyChild.deleted_at.is_(None)))) if child_ids else set()
        items = []
        for seq, entity, row in selected:
            removed = entity == "removed" or getattr(row, "deleted_at", None) is not None or (
                entity == "attachment" and row.state == "deleted")
            if removed:
                payload = {"id": str(row.record_id if entity == "removed" else row.id), "removed": True}
            elif entity == "record":
                payload = record_response(row, access, journal_children)
            elif entity == "child":
                payload = child_response(row, access)
            elif entity == "attachment":
                payload = metadata(row, access)
            elif entity == "import":
                payload = import_response(row, access)
            elif entity == "conversation":
                payload = {**conversation_response(row), "child_id": row.child_id if row.child_id in readable_children else None}
            elif entity == "message":
                payload = {"id": str(row.id), **message_response(row, legacy=False)}
            elif entity == "capture":
                payload = {"id": str(row.id), "record_id": str(row.record_id), "status": row.status}
            else:
                payload = {"id": str(row.id), "revoked": row.revoked_at is not None, "expires_at": row.expires_at}
            items.append({**payload, "seq": seq, **({"entity": entity} if entity != "removed" else {})})
        more = len(candidates) > limit
        # No visible rows remain below the locked frontier, including filtered
        # kinds. Advancing to it avoids rescanning hidden rows on every poll.
        next_cursor = selected[-1][0] if more else ceiling
        pages.append({"id": str(grant.id), "generation": grant.generation, "access_version": grant.access_version,
            "cursor": next_cursor, "items": items, "has_more": more, "reset": False})
    readable_ids = {grant.id for grant in access.spaces}
    return {"spaces": pages, "cursor": {page["id"]: page["cursor"] for page in pages},
        "has_more": any(page["has_more"] for page in pages),
        "removed_space_ids": [str(key) for key in cursors if key not in readable_ids]}

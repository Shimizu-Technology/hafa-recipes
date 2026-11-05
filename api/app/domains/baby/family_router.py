"""Client-3-only family mutations; destination headers never redirect stored rows."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select

from app.domains.baby.access import access_for
from app.domains.baby.dependencies import Database, Generation, User
from app.domains.baby.models import BabyRecord, BabySpaceMember
from app.domains.baby.moves import move_record, require_contract
from app.domains.baby.schemas import DomainModel
from app.domains.baby.security import BabyRoute
from app.domains.baby.share_models import BabyShareCredential

router = APIRouter(tags=["baby"], route_class=BabyRoute)


async def family_access(request: Request, user: User, db: Database):
    from app.domains.baby.access import family_enabled
    from app.domains.baby.moves import check_move, prepare_move_files

    moving = request.method == "POST" and request.url.path.endswith("/move")
    inviting = request.method == "POST" and request.url.path.endswith("/family/invites")
    if family_enabled() and request.headers.get("X-Baby-Client") == "3" and (moving or inviting):
        discovery = await access_for(db, user.id, client="3",
            space_id=request.headers.get("X-Baby-Space"))
        try:
            record_id = UUID(str(request.path_params["identifier"])) if moving else None
        except ValueError:
            raise HTTPException(422, "Choose a valid Baby entry") from None
        stage = True
        if moving:
            target = discovery.target
            if target is None:
                raise HTTPException(422, "X-Baby-Space is required")
            try:
                body = MoveRequest.model_validate(await request.json())
            except ValueError:
                raise HTTPException(422, "Enter valid move details") from None
            row = await discovery.row(db, BabyRecord, record_id)
            stage = row.space_id == target.id
            if stage:
                if row.kind not in {"source", "collection", "journal"}:
                    raise HTTPException(422, "Only saved posts, categories and journal entries can be moved")
                if row.revision != body.revision:
                    raise HTTPException(409, "This entry changed; refresh before moving it")
                destination = next((g for g in discovery.spaces if g.id == body.space_id), None)
                if destination is None:
                    raise HTTPException(403, "Baby space unavailable")
                check_move(discovery, row, destination)
        if inviting:
            from app.domains.baby.invites import InviteCreate, check_invite_creation

            if discovery.target is None:
                raise HTTPException(422, "X-Baby-Space is required")
            try:
                body = InviteCreate.model_validate(await request.json())
                generation = int(request.headers.get("X-Baby-Generation", ""))
                if not 1 <= generation <= 2_147_483_647:
                    raise ValueError()
            except ValueError:
                raise HTTPException(422, "Enter valid invitation details") from None
            await check_invite_creation(db, discovery, body, generation)
        if stage:
            await prepare_move_files(db, user.id, discovery, record_id)
    # Capabilities in a former space must also rotate, without late user locks.
    extra = set(await db.scalars(select(BabyShareCredential.space_id).where(
        BabyShareCredential.app_user_id == user.id, BabyShareCredential.revoked_at.is_(None))))
    return await access_for(db, user.id, client=request.headers.get("X-Baby-Client"),
        space_id=request.headers.get("X-Baby-Space"), write=True, bootstrap=request.method == "GET",
        extra_space_ids=extra - {None})


FamilyAccess = Annotated[object, Depends(family_access)]


def require_family_client(access):
    if not access.enabled:
        raise HTTPException(404, "Not found")
    if access.client != "3":
        raise HTTPException(403, "Update Baby before using family features")


class MoveRequest(DomainModel):
    space_id: UUID
    revision: int = Field(ge=1)


@router.post("/records/{identifier}/move")
async def move(identifier: UUID, body: MoveRequest, user: User, db: Database,
               generation: Generation, access: FamilyAccess = None):
    require_family_client(access)
    await require_contract(db)
    row = await access.row(db, BabyRecord, identifier, write=True)
    access.check_generation(generation)
    if row.kind not in {"source", "collection", "journal"}:
        raise HTTPException(422, "Only saved posts, categories and journal entries can be moved")
    if row.revision != body.revision:
        raise HTTPException(409, "This entry changed; refresh before moving it")
    destination = next((grant for grant in access.spaces if grant.id == body.space_id), None)
    if destination is None:
        raise HTTPException(403, "Baby space unavailable")
    await move_record(db, access, row, destination, just_me=destination.space.kind == "personal")
    await db.commit()
    from app.domains.baby.router import record_reply

    return await record_reply(db, row, access)


async def erasure_access(request, db, actor, space_id, generation):
    from app.domains.baby.access import family_enabled
    from app.domains.baby.lifecycle import lock_family_data

    if not family_enabled():
        raise HTTPException(404, "Not found")
    if request.headers.get("X-Baby-Client") != "3":
        raise HTTPException(403, "Update Baby before using family features")
    grants = await lock_family_data(db, actor, space_id=space_id)
    access = await access_for(db, actor, client="3", space_id=request.headers.get("X-Baby-Space"),
        stored_space_id=space_id, generation=generation, write=True, extra_space_ids=[g.id for g in grants])
    if access.target.space.kind != "family":
        raise HTTPException(422, "Choose a family space")
    return access, grants


@router.post("/family/{space_id}/leave")
async def leave(space_id: UUID, request: Request, user: User, db: Database, generation: Generation):
    from app.domains.baby.lifecycle import end_family_membership

    access, grants = await erasure_access(request, db, user.id, space_id, generation)
    prefixes = await end_family_membership(db, user.id, access.target, grants)
    from app.domains.baby.attachments import cleanup_job

    if prefixes:
        db.add(cleanup_job(user.id, prefixes))
    await db.commit()
    return {"left": True}


@router.delete("/family/{space_id}/members/{actor}")
async def remove_member(space_id: UUID, actor: str, request: Request, user: User, db: Database,
                        generation: Generation):
    from app.domains.baby.lifecycle import end_family_membership

    access, grants = await erasure_access(request, db, user.id, space_id, generation)
    if access.target.role != "parent":
        raise HTTPException(403, "Only parents can remove a family member")
    prefixes = await end_family_membership(db, actor, access.target, grants, removed=True)
    from app.domains.baby.attachments import cleanup_job

    if prefixes:
        db.add(cleanup_job(actor, prefixes))
    await db.commit()
    return {"removed": True}


@router.delete("/family/{space_id}")
async def delete_family(space_id: UUID, request: Request, user: User, db: Database, generation: Generation):
    from app.domains.baby.attachments import cleanup_job
    from app.domains.baby.lifecycle import erase_space

    access, grants = await erasure_access(request, db, user.id, space_id, generation)
    if access.target.role != "parent":
        raise HTTPException(403, "Only parents can delete the family")
    if await db.scalar(select(BabySpaceMember.app_user_id).where(
        BabySpaceMember.space_id == space_id, BabySpaceMember.status == "active",
        BabySpaceMember.role == "parent", BabySpaceMember.app_user_id != user.id).limit(1)):
        raise HTTPException(409, "Only the last parent can delete the family")
    prefixes = await erase_space(db, access.target.space, grants)
    if prefixes:
        db.add(cleanup_job(user.id, prefixes))
    await db.commit()
    return {"deleted": True}

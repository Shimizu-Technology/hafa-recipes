"""Client-3-only family mutations; destination headers never redirect stored rows."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select

from app.domains.baby.access import access_for
from app.domains.baby.dependencies import Database, Generation, User
from app.domains.baby.models import BabyRecord
from app.domains.baby.moves import create_family, move_record, require_contract
from app.domains.baby.schemas import DomainModel
from app.domains.baby.security import BabyRoute
from app.domains.baby.share_models import BabyShareCredential

router = APIRouter(tags=["baby"], route_class=BabyRoute)


async def family_access(request: Request, user: User, db: Database):
    # Capabilities in a former space must also rotate, without late user locks.
    extra = set(await db.scalars(select(BabyShareCredential.space_id).where(
        BabyShareCredential.app_user_id == user.id, BabyShareCredential.revoked_at.is_(None))))
    return await access_for(db, user.id, client=request.headers.get("X-Baby-Client"),
        space_id=request.headers.get("X-Baby-Space"), write=True,
        extra_space_ids=extra - {None})


FamilyAccess = Annotated[object, Depends(family_access)]


def require_family_client(access):
    if not access.enabled:
        raise HTTPException(404, "Not found")
    if access.client != "3":
        raise HTTPException(403, "Update Baby before using family features")


@router.post("/family")
async def family(user: User, db: Database, generation: Generation, access: FamilyAccess = None):
    require_family_client(access)
    access.check_generation(generation)
    space = await create_family(db, access)
    await db.commit()
    return {"id": space.id, "generation": space.generation}


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

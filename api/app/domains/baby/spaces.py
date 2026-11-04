"""Idempotent personal-space provisioning; request and worker access lives in access.py."""
from fastapi import HTTPException
from sqlalchemy import select

from app.domains.baby.models import BabySpace, BabySpaceMember


async def ensure_personal_space(db, member):
    """Caller holds AppUser lock, including bootstrap, first writes and workers."""
    space = await db.scalar(select(BabySpace).where(
        BabySpace.created_by == member.app_user_id, BabySpace.kind == "personal"
    ).with_for_update())
    if space is None:
        if member.personal_space_id is not None:
            raise HTTPException(409, "Personal space is inconsistent; contact support")
        space = BabySpace(created_by=member.app_user_id, kind="personal",
                          generation=member.generation, change_seq=0, status=member.status)
        db.add(space)
        await db.flush()
    if member.personal_space_id not in (None, space.id):
        raise HTTPException(409, "Personal space is inconsistent; contact support")
    # Erasure advances the member generation. Existing access rules remain in
    # charge; keep its personal-space fence in step without rewriting row owners.
    space.generation, space.status = member.generation, member.status
    member.personal_space_id = space.id
    link = await db.get(BabySpaceMember, (space.id, member.app_user_id))
    if link is None:
        db.add(BabySpaceMember(space_id=space.id, app_user_id=member.app_user_id,
                               role="parent", status="active", access_version=1))
    elif link.role != "parent" or link.status != "active":
        raise HTTPException(409, "Personal space membership is inconsistent; contact support")
    await db.flush()
    return space

"""Hashed, single-use family invitations. No token is stored or returned on list."""
import hashlib
import secrets
from datetime import timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from sqlalchemy import func, select

from app.domains.baby import security
from app.domains.baby.access import SpaceAccess, access_for, family_enabled, touch
from app.domains.baby.dependencies import Database, Generation, User
from app.domains.baby.family_router import FamilyAccess, require_family_client
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyMembership, BabySpaceInvite, BabySpaceMember
from app.domains.baby.moves import create_family, require_contract, rotate_credentials
from app.domains.baby.schemas import DomainModel
from app.domains.baby.share_models import BabyShareCredential

DISCLOSURE_VERSION = 1
DISCLOSURE = "Shared family entries are available to every parent and to each parent's Ask when AI is enabled. Your personal journal and chats stay private. Update Baby on every signed-in phone before creating a family."


class InviteRoute(security.BabyRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handler(request):
            if not family_enabled():
                raise HTTPException(404, "Not found")
            if request.method == "POST" and not getattr(security.get_settings(), "baby_invites_enabled", False):
                raise HTTPException(404, "Not found")
            if request.headers.get("X-Baby-Client") != "3":
                raise HTTPException(403, "Update Baby before using family invitations")
            return await original(request)
        return handler


router = APIRouter(tags=["baby"], route_class=InviteRoute)


class InviteCreate(DomainModel):
    role: Literal["parent", "caregiver"] = "parent"
    publish_shared: bool = False
    disclosure_version: Literal[1] = 1


class InviteCode(DomainModel):
    code: str = Field(min_length=16, max_length=100)


class InviteAccept(InviteCode):
    disclosure_version: Literal[1]


def token_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()


def available(invite):
    if invite is None or invite.revoked_at is not None or invite.used_at is not None or invite.expires_at <= now():
        raise HTTPException(409, "This invitation is unavailable; ask for a new one")


def parent_space(access, space_id):
    require_family_client(access)
    grant = next((g for g in access.spaces if g.id == space_id and g.space.kind == "family"), None)
    if grant is None:
        raise HTTPException(404, "Family unavailable")
    if grant.role != "parent":
        raise HTTPException(403, "Only parents can manage invitations")
    if access.target is not None and access.target.id != space_id:
        raise HTTPException(409, "Baby space does not match the stored destination")
    return grant


async def record_disclosure(db, access, invite, *, action):
    entry = {"invite_id": str(invite.id), "space_id": str(invite.space_id), "version": DISCLOSURE_VERSION,
             "accepted_at": now().isoformat(), "role": invite.role, "action": action}
    access.member.profile = {**access.member.profile,
        "family_disclosures": [*access.member.profile.get("family_disclosures", []), entry]}
    personal = next(g for g in access.spaces if g.id == access.personal_space_id)
    await touch(personal.space, personal)


def summary(row):
    return {"id": row.id, "role": row.role, "expires_at": row.expires_at,
            "used_at": row.used_at, "revoked_at": row.revoked_at}


async def check_invite_creation(db, access, body, generation):
    """Run cheap admission before staging and again under the write locks."""
    access.check_generation(generation)
    await require_contract(db)
    existing = [g for g in access.spaces if g.space.kind == "family"]
    if not existing and not body.publish_shared:
        raise HTTPException(422, "Review what becomes shared before creating your family")
    return existing


@router.post("/family/invites", status_code=201)
async def create_invite(body: InviteCreate, user: User, db: Database, generation: Generation,
                        access: FamilyAccess = None):
    existing = await check_invite_creation(db, access, body, generation)
    space = await create_family(db, access)
    # create_family enforces parent access, including first-invite replay.
    pending = await db.scalar(select(func.count()).select_from(BabySpaceInvite).where(
        BabySpaceInvite.space_id == space.id, BabySpaceInvite.used_at.is_(None),
        BabySpaceInvite.revoked_at.is_(None), BabySpaceInvite.expires_at > now()))
    if pending >= 10:
        raise HTTPException(429, "Revoke an unused invitation before creating another")
    code = "hfbi_v1." + secrets.token_urlsafe(24)
    row = BabySpaceInvite(id=uuid4(), space_id=space.id, created_by=user.id,
        token_hash=token_hash(code), role=body.role, expires_at=now() + timedelta(days=7))
    db.add(row)
    if not existing:
        await record_disclosure(db, access, row, action="create")
    await touch(space, SpaceAccess(space, "parent", 1, db, db.get_transaction()))
    await db.commit()
    return {**summary(row), "space_id": space.id, "generation": space.generation, "code": code,
            "disclosure_version": DISCLOSURE_VERSION, "disclosure": DISCLOSURE}


@router.post("/family/invites/preview")
async def preview_invite(body: InviteCode, user: User, db: Database):
    row = await db.scalar(select(BabySpaceInvite).where(BabySpaceInvite.token_hash == token_hash(body.code)))
    available(row)
    return {"role": row.role, "expires_at": row.expires_at,
            "disclosure_version": DISCLOSURE_VERSION, "disclosure": DISCLOSURE}


@router.post("/family/invites/accept")
async def accept_invite(body: InviteAccept, request: Request, user: User, db: Database, generation: Generation):
    row = await db.scalar(select(BabySpaceInvite).where(BabySpaceInvite.token_hash == token_hash(body.code)))
    available(row)
    identifier, family_id = row.id, row.space_id
    extra = set(await db.scalars(select(BabyShareCredential.space_id).where(
        BabyShareCredential.app_user_id == user.id, BabyShareCredential.revoked_at.is_(None))))
    access = await access_for(db, user.id, client="3", space_id=request.headers.get("X-Baby-Space"),
        generation=generation, write=True, extra_space_ids={family_id, *extra} - {None})
    await require_contract(db)
    if access.target.id != access.personal_space_id:
        raise HTTPException(422, "Accept an invitation from your personal space")
    if any(g.space.kind == "family" for g in access.spaces):
        raise HTTPException(409, "Leave your current family before joining another")
    row = await db.get(BabySpaceInvite, identifier, populate_existing=True, with_for_update=True)
    available(row)
    family = next((g for g in access.locked_spaces if g.id == family_id and g.space.status == "active"), None)
    if family is None:
        raise HTTPException(409, "This family is unavailable")
    link = await db.get(BabySpaceMember, (family_id, user.id))
    if link is None:
        link = BabySpaceMember(space_id=family_id, app_user_id=user.id, role=row.role, status="active", access_version=1)
        db.add(link)
    else:
        link.role, link.status, link.access_version = row.role, "active", link.access_version + 1
    row.used_at = now()
    await record_disclosure(db, access, row, action="accept")
    await rotate_credentials(db, access)
    await touch(family.space, family)
    await db.commit()
    return {"space_id": family_id, "generation": family.generation, "role": link.role,
            "access_version": link.access_version}


@router.get("/family/{space_id}/invites")
async def list_invites(space_id: UUID, user: User, db: Database, access: FamilyAccess = None):
    parent_space(access, space_id)
    rows = await db.scalars(select(BabySpaceInvite).where(BabySpaceInvite.space_id == space_id)
                           .order_by(BabySpaceInvite.expires_at.desc()).limit(100))
    return {"items": [summary(row) for row in rows]}


@router.delete("/family/{space_id}/invites/{identifier}")
async def revoke_invite(space_id: UUID, identifier: UUID, user: User, db: Database,
                        generation: Generation, access: FamilyAccess = None):
    grant = parent_space(access, space_id)
    access.check_generation(generation)
    row = await db.get(BabySpaceInvite, identifier, populate_existing=True, with_for_update=True)
    if row is None or row.space_id != space_id:
        raise HTTPException(404, "Invitation unavailable")
    if row.used_at is None and row.revoked_at is None:
        row.revoked_at = now()
        await touch(grant.space, grant)
    await db.commit()
    return {"revoked": True}


@router.get("/family/{space_id}/members")
async def list_members(space_id: UUID, user: User, db: Database, access: FamilyAccess = None):
    parent_space(access, space_id)
    rows = await db.execute(select(BabySpaceMember, BabyMembership.profile["display_name"].as_string())
        .join(BabyMembership, BabyMembership.app_user_id == BabySpaceMember.app_user_id)
        .where(BabySpaceMember.space_id == space_id).order_by(BabySpaceMember.app_user_id).limit(100))
    return {"items": [{"app_user_id": member.app_user_id, "role": member.role, "status": member.status,
        "access_version": member.access_version, "display_name": name or ""} for member, name in rows]}

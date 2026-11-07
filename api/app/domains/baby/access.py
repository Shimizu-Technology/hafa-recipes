"""Space access and commit-ordered stamps. Call before locking records or assets."""

from dataclasses import dataclass
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update

from app.domains.baby.lifecycle import membership_for
from app.domains.baby.models import BabyImport, BabyMembership, BabySpace, BabySpaceMember
from app.domains.baby.security import get_settings
from app.domains.baby.share_models import BabyShareCapture
from app.models.identity import AppUser

CAREGIVER_KINDS = frozenset({
    "feeding", "sleep", "diaper", "routine", "event", "contraction", "kick_session",
    "pumping", "medicine", "temperature", "growth", "milestone", "custom",
})


VISIT_PRIVATE_FIELDS = frozenset({"results", "result_status", "follow_up", "paste_origin", "clinician_age", "due_date_snapshot", "doctor", "provider_default", "provider_default_at"})

VISIT_SIGNAL_FIELDS = ("results", "result_status", "follow_up", "clinician_age", "due_date_snapshot", "provider_default_at")


def medical_visit(data):
    """Category edits cannot declassify prior medical visit content."""
    return data.get("category") == "appointment" or data.get("medical_visit") is True or any(
        data.get(key) is not None for key in VISIT_SIGNAL_FIELDS
    )


def caregiver_visit(row, access):
    return (getattr(access, "enabled", False) and getattr(row, "kind", None) == "event"
            and medical_visit(row.data or {}) and access.grant(row).role == "caregiver")


def visit_response(row, result, access):
    if caregiver_visit(row, access):
        result = {**result, "body": "", "data": {key: value for key, value in result["data"].items() if key not in VISIT_PRIVATE_FIELDS}}
    return result


def visit_for_reader(row, access):
    if not caregiver_visit(row, access):
        return row
    return SimpleNamespace(**{**row.__dict__, **visit_response(row, {"body": row.body, "data": row.data}, access)})


def family_enabled():
    return getattr(get_settings(), "baby_family_enabled", False)


def family_open_to(actor):
    """BABY_FAMILY_TEST_USERS, a rollout gate for the rehearsal. Unset or blank is open to everyone."""
    listed = {item.strip() for item in (getattr(get_settings(), "baby_family_test_users", "") or "").split(",")}
    listed.discard("")
    return not listed or actor in listed


class AccessChanged(HTTPException):
    def __init__(self):
        super().__init__(409, "Baby access changed; retry before saving")


@dataclass(frozen=True)
class SpaceAccess:
    space: BabySpace
    role: str
    access_version: int
    db: object
    transaction: object = None

    @property
    def id(self):
        return self.space.id

    @property
    def generation(self):
        return self.space.generation


@dataclass(frozen=True)
class BabyAccess:
    actor: str
    member: BabyMembership
    spaces: tuple[SpaceAccess, ...]
    target: SpaceAccess | None
    enabled: bool
    client: str | None
    member_spaces: tuple[SpaceAccess, ...] = ()
    locked_spaces: tuple[SpaceAccess, ...] = ()

    @property
    def personal_space_id(self):
        return self.member.personal_space_id

    def check_generation(self, generation):
        expected = self.target.generation if self.enabled else self.member.generation
        if generation != expected:
            raise HTTPException(409, "Baby data changed; refresh before saving")

    def condition(self, model):
        if not self.enabled:
            return and_(model.app_user_id == self.actor, model.generation == self.member.generation)
        conditions = []
        for grant in self.spaces:
            condition = and_(model.space_id == grant.id, model.generation == grant.generation)
            if grant.role == "caregiver" and hasattr(model, "kind"):
                condition = and_(condition, model.kind.in_(CAREGIVER_KINDS))
            if grant.role == "caregiver" and model in (BabyImport, BabyShareCapture):
                condition = and_(condition, model.app_user_id == self.actor)
            conditions.append(condition)
        return or_(*conditions) if conditions else False

    def grant(self, row, *, kinds=True):
        for grant in self.spaces:
            if row.space_id == grant.id and row.generation == grant.generation:
                if grant.role == "caregiver" and isinstance(row, (BabyImport, BabyShareCapture)) and row.app_user_id != self.actor:
                    continue
                if not kinds or grant.role != "caregiver" or not hasattr(row, "kind") or row.kind in CAREGIVER_KINDS:
                    return grant
        raise HTTPException(404, "Item unavailable")

    async def row(self, db, model, identifier, *, write=False):
        query = select(model).where(model.id == identifier, self.condition(model))
        if write:
            query = query.with_for_update()
        row = await db.scalar(query.execution_options(populate_existing=True))
        if row is None or getattr(row, "deleted_at", None) is not None:
            raise HTTPException(404, "Item unavailable")
        if write and self.enabled and row.space_id != self.target.id:
            from fastapi.encoders import jsonable_encoder

            details = {"code": "moved", "space_id": str(row.space_id),
                       "generation": row.generation, "revision": getattr(row, "revision", None)}
            details["record"] = jsonable_encoder({key: getattr(row, key) for key in (
                "id", "kind", "title", "body", "child_id", "occurred_at", "data", "revision",
                "created_at", "updated_at", "space_id", "generation", "name", "birth_date", "due_date", "details") if hasattr(row, key)})
            if getattr(row, "kind", None) == "event":
                details["record"] = visit_response(row, details["record"], self)
            if getattr(row, "kind", None) == "journal" and row.child_id:
                from app.domains.baby.models import BabyChild

                readable = await db.scalar(select(BabyChild.id).where(
                    BabyChild.id == row.child_id, self.condition(BabyChild),
                    BabyChild.deleted_at.is_(None)))
                if readable is None:
                    details["record"]["child_id"] = None
            raise HTTPException(409, details)
        return row


async def _spaces(db, actor, inactive_personal=None):
    return list((await db.execute(
        select(BabySpace, BabySpaceMember.role, BabySpaceMember.access_version)
        .join(BabySpaceMember, BabySpaceMember.space_id == BabySpace.id)
        .where(BabySpaceMember.app_user_id == actor, BabySpaceMember.status == "active",
               or_(BabySpace.status == "active", BabySpace.id == inactive_personal))
        .order_by(BabySpace.id)
        .execution_options(populate_existing=True)
    )).all())


def _snapshot(rows):
    return tuple((space.id, space.generation, role, version) for space, role, version in rows)


async def access_for(db, actor, *, client=None, space_id=None, stored_space_id=None,
                     generation=None, write=False, bootstrap=False, actor_ids=(), active=True, extra_space_ids=(), poll=False):
    """Discover, lock users ascending, lock spaces ascending, then recheck access.

    Workers and capabilities pass their stored destination; request headers cannot
    redirect them. Callers discovering other affected actors pass all actor_ids
    before taking any lock. Record/asset discovery must also be rechecked by callers.
    """
    if not family_enabled():
        member = await membership_for(db, actor, generation=generation, write=write, active=active)
        return BabyAccess(actor, member, (), None, False, client)
    member = await membership_for(db, actor, active=active)
    discovered = await _spaces(db, actor, member.personal_space_id if not active else None)
    locked = []
    if write:
        # Extra destinations come only from server-discovered actor-owned capabilities.
        personal_id = None
        if member.personal_space_id is None:
            personal_id = await db.scalar(select(BabySpace.id).where(
                BabySpace.created_by == actor, BabySpace.kind == "personal"))
        lock_ids = sorted({space.id for space, _, _ in discovered} | set(extra_space_ids)
                          | ({personal_id} if personal_id is not None else set()))
        # All writers in this domain use this order, including short worker claims.
        affected = set(await db.scalars(select(BabySpaceMember.app_user_id).where(
            BabySpaceMember.space_id.in_(lock_ids))))
        for identifier in sorted({actor, *actor_ids, *affected}):
            if await db.scalar(select(AppUser.id).where(AppUser.id == identifier).with_for_update(key_share=poll)) is None:
                if identifier == actor:
                    raise HTTPException(404, "Account unavailable")
                raise AccessChanged()
        for identifier in lock_ids:
            space = await db.scalar(select(BabySpace).where(BabySpace.id == identifier).with_for_update())
            if space is not None:
                locked.append(SpaceAccess(space, "internal", 0, db, db.get_transaction()))
        affected_after = set(await db.scalars(select(BabySpaceMember.app_user_id).where(
            BabySpaceMember.space_id.in_(lock_ids))))
        if affected_after != affected:
            raise AccessChanged()
        before = _snapshot(discovered)
        member = await membership_for(db, actor, active=active)
        provisioned = None
        if member.personal_space_id is None:
            from app.domains.baby.spaces import ensure_personal_space

            provisioned = await ensure_personal_space(db, member)
            if provisioned.id not in {grant.id for grant in locked}:
                locked.append(SpaceAccess(provisioned, "internal", 0, db, db.get_transaction()))
        discovered = await _spaces(db, actor, member.personal_space_id if not active else None)
        after = _snapshot(discovered)
        if provisioned is not None:
            before = tuple(value for value in before if value[0] != provisioned.id)
            after = tuple(value for value in after if value[0] != provisioned.id)
        if before != after:
            raise AccessChanged()
        member = await membership_for(db, actor, active=active)
    try:
        requested = UUID(str(space_id)) if space_id is not None else None
        stored = UUID(str(stored_space_id)) if stored_space_id is not None else None
    except ValueError:
        raise HTTPException(422, "Choose a valid Baby space") from None
    if stored is not None:
        if requested is not None and requested != stored:
            raise HTTPException(409, "Baby space does not match the stored destination")
        destination = stored
    elif client == "3":
        if write and not bootstrap and requested is None:
            raise HTTPException(422, "X-Baby-Space is required")
        destination = requested if not bootstrap else None
    else:
        destination = member.personal_space_id
        if requested is not None and requested != destination:
            raise HTTPException(403, "This client can only use its personal space")
    grants = tuple(SpaceAccess(space, role, version, db, db.get_transaction() if write else None)
                   for space, role, version in discovered)
    member_spaces = grants
    if stored is not None or client != "3":
        grants = tuple(grant for grant in grants if grant.id == destination)
    target = next((grant for grant in grants if grant.id == destination), None)
    if destination is not None and target is None:
        raise HTTPException(403, "Baby space unavailable")
    if write and not bootstrap and target is None:
        raise HTTPException(409, "Open Baby to initialize your personal space")
    if write and target is not None and target.space.kind == "personal" and target.id != member.personal_space_id:
        raise HTTPException(403, "Another person's personal space cannot be changed")
    if generation is not None:
        if target is None:
            raise HTTPException(422, "Choose a Baby space before checking its generation")
        if generation != target.generation:
            raise HTTPException(409, "Baby data changed; refresh before saving")
    if write:
        db.info["baby_family_write"] = True
    return BabyAccess(actor, member, grants, target, True, client, member_spaces, tuple(locked))


async def touch(row, space):
    """Stamp a changed row while retaining its space lock until commit/rollback.

    A disabled gate supplies None. Sequence updates use UPDATE ... RETURNING,
    never an in-memory counter that could race or be reused after rollback.
    """
    if space is None:
        return
    if space.transaction is None or space.db.get_transaction() is not space.transaction:
        raise RuntimeError("touch requires the current access_for write transaction")
    if row.generation != space.generation:
        raise RuntimeError("touch destination does not match the row")
    await _stamp(row, space)


async def _stamp(row, space):
    """Stamp recovery rows even when their stored generation has been retired."""
    db = space.db
    if space.transaction is None or db.get_transaction() is not space.transaction:
        raise RuntimeError("touch requires the current access_for write transaction")
    if row is not space.space and row.space_id != space.id:
        raise RuntimeError("touch destination does not match the row")
    with db.no_autoflush:
        row.change_seq = await db.scalar(update(BabySpace).where(BabySpace.id == space.id)
                                         .values(change_seq=BabySpace.change_seq + 1)
                                         .returning(BabySpace.change_seq))
    db.add(row)
    db.info.setdefault("baby_touched_rows", {})[id(row)] = db.sync_session.get_transaction()

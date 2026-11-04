"""F3: dry-run by default; assign personal spaces without changing ownership."""
import argparse
import asyncio
import json
import os
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.db.database import engine
from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMembership,
    BabyMessage,
    BabyRecord,
    BabySpace,
    BabySpaceMember,
)
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential
from app.models.identity import AppUser

MODELS = (BabyChild, BabyRecord, BabyAttachment, BabyImport, BabyConversation,
          BabyMessage, BabyShareCredential, BabyShareCapture)
AUDIT_DDL = (
    """CREATE TABLE IF NOT EXISTS baby_space_backfill_audit (
        id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        restore_point VARCHAR(160) NOT NULL, summary JSONB NOT NULL)""",
    """CREATE OR REPLACE FUNCTION baby_space_backfill_audit_append_only()
        RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Baby backfill audit is append-only'; END $$""",
    "DROP TRIGGER IF EXISTS baby_space_backfill_audit_guard ON baby_space_backfill_audit",
    """CREATE TRIGGER baby_space_backfill_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE
        ON baby_space_backfill_audit FOR EACH STATEMENT
        EXECUTE FUNCTION baby_space_backfill_audit_append_only()""",
)


class BackfillConflict(RuntimeError):
    """Fail without leaking identities or row contents into a job log."""


async def backfill(*, apply=False, migration_engine=None, configured=None):
    configured = configured or get_settings()
    restore = os.environ.get("BABY_SPACE_BACKFILL_RESTORE_POINT", "").strip()
    if apply and ((configured.environment == "production" and not restore)
            or len(restore) > 160 or any(ord(char) < 32 for char in restore)):
        raise RuntimeError("BABY_SPACE_BACKFILL_RESTORE_POINT must name a verified restore point")
    target = migration_engine or engine
    sessions = async_sessionmaker(target, expire_on_commit=False)
    async with sessions() as db, db.begin():
        await db.execute(text("SET LOCAL lock_timeout = '5s'"))
        if apply:
            await db.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
        for version in (56, 57):
            if not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=:v)"), {"v": version}):
                raise RuntimeError(f"Apply Baby migration{version:03} before F3")
        # Global order: users, spaces, then rows. F2 writers use the same user lock.
        discovered = list(await db.scalars(select(BabyMembership.app_user_id).order_by(BabyMembership.app_user_id)))
        if apply:
            await db.execute(select(AppUser.id).where(AppUser.id.in_(
                discovered
            )).order_by(AppUser.id).with_for_update())
        members = list(await db.scalars(select(BabyMembership).order_by(BabyMembership.app_user_id)))
        if [member.app_user_id for member in members] != discovered:
            raise BackfillConflict("Baby membership set changed; retry the backfill")
        space_query = select(BabySpace).order_by(BabySpace.id)
        spaces = list(await db.scalars(space_query.with_for_update() if apply else space_query))
        by_id, personal = {space.id: space for space in spaces}, {}
        for space in spaces:
            if space.kind == "personal" and space.created_by is not None:
                if space.created_by in personal:
                    raise BackfillConflict("Duplicate personal spaces")
                personal[space.created_by] = space
        summary = {"spaces_created": 0, "members_linked": 0, "memberships_created": 0,
                   "rows_assigned": 0, "rows_sequenced": 0, "counters_advanced": 0}
        assignments, links, new_spaces, pointers = [], [], [], []
        owner_spaces = {}
        for member in members:
            space = personal.get(member.app_user_id)
            if space is None:
                if member.personal_space_id is not None:
                    raise BackfillConflict("Personal space pointer has the wrong owner or kind")
                space = BabySpace(id=uuid4(), kind="personal", created_by=member.app_user_id,
                                  generation=member.generation, change_seq=0, status=member.status,
                                  timezone="Pacific/Guam")
                new_spaces.append(space)
                summary["spaces_created"] += 1
            if (member.personal_space_id not in (None, space.id)
                    or space.generation != member.generation or space.status != member.status):
                raise BackfillConflict("Personal space pointer, generation or status conflicts")
            if space.id in by_id and await db.scalar(select(BabySpaceMember.app_user_id).where(
                    BabySpaceMember.space_id == space.id,
                    BabySpaceMember.app_user_id != member.app_user_id).limit(1)):
                raise BackfillConflict("Another actor is linked to a personal space")
            if member.personal_space_id is None:
                pointers.append((member, space.id))
                summary["members_linked"] += 1
            link = await db.get(BabySpaceMember, (space.id, member.app_user_id)) if space.id in by_id else None
            if link is None:
                links.append(BabySpaceMember(space_id=space.id, app_user_id=member.app_user_id,
                                              role="parent", status="active", access_version=1))
                summary["memberships_created"] += 1
            elif link.role != "parent" or link.status != "active":
                raise BackfillConflict("Personal membership conflicts")
            owner_spaces[member.app_user_id] = space
        # Include soft-deleted children/records, retired assets, cancelled imports,
        # revoked credentials and every other generation: no liveness filter.
        used = {space.id: set() for space in owner_spaces.values()}
        counters = {space.id: space.change_seq for space in owner_spaces.values()}
        for model in MODELS:
            query = select(model).order_by(model.id)
            for row in await db.scalars(query.with_for_update() if apply else query):
                space = owner_spaces.get(row.app_user_id)
                if space is None or row.space_id not in (None, space.id):
                    raise BackfillConflict(f"{model.__tablename__}: owner/space conflict")
                if row.change_seq is not None and row.change_seq < 0:
                    raise BackfillConflict(f"{model.__tablename__}: negative sequence")
                if row.change_seq:
                    if row.change_seq in used[space.id]:
                        raise BackfillConflict("Duplicate sequence in a personal space")
                    used[space.id].add(row.change_seq)
                    counters[space.id] = max(counters[space.id], row.change_seq)
                assignments.append((row, space))
        changes = []
        for row, space in assignments:
            sequence = row.change_seq
            if not sequence:
                counters[space.id] += 1
                sequence = counters[space.id]
                summary["rows_sequenced"] += 1
            if row.space_id is None:
                summary["rows_assigned"] += 1
            changes.append((row, space.id, sequence))
        for space in owner_spaces.values():
            if counters[space.id] != space.change_seq:
                summary["counters_advanced"] += 1
        summary["changes"] = sum(summary.values())
        summary["null_space_ids"] = sum(row.space_id is None for row, _ in assignments)
        if apply:
            # No mutation occurred before all conflicts were checked.
            db.add_all(new_spaces)
            await db.flush()
            db.add_all(links)
            for member, space_id in pointers:
                member.personal_space_id = space_id
            for row, space_id, sequence in changes:
                row.space_id, row.change_seq = space_id, sequence
            for space in owner_spaces.values():
                space.change_seq = counters[space.id]
            await db.flush()
            summary["null_space_ids"] = 0
            for ddl in AUDIT_DDL:
                await db.execute(text(ddl))
            await db.execute(text("""INSERT INTO baby_space_backfill_audit(id,restore_point,summary)
                VALUES(:id,:restore,CAST(:summary AS jsonb))"""),
                {"id": uuid4(), "restore": restore, "summary": json.dumps(summary)})
        return {"mode": "apply" if apply else "dry-run", **summary}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit after conflict checks; default is dry-run")
    args = parser.parse_args()
    try:
        print(json.dumps(await backfill(apply=args.apply), sort_keys=True))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

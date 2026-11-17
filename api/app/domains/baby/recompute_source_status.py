"""Recompute saved-post status under the readable-post rule. Dry-run by default.

Only promotes "incomplete" to "ready" when the post has a summary and text read
from the post itself (processing.missing_content). It never demotes a post,
never changes what was read, and prints ids and reasons, never content.

    python -m app.domains.baby.recompute_source_status            # report only
    python -m app.domains.baby.recompute_source_status --apply    # write
"""

import argparse
import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.database import engine
from app.domains.baby.access import SpaceAccess, _stamp
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyImport, BabyRecord, BabySpace
from app.domains.baby.processing import missing_reason

# The worker's own words when her edit won over a reread; that reread was thrown away, so it stays a retry.
EDIT_CONFLICT = "You edited this source while it processed."


async def latest_import(db, record_id, *, lock=False):
    query = select(BabyImport).where(BabyImport.record_id == record_id).order_by(BabyImport.created_at.desc()).limit(1)
    return await db.scalar(query.with_for_update() if lock else query)


def why_incomplete(data, job):
    if job is not None and (job.error or "").startswith(EDIT_CONFLICT):
        return "edited_while_processing"
    return missing_reason(data, ai_expected=True)


async def promote(db, record_id, revision):
    """One post per transaction; anything that changed since the scan is left alone."""
    record = await db.get(BabyRecord, record_id, populate_existing=True)
    space = record and record.space_id and await db.scalar(
        select(BabySpace).where(BabySpace.id == record.space_id).with_for_update())
    record = await db.get(BabyRecord, record_id, populate_existing=True, with_for_update=True)
    if (record is None or record.deleted_at is not None or record.revision != revision
            or (record.data or {}).get("status") != "incomplete"):
        return False
    # The latest finished import is what an import card shows; it no longer needs attention.
    job = await latest_import(db, record.id, lock=True)
    if why_incomplete(record.data, job):
        return False
    grant = SpaceAccess(space, "internal", 0, db, db.get_transaction()) if space else None
    db.info["baby_family_write"] = True
    record.data = {**record.data, "status": "ready"}
    record.revision, record.updated_at = record.revision + 1, now()
    if grant:
        await _stamp(record, grant)
    if job is not None and job.status == "incomplete" and job.space_id == record.space_id:
        # updated_at stays: a fresh one would send a days-old "is ready" push (triggers.plan_imports).
        job.status, job.error = "ready", None
        if grant:
            await _stamp(job, grant)
    return True


async def recompute(*, apply=False, migration_engine=None):
    sessions = async_sessionmaker(migration_engine or engine, expire_on_commit=False)
    counts = {"incomplete": 0, "promote": 0, "promoted": 0, "skipped_changed": 0, "stay_incomplete": 0}
    candidates = []
    async with sessions() as db:
        await db.execute(text("SET statement_timeout = '60s'"))
        rows = await db.execute(select(BabyRecord.id, BabyRecord.revision, BabyRecord.created_at, BabyRecord.data).where(
            BabyRecord.kind == "source", BabyRecord.deleted_at.is_(None),
            BabyRecord.data["status"].astext == "incomplete").order_by(BabyRecord.created_at))
        for record_id, revision, created_at, data in rows:
            counts["incomplete"] += 1
            why = why_incomplete(data, await latest_import(db, record_id))
            counts["stay_incomplete" if why else "promote"] += 1
            print({"record": str(record_id), "saved": created_at.date().isoformat(), "platform": data.get("platform"),
                   "decision": "stay_incomplete" if why else "ready", **({"reason": why} if why else {})}, flush=True)
            if not why:
                candidates.append((record_id, revision))
    if apply:
        for record_id, revision in candidates:
            async with sessions() as db, db.begin():
                await db.execute(text("SET LOCAL lock_timeout = '5s'"))
                changed = await promote(db, record_id, revision)
            counts["promoted" if changed else "skipped_changed"] += 1
    return {"mode": "apply" if apply else "dry_run", **counts}


async def main(apply):
    print(await recompute(apply=apply))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the promotions (default: report only)")
    asyncio.run(main(parser.parse_args().apply))

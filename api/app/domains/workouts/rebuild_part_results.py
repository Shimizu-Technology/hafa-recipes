"""Rebuild from immutable JSONB only. Dry-run by default; conflicts stop the run."""

import argparse
import asyncio

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.domains.workouts.lifecycle import lock_owner
from app.domains.workouts.models import WorkoutsSession
from app.domains.workouts.part_result_models import PartResultRow
from app.domains.workouts.part_results import derived_rows, results_ready


async def rebuild(db, *, apply=False):
    if not await results_ready(db):
        raise RuntimeError("Apply migration063 before rebuilding results")
    counts = dict(sessions=0, insert=0, existing=0)
    # Stream metadata/JSON in bounded batches; writer locks fence corrections.
    statement = select(WorkoutsSession).order_by(WorkoutsSession.app_user_id, WorkoutsSession.id).execution_options(yield_per=100)
    async for session in await db.stream_scalars(statement):
        await lock_owner(db, session.app_user_id)
        counts["sessions"] += 1
        superseded = bool(await db.scalar(select(WorkoutsSession.id).where(WorkoutsSession.supersedes_session_id == session.id)))
        for values in derived_rows(session):
            values["superseded"] = superseded
            existing = await db.scalar(select(PartResultRow).where(PartResultRow.session_id == session.id, PartResultRow.block_id == values["block_id"]))
            if existing:
                if any(getattr(existing, k) != v for k, v in values.items()):
                    raise RuntimeError("Derived result conflict; no changes committed")
                counts["existing"] += 1
            else:
                counts["insert"] += 1
                if apply:
                    db.add(PartResultRow(**values))
    return {"mode": "apply" if apply else "dry_run", **counts}


async def main(apply):
    async with AsyncSessionLocal.begin() as db:
        print(await rebuild(db, apply=apply))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    asyncio.run(main(parser.parse_args().apply))

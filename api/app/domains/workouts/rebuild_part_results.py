"""Rebuild from immutable JSONB only. Dry-run by default; conflicts stop the run."""

import argparse
import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.database import AsyncSessionLocal
from app.domains.workouts.lifecycle import lock_owner
from app.domains.workouts.models import WorkoutsSession
from app.domains.workouts.part_result_models import PartResultRow
from app.domains.workouts.part_results import (
    derived_rows,
    rebuild_marker_available,
    results_schema_ready,
)


async def rebuild(db, *, apply=False):
    await db.execute(text("SET LOCAL lock_timeout = '5s'"))
    await db.execute(text("SET LOCAL statement_timeout = '60s'"))
    if not await results_schema_ready(db) or not await rebuild_marker_available(db):
        raise RuntimeError("Apply or replay migration063 before rebuilding results")
    counts = dict(sessions=0, insert=0, existing=0)
    # Each owner is its own transaction, including dry runs. A conflict rolls
    # back that owner and stops; successfully completed owners remain committed.
    factory = async_sessionmaker(db.bind, expire_on_commit=False)
    if apply:
        async with factory.begin() as state:
            await state.execute(text("SET LOCAL lock_timeout = '5s'"))
            await state.execute(text("SET LOCAL statement_timeout = '60s'"))
            await state.execute(text("UPDATE workouts_schema_migrations SET part_results_rebuilt_at=NULL WHERE version=63"))
    cursor = ""
    while owners := list(await db.scalars(select(WorkoutsSession.app_user_id).distinct().where(
        WorkoutsSession.app_user_id > cursor).order_by(WorkoutsSession.app_user_id).limit(100))):
        for owner in owners:
            async with factory.begin() as owner_db:
                await owner_db.execute(text("SET LOCAL lock_timeout = '5s'"))
                await owner_db.execute(text("SET LOCAL statement_timeout = '60s'"))
                await lock_owner(owner_db, owner)
                statement = select(WorkoutsSession).where(WorkoutsSession.app_user_id == owner).order_by(
                    WorkoutsSession.id).execution_options(yield_per=100)
                async for session in await owner_db.stream_scalars(statement):
                    counts["sessions"] += 1
                    superseded = bool(await owner_db.scalar(select(WorkoutsSession.id).where(WorkoutsSession.supersedes_session_id == session.id)))
                    for values in derived_rows(session):
                        values["superseded"] = superseded
                        existing = await owner_db.scalar(select(PartResultRow).where(PartResultRow.session_id == session.id, PartResultRow.block_id == values["block_id"]))
                        if existing:
                            if any(getattr(existing, k) != v for k, v in values.items()):
                                raise RuntimeError("Derived result conflict; current owner rolled back; earlier owners may be committed")
                            counts["existing"] += 1
                        else:
                            counts["insert"] += 1
                            if apply:
                                owner_db.add(PartResultRow(**values))
            print({"owner": owner, "mode": "apply" if apply else "dry_run", **counts}, flush=True)
        cursor = owners[-1]
    if apply:
        async with factory.begin() as state:
            await state.execute(text("SET LOCAL lock_timeout = '5s'"))
            await state.execute(text("SET LOCAL statement_timeout = '60s'"))
            missing = await state.scalar(text("""SELECT EXISTS(SELECT 1 FROM workouts_sessions s
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.content->'results','[]'::jsonb)) score
                WHERE NOT EXISTS(SELECT 1 FROM workouts_part_results r
                    WHERE r.session_id=s.id AND r.block_id=score->>'block_id'))"""))
            if missing:
                raise RuntimeError("Historical results remain unindexed; reads stay fenced; rerun rebuild")
            await state.execute(text("UPDATE workouts_schema_migrations SET part_results_rebuilt_at=clock_timestamp() WHERE version=63"))
    return {"mode": "apply" if apply else "dry_run", **counts}


async def main(apply):
    async with AsyncSessionLocal() as db:
        print(await rebuild(db, apply=apply))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    asyncio.run(main(parser.parse_args().apply))

"""History projection, optional-schema rollout and transactional write-through."""

import hashlib
import json
from datetime import datetime
from uuid import uuid4, uuid5

from fastapi import HTTPException
from sqlalchemy import case, func, select, text, update

from app.domains.workouts.heart_rate_erasure import heart_rate_erasure_ready
from app.domains.workouts.models import WorkoutsSession
from app.domains.workouts.part_result_models import PartResultRow as R


def fingerprint(value):
    def clean(item):
        if isinstance(item, dict):
            return {k: clean(v) for k, v in item.items() if k not in {"instructions", "evidence"}}
        return [clean(v) for v in item] if isinstance(item, list) else item
    return hashlib.sha256(json.dumps(clean(value), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def derived_rows(session):
    snapshot = session.content.get("prescription_snapshot", {})
    benchmark = snapshot.get("benchmark") or {}
    blocks = {b["id"]: b for b in snapshot.get("blocks", [])}
    for score in session.content.get("results", []):
        block = blocks[score["block_id"]]
        is_benchmark = bool(benchmark) and (not benchmark.get("block_ids") or block["id"] in benchmark["block_ids"])
        label = block["label"]
        benchmark_label = label if len(label) <= 80 else fingerprint(label)
        key = (f'benchmark:{benchmark["key"]}:{benchmark.get("stage") or 0}:{benchmark_label}' if is_benchmark else
               f'workout:{session.source_workout_id}:{fingerprint(block)}' if session.source_workout_id else
               f'program:{session.source_program_id}:{fingerprint([session.content.get("program_session_id"), block])}')
        kind = score["kind"]
        # Radix exceeds the maximum reps. A cap must rank below EVERY finish,
        # including allowed scores above 100 rounds; unfinished buy-ins rank below zero.
        rounds_reps = (score.get("rounds") or 0) * 10001 + (score.get("reps") or 0)
        if kind == "rounds_reps":
            value = score["distance_meters"] - 1000001 if score.get("buy_in_done") is False else rounds_reps
        elif kind == "time":
            value = 1e12 - rounds_reps if score.get("capped") else score["time_seconds"]
        elif kind == "load":
            value = score["load"] * (0.45359237 if score["load_unit"] == "lb" else 1)
        else:
            value = score.get({"distance": "distance_meters"}.get(kind, kind), 1)
        yield dict(id=uuid5(session.id, block["id"]), app_user_id=session.app_user_id, generation=session.generation,
                   session_id=session.id, block_id=block["id"], block_label=label, comparison_key=key,
                   benchmark_key=benchmark["key"] if is_benchmark else None, source_workout_id=session.source_workout_id,
                   kind=kind, scaling=score.get("scaling"), sort_value=value, better="lower" if kind == "time" else "higher",
                   performed_at=datetime.fromisoformat(score.get("ended_at") or session.content["finished_at"]), superseded=False)


async def results_schema_ready(db):
    return bool(await db.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=63)")))


async def rebuild_marker_available(db):
    return bool(await db.scalar(text("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workouts_schema_migrations' AND column_name='part_results_rebuilt_at' AND udt_name='timestamptz' AND is_nullable='YES')")))


async def results_ready(db):
    return bool(await results_schema_ready(db) and await rebuild_marker_available(db) and
                await db.scalar(text("SELECT part_results_rebuilt_at IS NOT NULL FROM workouts_schema_migrations WHERE version=63")))


async def schema_complete(db):
    columns = {name: (kind, nullable) for name, kind, nullable in (await db.execute(text("SELECT column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='workouts_part_results'"))).all()}
    types = {**dict.fromkeys(("id", "session_id", "source_workout_id"), "uuid"),
             **dict.fromkeys(("app_user_id", "block_id", "block_label", "comparison_key", "benchmark_key", "kind", "scaling", "better"), "varchar"),
             "generation": "int4", "sort_value": "float8", "performed_at": "timestamptz", "created_at": "timestamptz", "superseded": "bool"}
    if any(columns.get(c.name) != (types[c.name], "YES" if c.nullable else "NO") for c in R.__table__.columns):
        return False
    foreign_keys = set((await db.execute(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.workouts_part_results'::regclass AND contype='f' AND convalidated"))).scalars())
    if not {"FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE", "FOREIGN KEY (session_id) REFERENCES workouts_sessions(id) ON DELETE CASCADE"} <= foreign_keys:
        return False
    constraints = await db.scalar(text("SELECT count(*) FROM pg_constraint WHERE conrelid='public.workouts_part_results'::regclass AND convalidated AND ((contype='f' AND confdeltype='c') OR conname IN ('uq_workouts_part_result','ck_workouts_part_result'))"))
    indexes = set((await db.execute(text("SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('workouts_part_results','workouts_sessions') AND x.indisvalid AND x.indisready"))).scalars())
    grant = await db.scalar(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.workouts_grants'::regclass AND conname='ck_workouts_grant_scope' AND convalidated"))
    return await heart_rate_erasure_ready(db) and constraints == 4 and {"ix_workouts_result_comparison", "ix_workouts_result_workout", "ix_workouts_session_source"} <= indexes and "health_workout_summary_store" in (grant or "")


async def verify_part_results_schema(engine, settings):
    if settings.workouts_api_enabled:
        async with engine.connect() as db:
            if await results_schema_ready(db) and not await schema_complete(db):
                raise RuntimeError("Workouts results migration063 is incomplete")


def owner_filter(owner, generation):
    return (R.app_user_id == owner, R.generation == generation, R.superseded.is_(False))


async def write_part_results(db, session):
    if not await results_schema_ready(db):
        return []
    if session.id is None:
        session.id = uuid4()
    pending = []
    history_ready = await results_ready(db)
    with db.no_autoflush:
        if session.supersedes_session_id:
            await db.execute(update(R).where(R.session_id == session.supersedes_session_id, R.app_user_id == session.app_user_id, R.generation == session.generation).values(superseded=True))
        summaries = []
        for values in derived_rows(session):
            pending.append(R(**values))
            if not history_ready:
                continue
            previous = select(R).where(*owner_filter(session.app_user_id, session.generation),
                R.comparison_key == values["comparison_key"], R.kind == values["kind"], R.scaling == values["scaling"])
            order = R.sort_value.asc() if values["better"] == "lower" else R.sort_value.desc()
            best = await db.scalar(previous.order_by(order, R.performed_at.desc()).limit(1))
            last = await db.scalar(previous.order_by(R.performed_at.desc(), R.id.desc()).limit(1))
            summaries.append(dict(block_id=values["block_id"], is_best=best is None or
                (values["sort_value"] < best.sort_value if values["better"] == "lower" else values["sort_value"] > best.sort_value),
                previous_best=best.sort_value if best else None, last=last.sort_value if last else None))
        if summaries:
            from app.domains.workouts.router import bounded_content

            session.content = bounded_content({**session.content, "results_summary": summaries})
        await db.flush([session])
        db.add_all(pending)
        return summaries

async def query_results(db, owner, generation, *, workout_id=None, benchmark_key=None, comparison_key=None, scaling=None, limit=20, offset=0):
    if await results_ready(db):
        statement = select(R, WorkoutsSession.content).join(WorkoutsSession, R.session_id == WorkoutsSession.id).where(*owner_filter(owner, generation))
        for column, value in ((R.source_workout_id, workout_id), (R.benchmark_key, benchmark_key), (R.comparison_key, comparison_key), (R.scaling, scaling)):
            if value is not None:
                statement = statement.where(column == value)
        rows = (await db.execute(statement.order_by(R.performed_at.desc(), R.id.desc()).limit(limit).offset(offset))).all()
        items = [{c.name: getattr(row, c.name) for c in R.__table__.columns} | {"result": next(r for r in content["results"] if r["block_id"] == row.block_id)} for row, content in rows]
        return {"items": items, "history_limited": False}
    correction = WorkoutsSession.__table__.alias("correction")
    statement = select(WorkoutsSession).where(WorkoutsSession.app_user_id == owner, WorkoutsSession.generation == generation,
        ~select(correction.c.id).where(correction.c.supersedes_session_id == WorkoutsSession.id).exists())
    if workout_id is not None:
        statement = statement.where(WorkoutsSession.source_workout_id == workout_id)
    sessions = (await db.scalars(statement.order_by(WorkoutsSession.created_at.desc(), WorkoutsSession.id.desc()).limit(200))).all()
    items = [row | {"result": score} for s in sessions for row, score in zip(derived_rows(s), s.content.get("results", []))
             if (benchmark_key is None or row["benchmark_key"] == benchmark_key) and (comparison_key is None or row["comparison_key"] == comparison_key) and (scaling is None or row["scaling"] == scaling)]
    items.sort(key=lambda r: (r["performed_at"], str(r["id"])), reverse=True)
    return {"items": items[offset:offset + limit], "history_limited": True}


async def benchmark_results(db, owner, generation):
    if not await results_ready(db):
        raise HTTPException(503, "Results history is being set up.")
    # SQL ranks each part, stage, score kind and explicit scaling separately.
    group = [R.comparison_key, R.kind, R.scaling]
    ranked = select(R.id, func.row_number().over(partition_by=group, order_by=(R.performed_at.desc(), R.id.desc())).label("last"),
        func.row_number().over(partition_by=group, order_by=(case((R.better == "lower", -R.sort_value), else_=R.sort_value).desc(), R.performed_at.desc())).label("best"))
    ranked = ranked.where(*owner_filter(owner, generation), R.benchmark_key.is_not(None)).subquery()
    rows = (await db.execute(select(R, ranked.c.last, ranked.c.best).join(ranked, ranked.c.id == R.id).where((ranked.c.last == 1) | (ranked.c.best == 1)))).all()
    groups = {}
    for row, last, best in rows:
        key = (row.comparison_key, row.kind, row.scaling)
        item = groups.setdefault(key, dict(benchmark_key=row.benchmark_key, stage=int(row.comparison_key.split(":")[2]) or None,
            block_label=row.block_label, comparison_key=row.comparison_key, kind=row.kind, scaling=row.scaling))
        for field, rank in (("last", last), ("best", best)):
            if rank == 1:
                item[field] = {c.name: getattr(row, c.name) for c in R.__table__.columns}
    return sorted(groups.values(), key=lambda r: (r["comparison_key"], r["kind"], r["scaling"] or ""))

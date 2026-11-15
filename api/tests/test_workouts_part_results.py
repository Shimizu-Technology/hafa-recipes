"""Optional result history: real PostgreSQL rollout, privacy and rebuild."""

import base64
import importlib
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text

from app.domains.workouts.models import WorkoutsSession
from app.domains.workouts.part_result_models import PartResultRow
from app.domains.workouts.part_results import (
    derived_rows,
    fingerprint,
    verify_part_results_schema,
    write_part_results,
)
from app.domains.workouts.rebuild_part_results import rebuild
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    GENERATION,
    data_api,
    enroll,
    settings,
)

migration = importlib.import_module("migrations.063_add_workouts_part_results")


def session(**score):
    return SimpleNamespace(id=uuid4(), app_user_id="owner", generation=1, source_workout_id=uuid4(), source_program_id=None,
        content={"finished_at": "2026-11-17T01:00:00Z", "prescription_snapshot": {
            "blocks": [{"id": "a", "label": "A", "exercises": [{"name": "Run", "distance_meters": 400}]}],
            "benchmark": {"key": "everest", "stage": 2, "block_ids": ["a"]}},
            "results": [{"block_id": "a", "kind": "rounds_reps", "rounds": 3, "reps": 12, "scaling": "rx", **score}]})


def test_comparison_preserves_prescription_and_excludes_coach_notes():
    source = session()
    first = next(derived_rows(source))
    assert first["comparison_key"] == "benchmark:everest:2:A"
    block = source.content["prescription_snapshot"]["blocks"][0]
    original = fingerprint(block)
    block["instructions"] = ["Correct a coach note"]
    block["exercises"][0]["evidence"] = [{"wording": "source"}]
    assert fingerprint(block) == original
    block["exercises"][0]["distance_meters"] = 500
    assert fingerprint(block) != original
    source.content["prescription_snapshot"]["benchmark"]["block_ids"] = ["b"]
    assert next(derived_rows(source))["benchmark_key"] is None


def test_rank_extremes_finish_above_cap_and_buy_in_progress_increases():
    finished = next(derived_rows(session(kind="time", time_seconds=86400)))["sort_value"]
    capped = next(derived_rows(session(kind="time", capped=True, rounds=1000, reps=10000)))["sort_value"]
    assert finished < capped
    def progress(distance):
        return next(derived_rows(session(buy_in_done=False, distance_meters=distance, rounds=0, reps=0)))["sort_value"]
    assert progress(0) < progress(600) < progress(1000) < 0


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_optional_rollout_rebuild_results_and_erasure(data_api, monkeypatch):  # noqa: F811
    api = data_api
    await enroll(api)
    assert (await api.client.get("/api/v1/workouts/results")).json() == {"items": [], "history_limited": True}
    assert (await api.client.get("/api/v1/workouts/benchmarks")).status_code == 503
    # W2 writes this immutable JSONB; W3 can be tested independently of its input DTO.
    source = session()
    async with api.sessions.begin() as db:
        original = WorkoutsSession(id=source.id, app_user_id="owner", generation=1, client_session_id=uuid4(), request_hash="a" * 64,
            source_workout_id=source.source_workout_id, content=source.content)
        db.add(original)
    fallback = (await api.client.get("/api/v1/workouts/results")).json()
    assert len(fallback["items"]) == 1 and fallback["history_limited"]
    for name in importlib.import_module("migrations.run").OPTIONAL_MIGRATIONS[1:-1]:
        await importlib.import_module(name).run_migration(configured=settings(), migration_engine=api.engine)
    monkeypatch.delenv("MIGRATION_063_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(configured=settings().model_copy(update={"environment": "production"}), migration_engine=api.engine)
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await verify_part_results_schema(api.engine, settings())
    async with api.sessions.begin() as db:
        dry = await rebuild(db)
        assert dry == {"mode": "dry_run", "sessions": 1, "insert": 1, "existing": 0}
        assert await db.scalar(select(func.count()).select_from(PartResultRow)) == 0
        assert (await rebuild(db, apply=True))["insert"] == 1
    async with api.sessions.begin() as db:
        assert (await rebuild(db, apply=True))["existing"] == 1
        corrected = WorkoutsSession(app_user_id="owner", generation=1, client_session_id=uuid4(), request_hash="b" * 64,
            source_workout_id=source.source_workout_id, supersedes_session_id=source.id,
            content=deepcopy(source.content))
        corrected.content["results"][0]["rounds"] = 4
        db.add(corrected)
        summary = await write_part_results(db, corrected)
        assert summary[0]["is_best"]
    rows = (await api.client.get("/api/v1/workouts/results", params={"scaling": "rx"})).json()
    assert not rows["history_limited"] and len(rows["items"]) == 1
    assert rows["items"][0]["result"]["rounds"] == 4
    await enroll(api, other=True)
    assert (await api.client.get("/api/v1/workouts/results", headers={"X-Test-User": "other"})).json()["items"] == []
    benchmarks = (await api.client.get("/api/v1/workouts/benchmarks")).json()
    assert len(benchmarks) == 1 and benchmarks[0]["stage"] == 2
    assert benchmarks[0]["best"]["session_id"] == rows["items"][0]["session_id"]
    exported = (await api.client.get("/api/v1/workouts/export")).json()
    assert exported["totals"]["part_results"] == 2
    assert len(exported["datasets"]["part_results"]) == 2
    from app.domains.workouts import export_response_gate, export_router
    from app.domains.workouts.export_service import PrivateExportService
    from tests.test_workouts_export_assembly import manifest, page

    monkeypatch.setenv("WORKOUTS_SHARE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"R" * 32).decode())
    configured = settings()
    monkeypatch.setattr(export_router, "private_exports", PrivateExportService(api.sessions, settings=configured))
    monkeypatch.setattr(export_response_gate, "get_settings", lambda: configured)
    monkeypatch.setattr(export_response_gate.ExportReadRoute, "session_factory", api.sessions)
    api.app.include_router(export_router.router)
    api.app.include_router(export_router.read_router)
    snapshot = await manifest(api)
    assert (await page(api, snapshot["id"])).json()["export"]["totals"]["part_results"] == 2
    async with api.sessions.begin() as db:
        first = await db.scalar(select(PartResultRow).where(PartResultRow.session_id == source.id))
        assert first.superseded
        first.sort_value = -123
    async with api.sessions.begin() as db:
        with pytest.raises(RuntimeError, match="conflict"):
            await rebuild(db, apply=True)
    async with api.engine.begin() as db:
        await db.execute(text("ALTER TABLE workouts_part_results ALTER COLUMN sort_value TYPE numeric"))
    with pytest.raises(RuntimeError, match="incomplete"):
        await verify_part_results_schema(api.engine, settings())
    erased = await api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert erased.status_code == 200, erased.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(PartResultRow)) == 0

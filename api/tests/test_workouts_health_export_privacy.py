"""Private erasure writers invalidate mounted export snapshots."""

# ruff: noqa: F811 -- imported pytest fixtures register intentional parameter names

import importlib
from datetime import timedelta
from uuid import uuid4

import pytest

from app.domains.workouts import health_router
from tests.test_workouts_coach_integration import action, coach_api, create_workout  # noqa: F401
from tests.test_workouts_data_integration import GENERATION, data_api, settings  # noqa: F401
from tests.test_workouts_export_assembly import assembled_exports, manifest, page  # noqa: F401
from tests.test_workouts_health_integration import observation


@pytest.mark.parametrize("operation", ["delete", "correct", "reconcile"])
async def test_upstream_health_change_invalidates_existing_export(
    assembled_exports, monkeypatch, operation
):
    api = assembled_exports
    provider = "health_connect" if operation == "reconcile" else "apple_health"
    await importlib.import_module("migrations.036_add_workouts_health").run_migration(
        configured=settings(workouts_health_sync_enabled=True), migration_engine=api.engine
    )
    monkeypatch.setattr(
        health_router, "get_settings", lambda: settings(workouts_health_sync_enabled=True)
    )
    api.app.include_router(health_router.router)
    connected = await api.client.put(
        f"/api/v1/workouts/health/{provider}/connection",
        headers=GENERATION,
        json={
            "expected_revision": 0,
            "connected": True,
            "read_on_device": True,
            "upload_to_server": True,
            "use_for_ai": False,
            "write_actuals": False,
        },
    )
    assert connected.status_code == 200, connected.text
    row = observation(
        provider, source="review-private-observation", updated_at="2026-10-01T11:00:00+10:00"
    )
    synced = await api.client.post(
        f"/api/v1/workouts/health/{provider}/sync",
        headers=GENERATION,
        json={"receipt_id": str(uuid4()), "expected_revision": 1, "observations": [row]},
    )
    assert synced.status_code == 200, synced.text
    captured = await manifest(api)
    before = await page(api, captured["id"])
    assert before.status_code == 200, before.text
    assert len(before.json()["export"]["datasets"]["health_observations"]) == 1
    empty_receipt = str(uuid4())
    removed = await api.client.post(
        f"/api/v1/workouts/health/{provider}/sync",
        headers=GENERATION,
        json={
            "receipt_id": empty_receipt,
            "expected_revision": 1,
            "observations": [
                {**row, "duration_seconds": 500, "updated_at": "2026-10-01T12:00:00+10:00"}
            ]
            if operation == "correct"
            else [],
            "deleted_source_ids": [row["source_id"]] if operation == "delete" else [],
            **(
                {
                    "next_cursor": {
                        "provider": provider,
                        "window_start": "2026-10-01T00:00:00+10:00",
                        "window_end": "2026-10-02T00:00:00+10:00",
                        "phase": "changes",
                    }
                }
                if operation == "reconcile"
                else {}
            ),
        },
    )
    assert removed.status_code == 200, removed.text
    if operation == "reconcile":
        removed = await api.client.post(
            f"/api/v1/workouts/health/{provider}/reconcile",
            headers=GENERATION,
            json={
                "expected_revision": 1,
                "window_start": "2026-10-01T00:00:00+10:00",
                "window_end": "2026-10-02T00:00:00+10:00",
                "receipt_ids": [empty_receipt],
            },
        )
        assert removed.status_code == 200 and removed.json()["deleted"] == 1, removed.text
    else:
        assert removed.json()["deleted" if operation == "delete" else "accepted"] == 1
    live = await api.client.get(f"/api/v1/workouts/health/{provider}/observations")
    assert live.status_code == 200, live.text
    assert (
        live.json()[0]["duration_seconds"] == 500 if operation == "correct" else live.json() == []
    )
    after = await page(api, captured["id"])
    assert after.status_code in {404, 409, 410}, (
        f"Snapshot still readable after upstream {operation}: status={after.status_code}, "
        f"retained_health_rows={len(after.json()['export']['datasets']['health_observations'])}"
    )


async def test_undo_deleted_coach_copy_invalidates_existing_export(coach_api, assembled_exports):
    api = coach_api
    original = await create_workout(api)
    api.provider.action = (
        "adapt_saved_workout",
        {"workout_id": original["id"], "expected_revision": 1, "minutes": None},
    )
    accepted, proposal_id = await action(api)
    assert accepted.status_code == 200, accepted.text
    adapted_id = accepted.json()["record_id"]
    captured = await manifest(api)
    before = await page(api, captured["id"])
    assert before.status_code == 200, before.text
    assert adapted_id in {item["id"] for item in before.json()["export"]["datasets"]["workouts"]}
    undone, _ = await action(api, "undo", proposal_id)
    assert undone.status_code == 200, undone.text
    assert (await api.client.get(f"/api/v1/workouts/library/{adapted_id}")).status_code == 404
    after = await page(api, captured["id"])
    assert after.status_code in {404, 409, 410}, (
        f"Snapshot still readable after undo removed adapted copy: status={after.status_code}, "
        f"retained_copy={adapted_id in {item['id'] for item in after.json()['export']['datasets']['workouts']}}"
    )


async def test_collection_removal_invalidates_existing_export(assembled_exports):
    from app.domains.workouts.library_organization_router import router

    api = assembled_exports
    api.app.include_router(router)
    created = await api.client.post(
        "/api/v1/workouts/collections",
        headers=GENERATION,
        json={"title": "Private recovery collection"},
    )
    assert created.status_code == 201, created.text
    captured = await manifest(api)
    removed = await api.client.delete(
        f"/api/v1/workouts/collections/{created.json()['id']}?expected_revision=1",
        headers=GENERATION,
    )
    assert removed.status_code == 204, removed.text
    assert (await api.client.get("/api/v1/workouts/collections", headers=GENERATION)).json() == []
    after = await page(api, captured["id"])
    assert after.status_code in {404, 409, 410}, (
        f"Snapshot readable after collection hard deletion: status={after.status_code}, "
        f"retained_collections={len(after.json()['export']['datasets']['library_collections'])}"
    )


async def test_import_expiry_sweep_invalidates_existing_export(assembled_exports, monkeypatch):
    from sqlalchemy import select

    from app.domains.workouts import imports
    from app.domains.workouts.automation_models import WorkoutImport
    from app.domains.workouts.lifecycle import now
    from tests.test_workouts_data_integration import WORKOUT

    api = assembled_exports
    captured_time = now()
    async with api.sessions.begin() as db:
        row = WorkoutImport(
            id=uuid4(),
            app_user_id="owner",
            generation=1,
            request_id=uuid4(),
            request_hash="a" * 64,
            ai_accepted_at=captured_time,
            payload=None,
            status="ready",
            result={"status": "ready", "workout": WORKOUT},
            expires_at=captured_time + timedelta(minutes=1),
        )
        db.add(row)
    captured = await manifest(api)
    monkeypatch.setattr(imports, "now", lambda: captured_time + timedelta(minutes=2))
    await imports.WorkoutImportWorker(api.sessions).purge_expired()
    async with api.sessions() as db:
        assert await db.scalar(select(WorkoutImport.id)) is None
    after = await page(api, captured["id"])
    assert after.status_code in {404, 409, 410}, (
        f"Snapshot readable after import expiry deletion: status={after.status_code}, "
        f"retained_imports={len(after.json()['export']['datasets']['imports'])}"
    )

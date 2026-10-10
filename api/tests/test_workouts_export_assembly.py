"""Real mounted private exports and parent privacy hooks on the full optional chain."""

import base64
import importlib
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select

from app.domains.workouts import export_response_gate, export_router
from app.domains.workouts.export_models import WorkoutsExportPage, WorkoutsExportSnapshot
from app.domains.workouts.export_service import PrivateExportService
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.measurement_service import reset_measurement_context
from tests.test_workouts_data_integration import (
    GENERATION,
    WORKOUT,
    data_api,  # noqa: F401
    enroll,
    settings,
)


@pytest.fixture
async def assembled_exports(data_api, monkeypatch):  # noqa: F811
    api = data_api
    configured = settings()
    for name in [
        "035_add_workouts_automation",
        "036_add_workouts_health",
        "037_add_workouts_connections_sharing",
        "038_add_workouts_library_organization",
        "039_add_workouts_measurements",
        "040_add_workouts_ai_admission",
        "041_add_workouts_recipe_grant_epochs",
        "042_add_workouts_import_usage",
        "043_add_workouts_export_snapshots",
        "044_add_workouts_activity_log",
    ]:
        await importlib.import_module("migrations." + name).run_migration(
            configured=configured, migration_engine=api.engine
        )
    monkeypatch.setenv(
        "WORKOUTS_SHARE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"R" * 32).decode()
    )
    monkeypatch.setattr(
        export_router, "private_exports", PrivateExportService(api.sessions, settings=configured)
    )
    monkeypatch.setattr(export_response_gate, "get_settings", lambda: configured)
    monkeypatch.setattr(export_response_gate.ExportReadRoute, "session_factory", api.sessions)
    api.app.include_router(export_router.router)
    api.app.include_router(export_router.read_router)
    await enroll(api)
    yield api


async def manifest(api):
    response = await api.client.post("/api/v1/workouts/export/snapshots", headers=GENERATION)
    assert response.status_code == 201, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


async def page(api, identifier):
    return await api.client.get(
        f"/api/v1/workouts/export/snapshots/{identifier}/pages/0", headers=GENERATION
    )


async def test_actual_mount_and_legacy_export_preserve_projection_and_privacy(assembled_exports):
    api = assembled_exports
    saved = await api.client.post("/api/v1/workouts/library", headers=GENERATION, json=WORKOUT)
    assert saved.status_code == 201
    captured = await manifest(api)
    result = await page(api, captured["id"])
    assert result.status_code == 200, result.text
    assert result.json()["snapshot_id"] == captured["id"]
    assert result.json()["export"]["datasets"]["workouts"][0]["id"] == saved.json()["id"]
    legacy = await api.client.get("/api/v1/workouts/export")
    assert legacy.status_code == 200 and legacy.headers["Cache-Control"] == "no-store"
    missing = await api.client.get(f"/api/v1/workouts/export/snapshots/{captured['id']}/pages/0")
    assert missing.status_code == 422
    foreign = await api.client.get(
        f"/api/v1/workouts/export/snapshots/{captured['id']}/pages/0",
        headers=GENERATION | {"X-Test-User": "other"},
    )
    assert foreign.status_code in {404, 409}


@pytest.mark.parametrize(
    "operation", ["revoke", "measure_context", "product_erase", "library_remove"]
)
async def test_parent_privacy_writes_invalidate_actual_mounted_snapshot(
    assembled_exports, operation
):
    api = assembled_exports
    from app.domains.workouts.automation_router import router as automation_router

    api.app.include_router(automation_router)
    saved = (
        await api.client.post("/api/v1/workouts/library", headers=GENERATION, json=WORKOUT)
    ).json()
    captured = await manifest(api)
    if operation == "revoke":
        response = await api.client.put(
            "/api/v1/workouts/ai-consent",
            headers=GENERATION,
            json={"accepted": False, "disclosure_version": 1},
        )
        assert response.status_code == 200
    elif operation == "product_erase":
        response = await api.client.delete("/api/v1/workouts/data", headers=GENERATION)
        assert response.status_code == 200
    elif operation == "library_remove":
        response = await api.client.delete(
            f"/api/v1/workouts/library/{saved['id']}", headers=GENERATION
        )
        assert response.status_code == 204
    else:
        async with api.sessions.begin() as db:
            await membership_for(db, "owner", generation=1, write=True)
            await reset_measurement_context(db, "owner", 1)
    result = await page(api, captured["id"])
    assert result.status_code in {404, 409, 410}, result.text
    async with api.sessions() as db:
        assert await db.get(WorkoutsExportSnapshot, UUID(captured["id"])) is None
        assert not (
            await db.scalars(
                select(WorkoutsExportPage).where(
                    WorkoutsExportPage.snapshot_id == UUID(captured["id"])
                )
            )
        ).all()


async def test_snapshot_and_legacy_export_never_select_retained_large_capture(assembled_exports):
    """A tiny export result must not decode its unrelated near-limit capture."""
    from app.domains.workouts.automation_models import WorkoutImport

    api = assembled_exports
    captured_time = now()
    capture = "A" * (3 * 1024 * 1024 - 1024)
    async with api.sessions.begin() as db:
        db.add(
            WorkoutImport(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                request_id=uuid4(),
                request_hash="a" * 64,
                ai_accepted_at=captured_time,
                payload={"kind": "image", "image_base64": capture},
                status="ready",
                result={"status": "ready", "workout": WORKOUT},
                expires_at=captured_time + timedelta(minutes=10),
            )
        )
    statements = []

    def inspect_query(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and "workouts_import_jobs" in statement:
            statements.append(statement)
            assert "workouts_import_jobs.payload" not in statement
            assert "workouts_import_jobs.request_hash" not in statement

    event.listen(api.engine.sync_engine, "before_cursor_execute", inspect_query)
    try:
        captured = await manifest(api)
        downloaded = await page(api, captured["id"])
        legacy = await api.client.get("/api/v1/workouts/export")
        assert downloaded.status_code == legacy.status_code == 200
        new_items = downloaded.json()["export"]["datasets"]["imports"]
        old_items = legacy.json()["datasets"]["imports"]
        assert new_items == old_items and len(new_items) == 1
        assert new_items[0]["result"] == {"status": "ready", "workout": WORKOUT}
        assert "payload" not in new_items[0] and "request_hash" not in new_items[0]
        assert statements and len(downloaded.content) < 100_000
    finally:
        event.remove(api.engine.sync_engine, "before_cursor_execute", inspect_query)

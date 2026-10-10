"""Real PostgreSQL quick-activity journeys; no AI or device mutations."""

# ruff: noqa: F811 -- reusable disposable database fixture
import asyncio
import importlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select, text

from app.domains.workouts import (
    activity_log_router,
    automation_router,
)
from app.domains.workouts import (
    activity_log_service as service,
)
from app.domains.workouts.activity_log_models import (
    WorkoutsActivityLog,
    WorkoutsActivityLogOperation,
)
from app.domains.workouts.models import WorkoutsActivity, WorkoutsProfile, WorkoutsSession
from app.models.identity import AppUser
from tests.test_workouts_automation_integration import propose, ready_profile
from tests.test_workouts_data_integration import (
    GENERATION,
    data_api,  # noqa: F401 -- fixture registration
    enroll,
    session_payload,
    settings,
    workout,
)  # noqa: F401

migration = importlib.import_module("migrations.044_add_workouts_activity_log")


@pytest.fixture
async def activity_api(data_api):
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=settings(), migration_engine=data_api.engine
    )
    await migration.run_migration(configured=settings(), migration_engine=data_api.engine)
    data_api.app.include_router(activity_log_router.router)
    data_api.app.include_router(automation_router.router)
    await enroll(data_api)
    return data_api


def body(**changes):
    return {
        "request_id": str(uuid4()),
        "kind": "basketball",
        "date": service.now().astimezone(ZoneInfo("Pacific/Guam")).date().isoformat(),
        "duration_minutes": 45,
        "strenuous": None,
        **changes,
    }


async def post(api, payload=None, headers=GENERATION):
    return await api.client.post(
        "/api/v1/workouts/activity-log", headers=headers, json=payload or body()
    )


async def create(api, payload=None):
    response = await post(api, payload)
    assert response.status_code == 201, response.text
    return response.json()


async def correct(api, entry, **changes):
    return await api.client.put(
        "/api/v1/workouts/activity-log/" + entry["id"],
        headers=GENERATION,
        json=body(expected_revision=entry["revision"], **changes),
    )


async def remove(api, entry, **changes):
    return await api.client.request(
        "DELETE",
        "/api/v1/workouts/activity-log/" + entry["id"],
        headers=GENERATION,
        json={"request_id": str(uuid4()), "expected_revision": entry["revision"], **changes},
    )


async def test_no_library_or_ai_required_stable_creation_replay(activity_api):
    payload = body()
    first = await post(activity_api, payload)
    second = await post(activity_api, payload)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    row = first.json()
    assert row["content"]["name"] == "Basketball" and row["content"]["strenuous"] is None
    assert row["completed_confirmed"] and row["profile_revision"] == 0
    assert first.headers["Cache-Control"] == "no-store"
    async with activity_api.sessions() as db:
        projection = await db.get(WorkoutsActivity, UUID(row["id"]))
        assert set(projection.content) == {
            "date",
            "name",
            "strenuous",
            "duration_minutes",
            "origin_id",
        }
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivity)) == 1


@pytest.mark.parametrize("kind", ["run", "walk", "basketball", "other"])
async def test_kinds_save_reload_explicit_optional_fields(activity_api, kind):
    payload = body(kind=kind, name="  Evening activity  ", notes="  My note  ", strenuous=False)
    if kind in {"run", "walk"}:
        payload["distance_km"] = 3.5
    entry = await create(activity_api, payload)
    response = await activity_api.client.get(
        "/api/v1/workouts/activity-log/" + entry["id"], headers=GENERATION
    )
    assert response.status_code == 200
    assert response.json()["content"]["kind"] == kind
    assert response.json()["content"]["name"] == "Evening activity"
    assert response.json()["content"]["notes"] == "My note"
    assert response.json()["content"]["strenuous"] is False


async def test_creation_identity_conflict_correction_revision_and_replay(activity_api):
    payload = body()
    entry = await create(activity_api, payload)
    assert (await post(activity_api, {**payload, "duration_minutes": 30})).status_code == 409
    assert (await correct(activity_api, entry, request_id=payload["request_id"])).status_code == 409
    identifier = str(uuid4())
    first = await correct(activity_api, entry, request_id=identifier, duration_minutes=30)
    second = await correct(activity_api, entry, request_id=identifier, duration_minutes=30)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() and first.json()["revision"] == 2
    assert first.json()["created_at"] == entry["created_at"]
    assert (await correct(activity_api, entry)).status_code == 409
    assert (await post(activity_api, payload)).status_code == 409
    async with activity_api.sessions() as db:
        assert (await db.get(WorkoutsActivity, UUID(entry["id"]))).content["duration_minutes"] == 30


async def test_remove_scrubs_content_prevents_aba_and_replays_delete(activity_api):
    payload = body(notes="Private manual note")
    entry = await create(activity_api, payload)
    corrected = (await correct(activity_api, entry)).json()
    identifier = str(uuid4())
    deleted = await remove(activity_api, corrected, request_id=identifier)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["status"] == "removed" and deleted.json()["content"] is None
    assert (await remove(activity_api, corrected, request_id=identifier)).json() == deleted.json()
    assert (await correct(activity_api, entry)).status_code == 410
    assert (await post(activity_api, payload)).status_code == 410
    assert (
        await activity_api.client.get("/api/v1/workouts/activity-log", headers=GENERATION)
    ).json()["items"] == []
    async with activity_api.sessions() as db:
        assert await db.get(WorkoutsActivity, UUID(entry["id"])) is None
        tombstone = await db.get(WorkoutsActivityLog, UUID(entry["id"]))
        assert tombstone.content is None and tombstone.activity_id is None
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivityLogOperation)) == 3


async def test_other_owner_cannot_read_correct_or_remove(activity_api):
    entry = await create(activity_api)
    await enroll(activity_api, other=True)
    headers = GENERATION | {"X-Test-User": "other"}
    path = "/api/v1/workouts/activity-log/" + entry["id"]
    assert (await activity_api.client.get(path, headers=headers)).status_code == 404
    assert (
        await activity_api.client.put(path, headers=headers, json=body(expected_revision=1))
    ).status_code == 404
    assert (
        await activity_api.client.request(
            "DELETE",
            path,
            headers=headers,
            json={"request_id": str(uuid4()), "expected_revision": 1},
        )
    ).status_code == 404


@pytest.mark.parametrize("origin", ["health:upstream", "strava:upstream", ""])
async def test_imported_origins_are_read_only(activity_api, origin):
    identifier = uuid4()
    content = {
        "date": body()["date"],
        "name": "Imported",
        "duration_minutes": 30,
        "strenuous": None,
        "origin_id": origin,
    }
    async with activity_api.sessions() as db:
        db.add(WorkoutsActivity(id=identifier, app_user_id="owner", generation=1, content=content))
        await db.commit()
    row = (
        await activity_api.client.get(
            "/api/v1/workouts/activity-log/" + str(identifier), headers=GENERATION
        )
    ).json()
    assert row["read_only"] and row["source"] == "external"
    assert (await correct(activity_api, row)).status_code == 403
    assert (await remove(activity_api, row)).status_code == 403
    async with activity_api.sessions() as db:
        assert (await db.get(WorkoutsActivity, identifier)).content == content


async def test_legacy_manual_review_adoption_and_future_exclusion(activity_api):
    response = await activity_api.client.post(
        "/api/v1/workouts/activities",
        headers=GENERATION,
        json={
            "date": body()["date"],
            "name": "User game",
            "duration_minutes": None,
            "strenuous": True,
        },
    )
    entry = (
        await activity_api.client.get(
            "/api/v1/workouts/activity-log/" + response.json()["id"], headers=GENERATION
        )
    ).json()
    assert entry["legacy"] and entry["completed_confirmed"] is None and entry["revision"] == 1
    corrected = await correct(activity_api, entry, name="Basketball")
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["completed_confirmed"] and not corrected.json()["legacy"]
    assert corrected.json()["created_at"] == response.json()["created_at"]
    future = (datetime.fromisoformat(body()["date"]).date() + timedelta(days=1)).isoformat()
    await activity_api.client.post(
        "/api/v1/workouts/activities",
        headers=GENERATION,
        json={"date": future, "name": "Upcoming game"},
    )
    page = (
        await activity_api.client.get("/api/v1/workouts/activity-log", headers=GENERATION)
    ).json()
    assert len(page["items"]) == 1


async def test_timezone_and_completed_history_bounds(activity_api, monkeypatch):
    await ready_profile(activity_api)
    monkeypatch.setattr(service, "now", lambda: datetime(2026, 10, 10, 18, tzinfo=UTC))
    assert (await post(activity_api, body(date="2026-10-11"))).status_code == 201  # Guam local date
    assert (await post(activity_api, body(date="2026-10-12"))).status_code == 422
    async with activity_api.sessions() as db:
        profile = await db.get(WorkoutsProfile, "owner")
        profile.content = {**profile.content, "timezone": "America/Los_Angeles"}
        await db.commit()
    assert (await post(activity_api, body(date="2026-10-11"))).status_code == 422
    page = (
        await activity_api.client.get("/api/v1/workouts/activity-log", headers=GENERATION)
    ).json()
    assert page["today"] == "2026-10-10" and page["timezone"] == "America/Los_Angeles"
    assert (
        await activity_api.client.get(
            "/api/v1/workouts/activity-log?from_date=1900-01-01", headers=GENERATION
        )
    ).status_code == 422
    assert (
        await activity_api.client.get(
            "/api/v1/workouts/activity-log?from_date=2026-10-10&to_date=2026-10-09",
            headers=GENERATION,
        )
    ).status_code == 422


@pytest.mark.parametrize(
    "invalid",
    [
        {"duration_minutes": 0},
        {"duration_minutes": 1441},
        {"duration_minutes": True},
        {"duration_minutes": 3.5},
        {"strenuous": "false"},
        {"strenuous": 1},
        {"distance_km": -1},
        {"distance_km": 5},
        {"origin_id": "health:spoof"},
        {"date": 0},
        {"date": "2026-10-10T10:00:00Z"},
        {"notes": "x" * 2001},
        {"unknown": "injected"},
    ],
)
async def test_strict_invalid_inputs_create_no_rows(activity_api, invalid):
    assert (await post(activity_api, body(**invalid))).status_code == 422
    async with activity_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivity)) == 0


async def test_parallel_creation_and_conflicting_correction(activity_api):
    payload = body()
    results = await asyncio.gather(post(activity_api, payload), post(activity_api, payload))
    assert [r.status_code for r in results] == [201, 201]
    assert results[0].json() == results[1].json()
    entry = results[0].json()
    changes = await asyncio.gather(
        correct(activity_api, entry, duration_minutes=10),
        correct(activity_api, entry, duration_minutes=20),
    )
    assert sorted(r.status_code for r in changes) == [200, 409]


async def test_manual_activity_fences_coach_training_context(activity_api):
    await ready_profile(activity_api)
    proposal = await propose(activity_api)
    async with activity_api.sessions() as db:
        before = await automation_router.proposal_context_hash(db, "owner", 1)
    entry = await create(activity_api, body(strenuous=True))
    assert entry["profile_revision"] == 2
    async with activity_api.sessions() as db:
        after = await automation_router.proposal_context_hash(db, "owner", 1)
        assert before != after
        profile, revision = await automation_router.effective_profile(db, "owner", 1, 2)
        assert revision == 2 and any(
            item.name == "Basketball" and item.strenuous for item in profile.other_activities
        )
    accepted = await activity_api.client.post(
        "/api/v1/workouts/program-proposals/" + proposal["id"] + "/accept",
        headers=GENERATION,
        json={"title": "Activity-aware plan"},
    )
    assert accepted.status_code == 409
    updated = await correct(activity_api, entry, strenuous=False)
    assert updated.status_code == 200 and updated.json()["profile_revision"] == 3
    async with activity_api.sessions() as db:
        assert await automation_router.proposal_context_hash(db, "owner", 1) != after


async def test_completed_sessions_and_snapshots_untouched(activity_api):
    row = await workout(activity_api)
    response = await activity_api.client.post(
        "/api/v1/workouts/sessions", headers=GENERATION, json=session_payload(row)
    )
    assert response.status_code == 201, response.text
    async with activity_api.sessions() as db:
        before = (await db.get(WorkoutsSession, UUID(response.json()["id"]))).content
    entry = await create(activity_api)
    updated = (await correct(activity_api, entry)).json()
    assert (await remove(activity_api, updated)).status_code == 200
    async with activity_api.sessions() as db:
        assert (await db.get(WorkoutsSession, UUID(response.json()["id"]))).content == before


async def test_generation_erasure_hook_and_owner_cascade(activity_api):
    payload = body()
    entry = await create(activity_api, payload)
    await remove(activity_api, entry)
    async with activity_api.sessions() as db:
        await service.erase_activity_logs(db, "owner")  # root-owned lifecycle assembly hook
        await db.commit()
    assert (
        await activity_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    ).status_code == 200
    await enroll(activity_api, generation=2)
    assert (await post(activity_api, payload)).status_code == 409
    assert (
        await post(activity_api, payload, headers={next(iter(GENERATION)): "2"})
    ).status_code == 201
    async with activity_api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
    async with activity_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivityLog)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivityLogOperation)) == 0


async def test_pagination_export_and_immutable_operation(activity_api):
    for minutes in range(1, 4):
        await create(activity_api, body(duration_minutes=minutes))
    first = (
        await activity_api.client.get("/api/v1/workouts/activity-log?limit=2", headers=GENERATION)
    ).json()
    second = (
        await activity_api.client.get(
            "/api/v1/workouts/activity-log?limit=2&offset=2", headers=GENERATION
        )
    ).json()
    assert first["has_more"] and not second["has_more"]
    assert len({r["id"] for r in first["items"] + second["items"]}) == 3
    async with activity_api.sessions() as db:
        assert (await service.export_activity_logs(db, "owner", 1, 2, 0))["has_more"]
        with pytest.raises(Exception, match="immutable"):
            await db.execute(text("UPDATE workouts_activity_log_operations SET after_revision=999"))
        await db.rollback()
    await service.verify_activity_log_schema(activity_api.engine, settings())


async def test_migration_requires035_disabled_no_queries_production_guard_and_replay(
    data_api, monkeypatch
):
    class Forbidden:
        def begin(self):
            raise AssertionError("Disabled migration queried database")

    disabled = settings().model_copy(update={"workouts_api_enabled": False})
    await migration.run_migration(configured=disabled, migration_engine=Forbidden())
    await service.verify_activity_log_schema(Forbidden(), disabled)
    with pytest.raises(RuntimeError, match="035"):
        await migration.run_migration(configured=settings(), migration_engine=data_api.engine)
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=settings(), migration_engine=data_api.engine
    )
    monkeypatch.delenv("MIGRATION_044_RESTORE_POINT", raising=False)
    production = settings().model_copy(update={"environment": "production"})
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(configured=production, migration_engine=data_api.engine)
    monkeypatch.setenv("MIGRATION_044_RESTORE_POINT", "verified-fixture-point")
    await migration.run_migration(configured=production, migration_engine=data_api.engine)
    await migration.run_migration(configured=production, migration_engine=data_api.engine)
    await service.verify_activity_log_schema(data_api.engine, settings())


async def test_provenance_change_to_imported_blocks_correction_and_removal(activity_api):
    entry = await create(activity_api)
    async with activity_api.sessions() as db:
        projection = await db.get(WorkoutsActivity, UUID(entry["id"]))
        projection.content = {**projection.content, "origin_id": "health:synthetic-upstream"}
        await db.commit()
    current = (
        await activity_api.client.get(
            "/api/v1/workouts/activity-log/" + entry["id"], headers=GENERATION
        )
    ).json()
    assert current["read_only"] and current["source"] == "external"
    assert (await correct(activity_api, entry)).status_code == 403
    assert (await remove(activity_api, entry)).status_code == 403
    async with activity_api.sessions() as db:
        assert (await db.get(WorkoutsActivity, UUID(entry["id"]))).content[
            "origin_id"
        ] == "health:synthetic-upstream"


async def test_waiting_activity_write_observes_product_generation_tombstone(
    activity_api, monkeypatch
):
    from app.domains.workouts import lifecycle
    from app.domains.workouts.models import WorkoutsMembership

    entered = asyncio.Event()
    original = lifecycle.lock_owner

    async def observed(db, owner):
        entered.set()
        await original(db, owner)

    async with activity_api.sessions() as deletion_db:
        await original(deletion_db, "owner")
        monkeypatch.setattr(lifecycle, "lock_owner", observed)
        waiting = asyncio.create_task(post(activity_api))
        await asyncio.wait_for(entered.wait(), 5)
        await service.erase_activity_logs(deletion_db, "owner")
        await lifecycle.erase_product_data(
            deletion_db, await deletion_db.get(WorkoutsMembership, "owner"), 1
        )
        await deletion_db.commit()
        assert (await asyncio.wait_for(waiting, 5)).status_code == 409
    async with activity_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivityLog)) == 0


async def test_capture_identity_is_immutable_and_readiness_rejects_missing_guard(activity_api):
    await create(activity_api)
    async with activity_api.sessions() as db:
        with pytest.raises(Exception, match="immutable"):
            await db.execute(
                text("UPDATE workouts_activity_log SET created_at=created_at-INTERVAL '1 day'")
            )
        await db.rollback()
    async with activity_api.engine.begin() as connection:
        await connection.execute(
            text("DROP TRIGGER immutable_workouts_activity_log_identity ON workouts_activity_log")
        )
    with pytest.raises(RuntimeError, match="identity"):
        await service.verify_activity_log_schema(activity_api.engine, settings())


async def test_reads_require_original_generation_even_for_empty_reenrolled_history(activity_api):
    entry = await create(activity_api)
    assert (
        await activity_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    ).status_code == 200
    await enroll(activity_api, generation=2)
    detail = "/api/v1/workouts/activity-log/" + entry["id"]
    for path in ("/api/v1/workouts/activity-log", detail):
        assert (await activity_api.client.get(path, headers=GENERATION)).status_code == 409
        assert (await activity_api.client.get(path)).status_code == 422
    current = {next(iter(GENERATION)): "2"}
    page = await activity_api.client.get("/api/v1/workouts/activity-log", headers=current)
    assert page.status_code == 200 and page.json()["items"] == []
    assert (await activity_api.client.get(detail, headers=current)).status_code == 404


async def test_reads_reject_changed_original_account(activity_api):
    entry = await create(activity_api)
    for path in ("/api/v1/workouts/activity-log", "/api/v1/workouts/activity-log/" + entry["id"]):
        response = await activity_api.client.get(
            path, headers=GENERATION | {"X-Hafa-Account-ID": "different-owner"}
        )
        assert response.status_code == 409

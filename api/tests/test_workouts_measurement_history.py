"""Real-PG acceptance for explicit units, chronological profiles and private removal."""

import asyncio
import importlib
from datetime import timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.domains.workouts.automation_models import WorkoutCoachMessage, WorkoutProposal
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.measurement_models import (
    MEASUREMENT_TABLES,
    WorkoutsMeasurement,
    WorkoutsMeasurementCurrent,
    WorkoutsMeasurementOperation,
)
from app.domains.workouts.measurement_router import router
from app.domains.workouts.measurement_service import (
    current_measurement_context,
    erase_measurements,
    measurement_export_page,
    reconcile_profile_measurements,
    verify_measurement_schema,
)
from app.domains.workouts.models import WorkoutsProfile
from app.models.identity import AppUser
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    GENERATION,
    data_api,  # noqa: F401 -- imported reusable pytest fixture
    enroll,
    settings,
)

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.039_add_workouts_measurements")
automation = importlib.import_module("migrations.035_add_workouts_automation")
PREFIX = "/api/v1/workouts"


@pytest.fixture
async def measurement_api(data_api):  # noqa: F811 -- imported real disposable fixture
    await automation.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration.run_migration(configured=settings(), migration_engine=data_api.engine)
    data_api.app.include_router(router)
    return data_api


def stamp(days=0, minutes=-10):
    return (now() + timedelta(days=days, minutes=minutes)).isoformat()


async def profile_revision(api, other=False):
    # Timestamp schema additions are parent-owned and absent from this e46 base.
    # Read persisted revision here; parent integrated gate exercises raw profile GET.
    async with api.sessions() as db:
        row = await db.get(WorkoutsProfile, "other" if other else "owner")
        return row.revision if row else 0


async def add(api, *, other=False, expected=None, **changes):
    await enroll(api, other=other)
    payload = {
        "request_id": str(uuid4()),
        "kind": "weight",
        "value": 80,
        "unit": "kg",
        "recorded_at": stamp(),
        "source": "user",
        **changes,
    }
    headers = {
        **GENERATION,
        "If-Match": str(await profile_revision(api, other=other) if expected is None else expected),
        **({"X-Test-User": "other"} if other else {}),
    }
    response = await api.client.post(PREFIX + "/measurements", json=payload, headers=headers)
    return response, payload


async def corrected(api, entry, **changes):
    payload = {
        "request_id": str(uuid4()),
        "expected_revision": entry["revision"],
        "value": entry["value"],
        "unit": entry["unit"],
        "recorded_at": entry["recorded_at"],
        "source": "user",
        **changes,
    }
    response = await api.client.put(
        f"{PREFIX}/measurements/{entry['id']}",
        json=payload,
        headers={**GENERATION, "If-Match": str(await profile_revision(api))},
    )
    return response, payload


async def removed(api, entry):
    payload = {"request_id": str(uuid4()), "expected_revision": entry["revision"]}
    response = await api.client.post(
        f"{PREFIX}/measurements/{entry['id']}/remove",
        json=payload,
        headers={**GENERATION, "If-Match": str(await profile_revision(api))},
    )
    return response, payload


async def test_units_original_values_current_profile_and_timestamp(measurement_api):
    api = measurement_api
    response, payload = await add(api, value=200, unit="lb")
    assert response.status_code == 201, response.text
    body = response.json()
    entry = body["measurement"]
    assert entry["value"] == 200 and entry["unit"] == "lb"
    assert entry["canonical_value"] == 90.718474 and entry["canonical_unit"] == "kg"
    assert body["profile"]["weight_kg"] == 90.718474 and body["current_applied"]
    assert body["profile"]["weight_recorded_at"] == payload["recorded_at"]
    assert entry["is_current"] and response.headers["X-Workouts-Revision"] == "1"
    second, _ = await add(api, kind="height", value=70, unit="in")
    assert second.status_code == 201, second.text
    assert second.json()["profile"]["height_cm"] == 177.8
    assert second.json()["profile"]["weight_kg"] == 90.718474
    assert (
        await api.client.get(f"{PREFIX}/measurements/{entry['id']}", headers=GENERATION)
    ).json()["is_current"]


async def test_historical_backfill_and_equal_time_do_not_replace_current(measurement_api):
    api = measurement_api
    response, payload = await add(api)
    revision = response.json()["profile_revision"]
    for timestamp in [stamp(days=-20), payload["recorded_at"]]:
        historical, _ = await add(api, value=70, recorded_at=timestamp)
        assert historical.status_code == 201, historical.text
        assert not historical.json()["current_applied"]
        assert historical.json()["profile"]["weight_kg"] == 80
        assert historical.json()["profile_revision"] == revision
    newer, _ = await add(api, value=79, recorded_at=stamp(minutes=-1))
    assert newer.json()["profile"]["weight_kg"] == 79 and newer.json()["current_applied"]


async def test_history_only_without_profile_and_timestamped_trends(measurement_api):
    api = measurement_api
    for value, days in [(80, -3), (81, -2), (82, -1)]:
        response, _ = await add(
            api, value=value, recorded_at=stamp(days=days), update_current=False
        )
        assert response.status_code == 201 and response.json()["profile"] is None
    response = await api.client.get(
        PREFIX + "/measurements/trends", params={"kind": "weight", "limit": 1}, headers=GENERATION
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 3 and response.json()["has_more"]
    assert response.json()["items"][0]["canonical_value"] == 82
    response = await api.client.get(
        PREFIX + "/measurements/trends",
        params={
            "kind": "weight",
            "start_at": stamp(days=-2, minutes=-11),
            "end_at": stamp(days=-1, minutes=-9),
        },
        headers=GENERATION,
    )
    assert response.json()["total"] == 2
    assert (
        await api.client.get(
            PREFIX + "/measurements/trends",
            params={"kind": "weight", "start_at": stamp(), "end_at": stamp(days=-1)},
            headers=GENERATION,
        )
    ).status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "weight", "unit": "cm"},
        {"kind": "height", "unit": "kg"},
        {"value": True},
        {"value": "80"},
        {"value": 0},
        {"value": 501},
        {"kind": "height", "unit": "cm", "value": 301},
        {"recorded_at": "2026-01-01T12:00:00"},
        {"recorded_at": 12345},
        {"recorded_at": stamp(days=1)},
        {"source": "health"},
        {"owner_id": "other"},
        {"update_current": "true"},
    ],
)
async def test_rejects_invalid_or_inferred_measurements(measurement_api, changes):
    response, _ = await add(measurement_api, **changes)
    assert response.status_code == 422, response.text
    async with measurement_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 0


async def test_generation_profile_preconditions_and_owner_isolation(measurement_api):
    api = measurement_api
    response, payload = await add(api)
    entry = response.json()["measurement"]
    response, _ = await add(api, expected=0)
    assert response.status_code == 409
    assert (
        await api.client.post(
            PREFIX + "/measurements",
            json={**payload, "request_id": str(uuid4())},
            headers=GENERATION,
        )
    ).status_code == 428
    assert (
        await api.client.post(
            PREFIX + "/measurements",
            json=payload,
            headers={"X-Workouts-Generation": "2", "If-Match": "1"},
        )
    ).status_code == 409
    await enroll(api, other=True)
    assert (
        await api.client.get(
            f"{PREFIX}/measurements/{entry['id']}", headers={**GENERATION, "X-Test-User": "other"}
        )
    ).status_code == 404
    assert (
        await api.client.get(
            PREFIX + "/measurements", headers={**GENERATION, "X-Test-User": "other"}
        )
    ).json()["total"] == 0
    async with api.sessions() as db:
        db.add(
            WorkoutsMeasurementCurrent(
                app_user_id="other", generation=1, kind="weight", measurement_id=UUID(entry["id"])
            )
        )
        with pytest.raises(IntegrityError):
            await db.commit()


async def test_idempotent_creation_concurrent_replay_and_removed_request_fence(measurement_api):
    api = measurement_api
    await enroll(api)
    payload = {
        "request_id": str(uuid4()),
        "kind": "weight",
        "value": 80,
        "unit": "kg",
        "recorded_at": stamp(),
        "source": "user",
    }
    responses = await asyncio.gather(
        *[
            api.client.post(
                PREFIX + "/measurements", json=payload, headers={**GENERATION, "If-Match": "0"}
            )
            for _ in range(2)
        ]
    )
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert len({response.json()["measurement"]["id"] for response in responses}) == 1
    entry = responses[0].json()["measurement"]
    assert (
        await api.client.post(
            PREFIX + "/measurements",
            json={**payload, "value": 81},
            headers={**GENERATION, "If-Match": "1"},
        )
    ).status_code == 409
    result, request = await removed(api, entry)
    assert result.status_code == 200, result.text
    assert (
        await api.client.post(
            PREFIX + "/measurements", json=payload, headers={**GENERATION, "If-Match": "0"}
        )
    ).status_code == 410
    retry = await api.client.post(
        f"{PREFIX}/measurements/{entry['id']}/remove",
        json=request,
        headers={**GENERATION, "If-Match": "1"},
    )
    assert retry.status_code == 200 and retry.json()["measurement"]["value"] is None


async def test_corrections_current_vs_history_and_revision_conflicts(measurement_api):
    api = measurement_api
    current, _ = await add(api)
    entry = current.json()["measurement"]
    correction, payload = await corrected(api, entry, value=81)
    assert correction.status_code == 200, correction.text
    assert correction.json()["profile"]["weight_kg"] == 81
    assert correction.json()["measurement"]["revision"] == 2 and correction.json()["context_reset"]
    retry = await api.client.put(
        f"{PREFIX}/measurements/{entry['id']}",
        json=payload,
        headers={**GENERATION, "If-Match": "1"},
    )
    assert retry.status_code == 200
    stale, _ = await corrected(api, entry, value=82)
    assert stale.status_code == 409
    historical, _ = await add(api, value=70, recorded_at=stamp(days=-10))
    history_entry = historical.json()["measurement"]
    revision = historical.json()["profile_revision"]
    result, _ = await corrected(api, history_entry, value=71)
    assert not result.json()["current_applied"] and result.json()["profile"]["weight_kg"] == 81
    assert result.json()["profile_revision"] == revision + 1


async def test_removal_scrubs_values_and_no_automatic_fallback(measurement_api):
    api = measurement_api
    historical, _ = await add(api, recorded_at=stamp(days=-2))
    current, _ = await add(api, value=82)
    entry = current.json()["measurement"]
    result, _ = await removed(api, entry)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["profile"]["weight_kg"] is None and body["profile"]["weight_recorded_at"] is None
    assert body["measurement"]["status"] == "removed"
    for name in ["value", "unit", "canonical_value", "canonical_unit", "recorded_at"]:
        assert body["measurement"][name] is None
    listed = (await api.client.get(PREFIX + "/measurements", headers=GENERATION)).json()
    assert (
        listed["total"] == 1 and listed["items"][0]["id"] == historical.json()["measurement"]["id"]
    )
    backfill, _ = await add(api, value=72, recorded_at=stamp(days=-1))
    assert (
        not backfill.json()["current_applied"] and backfill.json()["profile"]["weight_kg"] is None
    )
    async with api.sessions() as db:
        stored = await db.get(WorkoutsMeasurement, UUID(entry["id"]))
        assert stored.value is None and stored.recorded_at is None
        exported = await measurement_export_page(db, "owner", 1)
        tombstone = next(item for item in exported["items"] if item["id"] == entry["id"])
        assert tombstone["value"] is None and "request_hash" not in str(exported)


async def profile_hook(api, proposed):
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        profile = await db.get(WorkoutsProfile, "owner")
        result = await reconcile_profile_measurements(
            db, "owner", 1, profile.content if profile else None, proposed
        )
        if profile:
            profile.content = result
            profile.revision += 1
        else:
            db.add(WorkoutsProfile(app_user_id="owner", generation=1, revision=1, content=result))
        await db.commit()
        return result


async def test_profile_hook_only_changed_values_timestamp_and_clear_distinction(measurement_api):
    api = measurement_api
    await enroll(api)
    measured = stamp()
    result = await profile_hook(
        api, {"adult_confirmed": True, "weight_kg": 80, "weight_recorded_at": measured}
    )
    assert result["weight_recorded_at"] == measured
    result = await profile_hook(
        api, {**result, "equipment": ["Dumbbells"], "weight_recorded_at": stamp(minutes=-2)}
    )
    assert result["weight_recorded_at"] == measured
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 1
    cleared = await profile_hook(api, {**result, "weight_kg": None, "weight_recorded_at": None})
    assert cleared["weight_kg"] is None
    async with api.sessions() as db:
        assert (await db.scalar(select(WorkoutsMeasurement))).status == "active"
    history, _ = await add(api, recorded_at=stamp(days=-3), value=70)
    assert not history.json()["current_applied"]
    assert history.json()["profile"]["weight_kg"] is None


async def test_profile_hook_changed_value_requires_time_and_rejects_backfill(measurement_api):
    api = measurement_api
    await enroll(api)
    with pytest.raises(HTTPException):
        await profile_hook(api, {"weight_kg": 80})
    initial = await profile_hook(api, {"weight_kg": 80, "weight_recorded_at": stamp()})
    with pytest.raises(HTTPException, match="older measurements"):
        await profile_hook(api, {**initial, "weight_kg": 70, "weight_recorded_at": stamp(days=-20)})
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 1


async def test_correction_removal_clear_ai_memory_pending_only_keep_accepted_records(
    measurement_api,
):
    api = measurement_api
    response, _ = await add(api)
    entry = response.json()["measurement"]
    accepted_id = uuid4()
    async with api.sessions() as db:
        db.add(
            WorkoutCoachMessage(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                request_id=uuid4(),
                request_hash="0" * 64,
                user_message="Fixture",
                assistant_message="Old weight was 80kg",
                proposals=[],
            )
        )
        for accepted in [False, True]:
            db.add(
                WorkoutProposal(
                    id=accepted_id if accepted else uuid4(),
                    app_user_id="owner",
                    generation=1,
                    kind="program",
                    profile_revision=1,
                    context_hash="0" * 64,
                    content={"private_old_weight": 80},
                    accepted_at=now() if accepted else None,
                    expires_at=now() + timedelta(days=1),
                )
            )
        db.add(
            WorkoutProposal(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                kind="profile",
                profile_revision=1,
                context_hash="0" * 64,
                content={"status": "ready", "profile": {"weight_kg": 80}},
                accepted_at=now(),
                expires_at=now() + timedelta(days=1),
            )
        )
        await db.commit()
    response, _ = await corrected(api, entry, value=81)
    assert response.status_code == 200, response.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutCoachMessage)) == 0
        assert (await db.scalars(select(WorkoutProposal.id))).all() == [accepted_id]
        accepted = await db.get(WorkoutProposal, accepted_id)
        assert accepted.content == {
            "status": "unsupported",
            "questions": ["Saved AI context was cleared."],
        }
        assert "private_old_weight" not in str(accepted.content)


async def test_erasure_global_cascade_and_operation_immutability(measurement_api):
    api = measurement_api
    await add(api)
    async with api.sessions() as db:
        operation = await db.scalar(select(WorkoutsMeasurementOperation))
        operation.request_hash = "0" * 64
        with pytest.raises(DBAPIError, match="immutable"):
            await db.commit()
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await erase_measurements(db, "owner")
        await db.commit()
        for table in MEASUREMENT_TABLES:
            assert await db.scalar(select(func.count()).select_from(table)) == 0
    await add(api, value=81)
    async with api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
        for table in MEASUREMENT_TABLES:
            assert await db.scalar(select(func.count()).select_from(table)) == 0


async def test_migration_optional_idempotent_restore_core_and_no_fabricated_backfill(
    measurement_api, monkeypatch
):
    api = measurement_api

    class NoDatabase:
        def begin(self):
            raise AssertionError("Disabled Workouts connected")

        def connect(self):
            raise AssertionError("Disabled Workouts connected")

    disabled = SimpleNamespace(workouts_api_enabled=False)
    await migration.run_migration(configured=disabled, migration_engine=NoDatabase())
    await verify_measurement_schema(NoDatabase(), disabled)
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await verify_measurement_schema(api.engine, settings())
    async with api.sessions() as db:
        assert (await db.scalars(text("SELECT version FROM schema_migrations"))).all() == [33]
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 0
    async with api.engine.begin() as connection:
        await connection.execute(text("DELETE FROM workouts_schema_migrations WHERE version=39"))
    monkeypatch.delenv("MIGRATION_039_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="verified restore point"):
        await migration.run_migration(
            configured=SimpleNamespace(workouts_api_enabled=True, environment="production"),
            migration_engine=api.engine,
        )


async def test_coach_context_only_active_current_values_and_metadata_drift(measurement_api):
    api = measurement_api
    await add(api, value=70, recorded_at=stamp(days=-20), update_current=False)
    current, _ = await add(api, value=80)
    async with api.sessions() as db:
        context = await current_measurement_context(db, "owner", 1)
        assert len(context) == 1 and context[0]["value"] == 80
    await removed(api, current.json()["measurement"])
    async with api.sessions() as db:
        assert await current_measurement_context(db, "owner", 1) == []
    async with api.engine.begin() as connection:
        await connection.execute(
            text(
                "DROP TRIGGER immutable_workouts_measurement_operation ON workouts_measurement_operations"
            )
        )
    with pytest.raises(RuntimeError, match="immutable"):
        await verify_measurement_schema(api.engine, settings())


async def test_profile_hook_timestamp_without_value_and_legacy_untimestamped_value(measurement_api):
    api = measurement_api
    await enroll(api)
    with pytest.raises(HTTPException, match="requires its value"):
        await profile_hook(api, {"weight_kg": None, "weight_recorded_at": stamp()})
    async with api.sessions() as db:
        db.add(
            WorkoutsProfile(
                app_user_id="owner", generation=1, revision=1, content={"weight_kg": 80}
            )
        )
        await db.commit()
    result = await profile_hook(api, {"weight_kg": 80, "equipment": ["Bodyweight"]})
    assert result["weight_recorded_at"] is None
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 0


async def test_concurrent_distinct_current_writes_profile_revision_fence(measurement_api):
    api = measurement_api
    await enroll(api)
    responses = await asyncio.gather(
        *[
            api.client.post(
                PREFIX + "/measurements",
                json={
                    "request_id": str(uuid4()),
                    "kind": "weight",
                    "value": value,
                    "unit": "kg",
                    "recorded_at": stamp(),
                    "source": "user",
                },
                headers={**GENERATION, "If-Match": "0"},
            )
            for value in [80, 81]
        ]
    )
    assert sorted(response.status_code for response in responses) == [201, 409]
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 1

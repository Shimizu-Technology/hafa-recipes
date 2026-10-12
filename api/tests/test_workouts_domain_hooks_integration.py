"""Combined account hooks against the real optional034–039 PostgreSQL chain."""

import base64
import importlib
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.domains.workouts import health_router, security
from app.domains.workouts.connection_models import (
    CONNECTION_TABLES,
    RecipeConnectionReceipt,
)
from app.domains.workouts.connection_router import router as connections
from app.domains.workouts.health_models import (
    HEALTH_TABLES,
    HealthObservation,
    HealthSyncReceipt,
)
from app.domains.workouts.library_organization_models import (
    ORGANIZATION_TABLES,
    WorkoutLibraryOrganization,
)
from app.domains.workouts.library_organization_router import router as organization
from app.domains.workouts.library_organization_service import source_key
from app.domains.workouts.lifecycle import now
from app.domains.workouts.measurement_models import MEASUREMENT_TABLES, WorkoutsMeasurement
from app.domains.workouts.measurement_router import router as measurements
from app.domains.workouts.models import WorkoutsActivity, WorkoutsSession
from app.models.identity import AppUser
from app.models.recipe import Recipe
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    GENERATION,
    WORKOUT,
    data_api,  # noqa: F401 -- imported reusable disposable fixture
    enroll,
    session_payload,
    settings,
)

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
PREFIX = "/api/v1/workouts"


@pytest.fixture
async def full_api(data_api, monkeypatch):  # noqa: F811 -- reusable disposable fixture
    configured = settings(workouts_health_sync_enabled=True)
    for name in [
        "035_add_workouts_automation",
        "036_add_workouts_health",
        "037_add_workouts_connections_sharing",
        "038_add_workouts_library_organization",
        "039_add_workouts_measurements",
    ]:
        await importlib.import_module("migrations." + name).run_migration(
            configured=configured, migration_engine=data_api.engine
        )
    previous = len(data_api.app.router.routes)
    data_api.app.include_router(organization)
    added = data_api.app.router.routes[previous:]
    data_api.app.router.routes[:] = added + data_api.app.router.routes[:previous]
    for router in [connections, health_router.router, measurements]:
        data_api.app.include_router(router)
    monkeypatch.setattr(security, "get_settings", lambda: configured)
    monkeypatch.setattr(health_router, "get_settings", lambda: configured)
    monkeypatch.setenv(
        "WORKOUTS_SHARE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"T" * 32).decode()
    )
    await enroll(data_api)
    await enroll(data_api, other=True)
    return data_api


def timestamp(days=0, minutes=-10):
    return (now() + timedelta(days=days, minutes=minutes)).isoformat()


async def create_workout(api, other=False, source_url="https://example.test/one"):
    response = await api.client.post(
        PREFIX + "/library",
        json={**WORKOUT, "source_url": source_url},
        headers={**GENERATION, **({"X-Test-User": "other"} if other else {})},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def connect(api, provider="apple_health", other=False, use_ai=False):
    if use_ai:
        result = await api.client.put(
            PREFIX + "/ai-consent",
            json={"accepted": True, "disclosure_version": 1},
            headers={**GENERATION, **({"X-Test-User": "other"} if other else {})},
        )
        assert result.status_code == 200, result.text
    response = await api.client.put(
        f"{PREFIX}/health/{provider}/connection",
        headers={**GENERATION, **({"X-Test-User": "other"} if other else {})},
        json={
            "expected_revision": 0,
            "connected": True,
            "read_on_device": True,
            "upload_to_server": True,
            "use_for_ai": use_ai,
            "write_actuals": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def sync(api, other=False):
    response = await api.client.post(
        PREFIX + "/health/apple_health/sync",
        headers={**GENERATION, **({"X-Test-User": "other"} if other else {})},
        json={
            "receipt_id": str(uuid4()),
            "expected_revision": 1,
            "observations": [
                {
                    "source_id": "apple_health:fixture",
                    "provider": "apple_health",
                    "origin_id": "com.example.watch",
                    "started_at": "2026-10-01T10:00:00+10:00",
                    "ended_at": "2026-10-01T10:10:00+10:00",
                    "duration_seconds": 600,
                    "duration_basis": "provider_reported",
                    "activity_type": "healthkit:37",
                }
            ],
            "deleted_source_ids": [],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def share(api, row):
    preview = await api.client.post(
        PREFIX + "/sharing/previews",
        headers=GENERATION,
        json={"workout_id": row["id"], "expected_revision": row["revision"]},
    )
    assert preview.status_code == 201, preview.text
    response = await api.client.post(
        f"{PREFIX}/sharing/previews/{preview.json()['id']}/confirm",
        headers=GENERATION,
        json={
            "preview_digest": preview.json()["preview_digest"],
            "confirm_public_snapshot": True,
            "disclosure_version": 1,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_034_only_profile_library_grants_consent_export_delete_still_work(data_api):  # noqa: F811 -- reusable fixture
    api = data_api
    await enroll(api)
    result = await api.client.put(
        PREFIX + "/profile", headers={**GENERATION, "If-Match": "0"}, json={"weight_kg": 80}
    )
    assert result.status_code == 200, result.text
    row = await create_workout(api)
    assert row["organization"] is None
    assert (await api.client.get(PREFIX + "/library")).json()[0]["id"] == row["id"]
    for path, body in [
        ("grants", {"scopes": ["health_activity_read"]}),
        ("ai-consent", {"accepted": False, "disclosure_version": 1}),
    ]:
        assert (
            await api.client.put(PREFIX + "/" + path, json=body, headers=GENERATION)
        ).status_code == 200
    exported = await api.client.get(PREFIX + "/export")
    assert exported.status_code == 200, exported.text
    assert "measurements" not in exported.json()["datasets"]
    assert (await api.client.delete(PREFIX + "/data", headers=GENERATION)).status_code == 200
    async with api.sessions() as db:
        assert await db.get(AppUser, "owner") is not None


async def test_profile_put_get_timestamps_history_and_goal_edits(full_api):
    api = full_api
    measured = timestamp()
    result = await api.client.put(
        PREFIX + "/profile",
        headers={**GENERATION, "If-Match": "0"},
        json={
            "weight_kg": 80,
            "weight_recorded_at": measured,
            "height_cm": 175,
            "height_recorded_at": measured,
        },
    )
    assert result.status_code == 200, result.text
    body = result.json()
    original_time = body["weight_recorded_at"]
    assert result.headers["X-Workouts-Revision"] == "1"
    fetched = await api.client.get(PREFIX + "/profile")
    assert fetched.status_code == 200 and fetched.json() == body
    edited = await api.client.put(
        PREFIX + "/profile",
        headers={**GENERATION, "If-Match": "1"},
        json={
            **body,
            "primary_goal": "running",
            "equipment": ["Dumbbells"],
            "weight_recorded_at": timestamp(minutes=-1),
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["weight_recorded_at"] == original_time
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsMeasurement)) == 2
    missing_time = await api.client.put(
        PREFIX + "/profile",
        headers={**GENERATION, "If-Match": "2"},
        json={**edited.json(), "weight_kg": 81, "weight_recorded_at": None},
    )
    assert missing_time.status_code == 422
    cleared = await api.client.put(
        PREFIX + "/profile",
        headers={**GENERATION, "If-Match": "2"},
        json={**edited.json(), "weight_kg": None, "weight_recorded_at": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert (await api.client.get(PREFIX + "/profile")).json()["weight_kg"] is None
    assert (await api.client.get(PREFIX + "/measurements", headers=GENERATION)).json()["total"] == 2


async def test_measurement_route_profile_serialization_and_historical_export(full_api):
    api = full_api
    response = await api.client.post(
        PREFIX + "/measurements",
        headers={**GENERATION, "If-Match": "0"},
        json={
            "request_id": str(uuid4()),
            "kind": "weight",
            "value": 200,
            "unit": "lb",
            "recorded_at": timestamp(),
            "source": "user",
        },
    )
    assert response.status_code == 201, response.text
    entry = response.json()["measurement"]
    profile = await api.client.get(PREFIX + "/profile")
    assert profile.status_code == 200 and profile.json()["weight_kg"] == 90.718474
    assert profile.json()["weight_recorded_at"]
    removed = await api.client.post(
        f"{PREFIX}/measurements/{entry['id']}/remove",
        headers={**GENERATION, "If-Match": "1"},
        json={"request_id": str(uuid4()), "expected_revision": 1},
    )
    assert removed.status_code == 200, removed.text
    exported = await api.client.get(PREFIX + "/export")
    assert exported.status_code == 200, exported.text
    assert exported.json()["profile"]["weight_kg"] is None
    assert exported.json()["datasets"]["measurements"][0]["value"] is None
    assert exported.json()["totals"]["measurements"] == 1


async def test_manual_library_source_metadata_archive_and_versions(full_api):
    api = full_api
    row = await create_workout(api)
    assert row["organization"]["revision"] == 1
    metadata = await api.client.put(
        f"{PREFIX}/library/{row['id']}/organization",
        headers=GENERATION,
        json={"expected_revision": 1, "archived": True, "favorite": True, "tags": ["Strength"]},
    )
    assert metadata.status_code == 200, metadata.text
    assert (await api.client.get(PREFIX + "/library")).json() == []
    archived = (await api.client.get(PREFIX + "/library?include_archived=true")).json()
    assert archived[0]["organization"]["archived"]
    assert (await api.client.get(f"{PREFIX}/library/{row['id']}")).json()["organization"][
        "favorite"
    ]
    edited = await api.client.put(
        f"{PREFIX}/library/{row['id']}?expected_revision=1",
        headers=GENERATION,
        json={**WORKOUT, "source_url": "https://example.test/two"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 2 and edited.json()["organization"]["revision"] == 2
    async with api.sessions() as db:
        stored = await db.get(WorkoutLibraryOrganization, UUID(row["id"]))
        assert stored.source_key == source_key("https://example.test/two")
    assert len((await api.client.get(f"{PREFIX}/library/{row['id']}/versions")).json()) == 2


async def test_generic_read_revocation_purges_only_imports_and_invalidates_health_revision(
    full_api,
):
    api = full_api
    await connect(api, use_ai=True)
    await sync(api)
    manual = await api.client.post(
        PREFIX + "/activities",
        headers=GENERATION,
        json={"name": "Basketball", "date": "2026-10-10"},
    )
    assert manual.status_code == 201
    changed = await api.client.put(PREFIX + "/grants", headers=GENERATION, json={"scopes": []})
    assert changed.status_code == 200, changed.text
    connection = (await api.client.get(PREFIX + "/health/apple_health/connection")).json()
    assert connection["revision"] == 2 and not connection["connected"]
    assert (
        not connection["upload_to_server"]
        and not connection["write_actuals"]
        and connection["cursor"] is None
    )
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(HealthObservation)) == 0
        assert await db.scalar(select(func.count()).select_from(HealthSyncReceipt)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsActivity)) == 1
    blocked = await api.client.post(
        PREFIX + "/health/apple_health/sync",
        headers=GENERATION,
        json={"receipt_id": str(uuid4()), "expected_revision": 1, "observations": []},
    )
    assert blocked.status_code in {403, 409}


async def test_global_ai_revocation_disables_health_ai_and_preserves_read_upload(full_api):
    api = full_api
    await connect(api, use_ai=True)
    await sync(api)
    response = await api.client.put(
        PREFIX + "/ai-consent",
        headers=GENERATION,
        json={"accepted": False, "disclosure_version": 1},
    )
    assert response.status_code == 200, response.text
    connection = (await api.client.get(PREFIX + "/health/apple_health/connection")).json()
    assert connection["revision"] == 2 and not connection["use_for_ai"]
    assert connection["read_on_device"] and connection["upload_to_server"]
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(HealthObservation)) == 1


async def test_export_all_optional_datasets_paged_owner_only_without_protocol_secrets(full_api):
    api = full_api
    row = await create_workout(api)
    published = await share(api, row)
    await api.client.post(PREFIX + "/collections", headers=GENERATION, json={"title": "Strength"})
    await connect(api)
    await connect(api, provider="health_connect")
    await sync(api)
    async with api.sessions() as db:
        for owner in ["owner", "owner", "other"]:
            db.add(
                RecipeConnectionReceipt(
                    app_user_id=owner,
                    generation=1,
                    purpose="view",
                    scopes=["recipes_library_context"],
                    recipe_ids=[],
                    meal_plan_ids=[],
                )
            )
        await db.commit()
    exported = await api.client.get(PREFIX + "/export?limit=1")
    assert exported.status_code == 200, exported.text
    body = exported.json()
    assert (
        body["totals"]["recipe_connection_receipts"] == 2
        and body["has_more"]["recipe_connection_receipts"]
    )
    assert (
        len(body["datasets"]["health_connections"]) == 1
        and body["totals"]["health_connections"] == 2
    )
    next_page = (await api.client.get(PREFIX + "/export?limit=1&offset=1")).json()
    assert (
        next_page["datasets"]["health_connections"][0]["provider"]
        != body["datasets"]["health_connections"][0]["provider"]
    )
    assert not next_page["has_more"]["health_connections"]
    for forbidden in [
        "token_ciphertext",
        "token_hash",
        "source_key",
        "request_hash",
        "cursor",
        "subject",
    ]:
        assert forbidden not in exported.text
    assert published["api_path"] not in exported.text
    assert body["datasets"]["published_training_shares"][0]["id"] == published["id"]


async def test_full_product_erase_cleans_domains_preserves_recipes_other_owner_and_copies(full_api):
    api = full_api
    row = await create_workout(api)
    actual = await api.client.post(
        PREFIX + "/sessions", json=session_payload(row), headers=GENERATION
    )
    assert actual.status_code == 201, actual.text
    published = await share(api, row)
    token = published["api_path"].rsplit("/", 1)[1]
    copied = await api.client.post(
        f"{PREFIX}/shared/{token}/copy",
        headers={**GENERATION, "X-Test-User": "other"},
        json={
            "copy_request_id": str(uuid4()),
            "snapshot_digest": published["snapshot_digest"],
            "acknowledge_not_personalized": True,
        },
    )
    assert copied.status_code == 201, copied.text
    await connect(api)
    await sync(api)
    await connect(api, other=True)
    await sync(api, other=True)
    await api.client.post(PREFIX + "/collections", headers=GENERATION, json={"title": "Strength"})
    await api.client.post(
        PREFIX + "/measurements",
        headers={**GENERATION, "If-Match": "0"},
        json={
            "request_id": str(uuid4()),
            "kind": "weight",
            "value": 80,
            "unit": "kg",
            "recorded_at": timestamp(),
            "source": "user",
        },
    )
    async with api.sessions() as db:
        db.add(
            Recipe(
                user_id="owner",
                source_url="manual://fixture",
                source_type="manual",
                extracted={"title": "Keep Recipes"},
            )
        )
        db.add(
            RecipeConnectionReceipt(
                app_user_id="owner",
                generation=1,
                purpose="view",
                scopes=[],
                recipe_ids=[],
                meal_plan_ids=[],
            )
        )
        await db.commit()
    deleted = await api.client.delete(PREFIX + "/data", headers=GENERATION)
    assert deleted.status_code == 200 and deleted.json()["generation"] == 2, deleted.text
    assert (await api.client.get(PREFIX + "/shared/" + token)).status_code == 404
    recipient = await api.client.get(
        f"{PREFIX}/library/{copied.json()['record']['id']}", headers={"X-Test-User": "other"}
    )
    assert recipient.status_code == 200
    async with api.sessions() as db:
        for table in [
            *HEALTH_TABLES,
            *CONNECTION_TABLES,
            *ORGANIZATION_TABLES,
            *MEASUREMENT_TABLES,
        ]:
            assert (
                await db.scalar(
                    select(func.count()).select_from(table).where(table.c.app_user_id == "owner")
                )
                == 0
            ), table.name
        assert await db.get(AppUser, "owner") is not None
        assert (
            await db.scalar(
                select(func.count()).select_from(Recipe).where(Recipe.user_id == "owner")
            )
            == 1
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(HealthObservation)
                .where(HealthObservation.app_user_id == "other")
            )
            == 1
        )
        assert await db.scalar(select(func.count()).select_from(WorkoutsSession)) == 0
    assert (await api.client.delete(PREFIX + "/data", headers=GENERATION)).status_code == 200

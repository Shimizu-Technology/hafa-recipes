"""Disposable PostgreSQL acceptance for organization, isolation and independent copies."""

import asyncio
import importlib
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.domains.workouts.library_organization_models import (
    ORGANIZATION_TABLES,
    WorkoutLibraryCollection,
    WorkoutLibraryCollectionMember,
    WorkoutLibraryDuplicateReceipt,
    WorkoutLibraryOrganization,
)
from app.domains.workouts.library_organization_router import router
from app.domains.workouts.library_organization_service import (
    active_library_condition,
    erase_library_organization,
    organization_export_page,
    refresh_source_metadata,
    source_key,
    verify_organization_schema,
)
from app.domains.workouts.lifecycle import membership_for
from app.domains.workouts.models import WorkoutRecord, WorkoutsSession, WorkoutVersion
from app.models.identity import AppUser
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    GENERATION,
    WORKOUT,
    data_api,  # noqa: F401 -- shared real-PG fixture with isolated database safety
    enroll,
    session_payload,
    settings,
)

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.038_add_workouts_library_organization")
automation_migration = importlib.import_module("migrations.035_add_workouts_automation")
PREFIX = "/api/v1/workouts"


@pytest.fixture
async def organization_api(data_api):  # noqa: F811 -- imported reusable pytest fixture
    await automation_migration.run_migration(
        configured=settings(), migration_engine=data_api.engine
    )
    await migration.run_migration(configured=settings(), migration_engine=data_api.engine)
    # Static /library/search must precede existing /library/{UUID} route.
    previous = len(data_api.app.router.routes)
    data_api.app.include_router(router)
    added = data_api.app.router.routes[previous:]
    data_api.app.router.routes[:] = added + data_api.app.router.routes[:previous]
    from app.domains.workouts.automation_router import router as automation_router

    data_api.app.include_router(automation_router)
    return data_api


async def create(api, title="Fixture strength", *, other=False, source_url=None):
    await enroll(api, other=other)
    payload = {**WORKOUT, "title": title}
    if source_url:
        payload.update(source_url=source_url, provenance="source")
    response = await api.client.post(
        PREFIX + "/library",
        json=payload,
        headers={**GENERATION, **({"X-Test-User": "other"} if other else {})},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def metadata(api, row):
    response = await api.client.get(
        f"{PREFIX}/library/{row['id']}/organization", headers=GENERATION
    )
    assert response.status_code == 200, response.text
    return response.json()


async def change(api, row, **fields):
    response = await api.client.put(
        f"{PREFIX}/library/{row['id']}/organization",
        json={"expected_revision": (await metadata(api, row))["revision"], **fields},
        headers=GENERATION,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def make_collection(api, title="Strength", *, other=False):
    await enroll(api, other=other)
    response = await api.client.post(
        PREFIX + "/collections",
        json={"title": title},
        headers={**GENERATION, **({"X-Test-User": "other"} if other else {})},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def search(api, **params):
    response = await api.client.get(PREFIX + "/library/search", params=params, headers=GENERATION)
    assert response.status_code == 200, response.text
    return response.json()


async def test_metadata_preserves_prescription_and_actuals(organization_api):
    api = organization_api
    row = await create(api)
    actual = await api.client.post(
        PREFIX + "/sessions", json=session_payload(row), headers=GENERATION
    )
    assert actual.status_code == 201, actual.text
    # Explicit legacy record without metadata, even once root attaches writer hooks.
    async with api.sessions() as db:
        await db.execute(
            delete(WorkoutLibraryOrganization).where(
                WorkoutLibraryOrganization.workout_id == UUID(row["id"])
            )
        )
        await db.commit()
    initial = await metadata(api, row)
    assert initial == {
        "revision": 0,
        "favorite": False,
        "archived": False,
        "tags": [],
        "collection_ids": [],
        "duplicate_of_workout_id": None,
        "duplicate_of_revision": None,
    }
    updated = await change(api, row, favorite=True, archived=True, tags=["Run", "Å"])
    assert updated["revision"] == 1
    assert (await search(api))["items"] == []
    archived = await search(api, archived_only=True)
    assert archived["items"][0]["organization"]["archived"]
    detail = (await api.client.get(f"{PREFIX}/library/{row['id']}")).json()
    assert detail["content"] == row["content"] and detail["revision"] == row["revision"]
    assert detail["organization"]["archived"] is True
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutVersion)) == 1
        assert (await db.scalar(select(WorkoutsSession))).content == actual.json()["content"]
    await change(api, row, archived=False)
    assert (await search(api, favorite_only=True))["items"][0]["id"] == row["id"]


async def test_collections_revision_casefold_delete_unlinks_only(organization_api):
    api = organization_api
    row = await create(api)
    collection = await make_collection(api, "  Strength  ")
    assert collection["title"] == "Strength"
    response = await api.client.post(
        PREFIX + "/collections", json={"title": "strength"}, headers=GENERATION
    )
    assert response.status_code == 409
    linked = await change(api, row, collection_ids=[collection["id"]])
    assert (await api.client.get(PREFIX + "/collections", headers=GENERATION)).json()[0][
        "workout_count"
    ] == 1
    path = f"{PREFIX}/collections/{collection['id']}"
    response = await api.client.put(
        path, json={"title": "New", "expected_revision": 1}, headers=GENERATION
    )
    assert response.status_code == 200 and response.json()["revision"] == 2
    assert (
        await api.client.delete(path, params={"expected_revision": 1}, headers=GENERATION)
    ).status_code == 409
    assert (
        await api.client.delete(path, params={"expected_revision": 2}, headers=GENERATION)
    ).status_code == 204
    after_removal = await metadata(api, row)
    assert after_removal["collection_ids"] == []
    assert after_removal["revision"] == linked["revision"] + 1
    stale = await api.client.put(
        f"{PREFIX}/library/{row['id']}/organization",
        json={"expected_revision": 1, "favorite": True},
        headers=GENERATION,
    )
    assert stale.status_code == 409
    assert (await api.client.get(f"{PREFIX}/library/{row['id']}")).status_code == 200


@pytest.mark.parametrize(
    "fields",
    [
        {"tags": ["Run", "run"]},
        {"tags": ["  "]},
        {"favorite": None},
        {"favorite": "true"},
        {"archived": 1},
        {"tags": ["x" * 41]},
        {"tags": ["x\nY"]},
        {},
        {"owner_id": "other"},
        {"collection_ids": [str(UUID(int=1)), str(UUID(int=1))]},
    ],
)
async def test_invalid_metadata_not_silently_coerced(organization_api, fields):
    row = await create(organization_api)
    before = await metadata(organization_api, row)
    response = await organization_api.client.put(
        f"{PREFIX}/library/{row['id']}/organization",
        json={"expected_revision": before["revision"], **fields},
        headers=GENERATION,
    )
    assert response.status_code == 422, response.text
    assert (await metadata(organization_api, row))["revision"] == before["revision"]


async def test_owner_isolation_and_composite_database_fences(organization_api):
    api = organization_api
    row = await create(api)
    other_collection = await make_collection(api, other=True)
    current_revision = (await metadata(api, row))["revision"]
    assert (
        await api.client.put(
            f"{PREFIX}/library/{row['id']}/organization",
            json={
                "expected_revision": current_revision,
                "collection_ids": [other_collection["id"]],
            },
            headers=GENERATION,
        )
    ).status_code == 404
    assert (
        await api.client.get(
            f"{PREFIX}/library/{row['id']}/organization",
            headers={**GENERATION, "X-Test-User": "other"},
        )
    ).status_code == 404
    assert (
        await api.client.get(
            PREFIX + "/library/search", headers={**GENERATION, "X-Test-User": "other"}
        )
    ).json()["total"] == 0
    async with api.sessions() as db:
        db.add(
            WorkoutLibraryCollectionMember(
                collection_id=UUID(other_collection["id"]),
                workout_id=UUID(row["id"]),
                app_user_id="owner",
                generation=1,
            )
        )
        with pytest.raises(IntegrityError):
            await db.commit()


async def test_concurrent_metadata_updates_one_wins(organization_api):
    api = organization_api
    row = await create(api)
    previous = (await metadata(api, row))["revision"]
    responses = await asyncio.gather(
        *[
            api.client.put(
                f"{PREFIX}/library/{row['id']}/organization",
                json={"expected_revision": previous, "favorite": value},
                headers=GENERATION,
            )
            for value in [True, False]
        ]
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert (await metadata(api, row))["revision"] == previous + 1


async def test_search_keyset_filters_literal_wildcards_and_new_rows(organization_api):
    api = organization_api
    rows = [await create(api, name) for name in ["100% strength", "Other", "Third"]]
    await change(api, rows[0], tags=["Run"], favorite=True)
    assert (await search(api, q="%"))["total"] == 1
    assert (await search(api, q="Squat"))["total"] == 3
    assert (await search(api, tags="RUN", favorite_only=True))["items"][0]["id"] == rows[0]["id"]
    first = await search(api, limit=1)
    assert first["has_more"] and first["next_cursor"]
    await create(api, "Newly inserted")
    second = await search(api, limit=1, cursor=first["next_cursor"])
    assert second["items"][0]["id"] not in {first["items"][0]["id"]}
    third = await search(api, limit=1, cursor=second["next_cursor"])
    assert {first["items"][0]["id"], second["items"][0]["id"], third["items"][0]["id"]} == {
        row["id"] for row in rows
    }
    assert third["next_cursor"] is None
    response = await api.client.get(
        PREFIX + "/library/search",
        params={"cursor": first["next_cursor"], "q": "changed"},
        headers=GENERATION,
    )
    assert response.status_code == 409
    response = await api.client.get(
        PREFIX + "/library/search",
        params={"cursor": first["next_cursor"], "offset": 1},
        headers=GENERATION,
    )
    assert response.status_code == 422
    assert (
        await api.client.get(
            PREFIX + "/library/search", params={"cursor": "bad"}, headers=GENERATION
        )
    ).status_code == 422


async def test_collection_filter_and_archive_access(organization_api):
    api = organization_api
    row = await create(api)
    collection = await make_collection(api)
    await change(api, row, collection_ids=[collection["id"]], archived=True)
    assert (await search(api, collection_id=collection["id"]))["total"] == 0
    assert (await search(api, collection_id=collection["id"], include_archived=True))["total"] == 1
    async with api.sessions() as db:
        assert (
            await db.scalars(select(WorkoutRecord).where(active_library_condition()))
        ).all() == []


async def test_source_duplicates_advisory_owner_scoped_and_edit_index(organization_api):
    api = organization_api
    row = await create(api, source_url="https://youtu.be/abcdefghi12?si=tracking")
    await create(api, other=True, source_url="https://www.youtube.com/watch?v=abcdefghi12")
    response = await api.client.get(
        PREFIX + "/library/duplicate-sources",
        params={"source_url": "https://www.youtube.com/watch?v=abcdefghi12&utm_source=ignored"},
        headers=GENERATION,
    )
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["matches"]] == [row["id"]]
    assert response.json()["advisory"] and not response.json()["has_more"]
    async with api.sessions() as db:
        saved = await db.get(WorkoutRecord, UUID(row["id"]))
        await refresh_source_metadata(db, saved)
        await db.commit()
    await change(api, row, archived=True)
    response = await api.client.get(
        PREFIX + "/library/duplicate-sources",
        params={"source_url": "https://youtu.be/abcdefghi12"},
        headers=GENERATION,
    )
    assert response.json()["matches"][0]["archived"]
    async with api.sessions() as db:
        saved = await db.get(WorkoutRecord, UUID(row["id"]))
        saved.content = {**saved.content, "source_url": "https://example.test/new"}
        await refresh_source_metadata(db, saved)
        await db.commit()
    response = await api.client.get(
        PREFIX + "/library/duplicate-sources",
        params={"source_url": "https://youtu.be/abcdefghi12"},
        headers=GENERATION,
    )
    assert response.json()["matches"] == []
    assert source_key("http://example.test/new?utm_campaign=a") == source_key(
        "https://example.test/new"
    )


async def test_duplicate_independent_version_receipt_and_removed_copy_tombstone(organization_api):
    api = organization_api
    row = await create(api)
    collection = await make_collection(api)
    await change(
        api, row, tags=["Run"], collection_ids=[collection["id"]], favorite=True, archived=True
    )
    payload = {"request_id": str(uuid4()), "expected_revision": 1, "title": "Independent copy"}
    path = f"{PREFIX}/library/{row['id']}/duplicate"
    response = await api.client.post(path, json=payload, headers=GENERATION)
    assert response.status_code == 201, response.text
    copied = response.json()
    assert copied["id"] != row["id"] and copied["content"]["id"] == copied["id"]
    assert copied["content"]["version"] == 1 and copied["content"]["parent_version_id"] is None
    assert copied["organization"]["tags"] == ["Run"]
    assert copied["organization"]["collection_ids"] == [collection["id"]]
    assert not copied["organization"]["archived"] and not copied["organization"]["favorite"]
    assert copied["organization"]["duplicate_of_workout_id"] == row["id"]
    assert (await api.client.post(path, json=payload, headers=GENERATION)).status_code == 200
    assert (
        await api.client.post(path, json={**payload, "title": "Different"}, headers=GENERATION)
    ).status_code == 409
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutVersion)) == 2
    # Original removal leaves both the independent copy and provenance intact.
    assert (
        await api.client.delete(f"{PREFIX}/library/{row['id']}", headers=GENERATION)
    ).status_code == 204
    assert (await api.client.post(path, json=payload, headers=GENERATION)).status_code == 200
    assert (
        await api.client.delete(f"{PREFIX}/library/{copied['id']}", headers=GENERATION)
    ).status_code == 204
    assert (await api.client.post(path, json=payload, headers=GENERATION)).status_code == 410


async def test_duplicate_revision_and_generation_fences(organization_api):
    api = organization_api
    row = await create(api)
    path = f"{PREFIX}/library/{row['id']}/duplicate"
    request = {"request_id": str(uuid4()), "expected_revision": 99}
    assert (await api.client.post(path, json=request, headers=GENERATION)).status_code == 409
    assert (
        await api.client.post(
            path, json={**request, "expected_revision": 1}, headers={"X-Workouts-Generation": "2"}
        )
    ).status_code == 409
    await enroll(api, other=True)
    assert (
        await api.client.post(
            path,
            json={**request, "expected_revision": 1},
            headers={**GENERATION, "X-Test-User": "other"},
        )
    ).status_code == 404


async def test_hard_removal_cascades_metadata_but_retains_actual_snapshot(organization_api):
    api = organization_api
    row = await create(api)
    collection = await make_collection(api)
    await change(api, row, tags=["Run"], collection_ids=[collection["id"]])
    response = await api.client.post(
        PREFIX + "/sessions", json=session_payload(row), headers=GENERATION
    )
    assert response.status_code == 201
    snapshot = response.json()["content"]
    assert (
        await api.client.delete(f"{PREFIX}/library/{row['id']}", headers=GENERATION)
    ).status_code == 204
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutLibraryOrganization)) == 0
        assert (
            await db.scalar(select(func.count()).select_from(WorkoutLibraryCollectionMember)) == 0
        )
        assert await db.scalar(select(func.count()).select_from(WorkoutVersion)) == 0
        assert (await db.scalar(select(WorkoutsSession))).content == snapshot
        assert await db.scalar(select(func.count()).select_from(WorkoutLibraryCollection)) == 1


async def test_export_product_cleanup_and_account_cascade(organization_api):
    api = organization_api
    row = await create(api)
    collection = await make_collection(api)
    await change(api, row, tags=["Run"], collection_ids=[collection["id"]])
    await api.client.post(
        f"{PREFIX}/library/{row['id']}/duplicate",
        json={"request_id": str(uuid4()), "expected_revision": 1},
        headers=GENERATION,
    )
    async with api.sessions() as db:
        exported = await organization_export_page(db, "owner", 1, limit=1)
        assert exported["library_organization"]["has_more"]
        assert "source_key" not in str(exported) and "request_hash" not in str(exported)
        await membership_for(db, "owner", generation=1, write=True)
        await erase_library_organization(db, "owner")
        await db.commit()
    async with api.sessions() as db:
        for table in ORGANIZATION_TABLES:
            assert await db.scalar(select(func.count()).select_from(table)) == 0
    await change(api, row, favorite=True)
    await make_collection(api)
    async with api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
    async with api.sessions() as db:
        for table in ORGANIZATION_TABLES:
            assert await db.scalar(select(func.count()).select_from(table)) == 0


async def test_migration_backfill_rerun_preserves_metadata_and_core_ledger(organization_api):
    api = organization_api
    row = await create(api, source_url="https://example.test/workout")
    await change(api, row, tags=["Run"], favorite=True)
    async with api.engine.begin() as connection:
        await migration.install_organization_schema(connection)
    assert (await metadata(api, row))["tags"] == ["Run"]
    async with api.sessions() as db:
        indexed = await db.get(WorkoutLibraryOrganization, UUID(row["id"]))
        assert indexed.source_key == source_key(row["content"]["source_url"])
        assert (await db.scalars(text("SELECT version FROM schema_migrations"))).all() == [33]
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await verify_organization_schema(api.engine, settings())


async def test_optional_runtime_and_restore_point_gate(organization_api, monkeypatch):
    class NoDatabase:
        def begin(self):
            raise AssertionError("Disabled Workouts must not connect")

        def connect(self):
            raise AssertionError("Disabled Workouts must not connect")

    disabled = SimpleNamespace(workouts_api_enabled=False)
    await migration.run_migration(configured=disabled, migration_engine=NoDatabase())
    await verify_organization_schema(NoDatabase(), disabled)
    async with organization_api.engine.begin() as connection:
        await connection.execute(text("DELETE FROM workouts_schema_migrations WHERE version=38"))
    monkeypatch.delenv("MIGRATION_038_RESTORE_POINT", raising=False)
    production = SimpleNamespace(
        workouts_api_enabled=True, environment="production", app_release_id="fixture"
    )
    with pytest.raises(RuntimeError, match="verified restore point"):
        await migration.run_migration(
            configured=production, migration_engine=organization_api.engine
        )
    with pytest.raises(RuntimeError, match="migration038"):
        await verify_organization_schema(organization_api.engine, settings())


async def test_duplicate_receipt_database_immutable_and_metadata_fences(organization_api):
    api = organization_api
    row = await create(api)
    await api.client.post(
        f"{PREFIX}/library/{row['id']}/duplicate",
        json={"request_id": str(uuid4()), "expected_revision": 1},
        headers=GENERATION,
    )
    async with api.sessions() as db:
        receipt = await db.scalar(select(WorkoutLibraryDuplicateReceipt))
        receipt.request_hash = "0" * 64
        with pytest.raises(DBAPIError, match="immutable"):
            await db.commit()
    async with api.sessions() as db:
        db.add(
            WorkoutLibraryOrganization(
                workout_id=UUID(row["id"]),
                app_user_id="other",
                generation=1,
                revision=1,
                tags=[],
                tag_keys=[],
                favorite=False,
                archived=False,
            )
        )
        with pytest.raises(IntegrityError):
            await db.commit()


async def test_equipment_kind_and_invalid_source_queries(organization_api):
    api = organization_api
    row = await create(api)
    async with api.sessions() as db:
        record = await db.get(WorkoutRecord, UUID(row["id"]))
        record.content = {**record.content, "equipment_required": ["Dumbbells"], "kind": "session"}
        await db.commit()
    assert (await search(api, equipment="dumbbell", kind="session"))["total"] == 1
    assert (await search(api, equipment="barbell"))["total"] == 0
    assert (await search(api, kind="exercise"))["total"] == 0
    for url in [
        "https://[broken",
        "https://example.test:invalid/path",
        "https://name:password@example.test/path",
    ]:
        response = await api.client.get(
            PREFIX + "/library/duplicate-sources", params={"source_url": url}, headers=GENERATION
        )
        assert response.status_code == 422


async def test_readiness_detects_missing_owner_cascade_and_immutable_trigger(organization_api):
    api = organization_api
    async with api.engine.begin() as connection:
        await connection.execute(
            text("DROP TRIGGER immutable_workouts_duplicate ON workouts_library_duplicate_receipts")
        )
    with pytest.raises(RuntimeError, match="immutable"):
        await verify_organization_schema(api.engine, settings())
    async with api.engine.begin() as connection:
        await migration.install_organization_schema(connection)
        name = await connection.scalar(
            text("""
            SELECT conname FROM pg_constraint WHERE
            conrelid='workouts_library_collections'::regclass AND contype='f'
            AND confrelid='app_users'::regclass
        """)
        )
        await connection.execute(
            text(
                'ALTER TABLE workouts_library_collections DROP CONSTRAINT "'
                + name.replace('"', '""')
                + '"'
            )
        )
    with pytest.raises(RuntimeError, match="owner deletion cascade"):
        await verify_organization_schema(api.engine, settings())


async def test_duplicate_concurrent_replay_and_no_organization_copy(organization_api):
    api = organization_api
    row = await create(api)
    await change(api, row, tags=["Strength"], favorite=True)
    payload = {"request_id": str(uuid4()), "expected_revision": 1, "copy_organization": False}
    path = f"{PREFIX}/library/{row['id']}/duplicate"
    responses = await asyncio.gather(
        *[api.client.post(path, json=payload, headers=GENERATION) for _ in range(2)]
    )
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert len({response.json()["id"] for response in responses}) == 1
    organization = responses[0].json()["organization"]
    assert organization["tags"] == [] and organization["collection_ids"] == []
    assert not organization["favorite"]
    async with api.sessions() as db:
        assert (
            await db.scalar(select(func.count()).select_from(WorkoutLibraryDuplicateReceipt)) == 1
        )
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 2

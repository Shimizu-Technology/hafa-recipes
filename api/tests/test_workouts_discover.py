"""Public Discover: optional 045 rollout, allow-listed projection, publish rules,
dedupe, save, moderation and erasure, against real PostgreSQL."""

import importlib
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, text, update

from app.auth import get_current_user
from app.domains.workouts import automation_router, discover, security
from app.domains.workouts.discover import verify_discover_schema
from app.domains.workouts.optional_runtime import verify_optional_workouts_schema
from app.models.identity import AppUser
from app.models.moderation import AdminAuditEvent, ContentReport
from app.moderation import require_admin
from app.routers import community_safety
from app.routers.users import delete_account
from tests.test_workouts_automation_integration import (  # noqa: F401
    automation_api,
    consent,
    enqueue,
)
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    GENERATION,
    data_api,
    enroll,
    settings,
    user,
)
from tests.test_workouts_export_assembly import assembled_exports  # noqa: F401
from tests.test_workouts_optional_chain import legacy_columns

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration035 = importlib.import_module("migrations.035_add_workouts_automation")
migration045 = importlib.import_module("migrations.045_add_workouts_discover")
OTHER = {"X-Test-User": "other"}
PRIVATE_NOTE = "private knee note 7c1f"
SOURCE = "https://www.youtube.com/watch?v=abcDEF12345&si=tracking"
REEL = {
    "title": "Ten minute legs",
    "kind": "session",
    "provenance": "source",
    "capture_kind": "url",
    "source_url": SOURCE,
    "source_creator": "Coach Nani",
    "equipment_required": ["Dumbbell"],
    "estimated_minutes": 10,
    "notes": [PRIVATE_NOTE],
    "blocks": [
        {
            "id": "main",
            "label": "Main circuit",
            "rounds": 3,
            "evidence": [{"field": "rounds", "wording": PRIVATE_NOTE}],
            "exercises": [
                {
                    "name": "Goblet squat",
                    "provenance": "source",
                    "sets": 3,
                    "reps_min": 12,
                    "reps_max": 12,
                    "rest_seconds": 45,
                    "effort": PRIVATE_NOTE,
                    "notes": PRIVATE_NOTE,
                    "exercise_id": "private-integration-ref",
                    "evidence": [{"field": "name", "wording": PRIVATE_NOTE}],
                }
            ],
        }
    ],
}
CARD_KEYS = {
    "id", "title", "kind", "estimated_minutes", "equipment_required", "equipment_optional",
    "block_count", "exercise_count", "source_url", "source_platform", "source_creator",
    "thumbnail_url", "published_at", "contributor", "is_owner", "saved_workout_id",
}  # fmt: skip
WORKOUT_KEYS = {
    "id", "version", "parent_version_id", "title", "kind", "provenance", "blocks", "source_url",
    "capture_kind", "source_creator", "source_title", "equipment_required", "equipment_optional",
    "estimated_minutes", "notes",
}  # fmt: skip
BLOCK_KEYS = {
    "id",
    "label",
    "grouping",
    "rounds",
    "rest_between_rounds_seconds",
    "exercises",
    "evidence",
}
EXERCISE_KEYS = {
    "exercise_id", "name", "provenance", "sets", "reps_min", "reps_max", "per_side",
    "duration_seconds", "distance_meters", "rest_seconds", "tempo", "load", "load_unit",
    "load_convention", "effort", "notes", "evidence",
}  # fmt: skip


def mount(api):
    api.app.include_router(discover.router)
    api.app.include_router(discover.admin_router)
    api.app.include_router(community_safety.router)


async def accept_disclosure(api, *owners):
    async with api.sessions.begin() as db:
        await db.execute(
            update(AppUser).where(AppUser.id.in_(owners)).values(publishing_disclosure_version=1)
        )


@pytest.fixture
async def discover_api(data_api):  # noqa: F811
    await migration035.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration045.run_migration(configured=settings(), migration_engine=data_api.engine)
    mount(data_api)
    await enroll(data_api)
    await enroll(data_api, other=True)
    await accept_disclosure(data_api, "owner", "other")
    return data_api


async def save(api, workout, headers=None):
    response = await api.client.post(
        "/api/v1/workouts/library", json=workout, headers=GENERATION | (headers or {})
    )
    assert response.status_code == 201, response.text
    return response.json()


async def publish(api, workout_id, headers=None, action="publish"):
    return await api.client.post(
        f"/api/v1/workouts/library/{workout_id}/{action}", headers=GENERATION | (headers or {})
    )


async def feed(api, query="", headers=OTHER):
    response = await api.client.get("/api/v1/workouts/discover" + query, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def published_reel(api, workout=REEL, headers=None):
    row = await save(api, workout, headers)
    response = await publish(api, row["id"], headers)
    assert response.status_code == 200, response.text
    return row


async def test_code_runs_without_045_and_reports_discover_unavailable(assembled_exports):  # noqa: F811
    api = assembled_exports
    mount(api)
    configured = settings()
    # Startup readiness at 044 succeeds; Discover is optional until applied.
    await verify_optional_workouts_schema(configured=configured, target_engine=api.engine)
    row = await save(api, REEL)
    listed = await api.client.get("/api/v1/workouts/library")
    assert listed.status_code == 200 and listed.json()[0]["publication"] is None
    edited = await api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**REEL, "title": "Edited"},
        headers=GENERATION,
    )
    assert edited.status_code == 200, edited.text
    for response in (
        await api.client.get("/api/v1/workouts/discover"),
        await api.client.get(f"/api/v1/workouts/discover/{row['id']}"),
        await publish(api, row["id"]),
    ):
        assert response.status_code == 503 and "not available" in response.json()["detail"]


async def test_capability_flag_follows_045(automation_api, monkeypatch):  # noqa: F811
    capabilities = await automation_api.client.get("/api/v1/workouts/capabilities")
    assert capabilities.json()["discover"] is False
    await migration045.run_migration(configured=settings(), migration_engine=automation_api.engine)
    capabilities = await automation_api.client.get("/api/v1/workouts/capabilities")
    assert capabilities.json()["discover"] is True


async def test_045_rolls_forward_on_populated_044_database_and_replays(assembled_exports):  # noqa: F811
    api = assembled_exports
    row = await save(api, REEL)
    before = await legacy_columns(api.engine)
    for _ in range(2):
        await migration045.run_migration(configured=settings(), migration_engine=api.engine)
    assert await legacy_columns(api.engine) == before
    await verify_optional_workouts_schema(configured=settings(), target_engine=api.engine)
    async with api.engine.connect() as connection:
        state = (
            await connection.execute(
                text("SELECT is_public,moderation_status,published_at FROM workouts_library")
            )
        ).one()
        assert tuple(state) == (False, "active", None)
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM workouts_schema_migrations WHERE version=45")
            )
            == 1
        )
    listed = await api.client.get(f"/api/v1/workouts/library/{row['id']}")
    assert listed.json()["publication"] == {
        "is_public": False,
        "moderation_status": "active",
        "published_at": None,
        "discover_visible": False,
    }


async def test_recorded_but_incomplete_045_fails_startup(discover_api):
    async with discover_api.engine.begin() as connection:
        await connection.execute(text("ALTER TABLE workouts_library DROP COLUMN source_platform"))
    with pytest.raises(RuntimeError, match="045"):
        await verify_discover_schema(discover_api.engine, settings())


async def test_production_045_requires_restore_point(data_api, monkeypatch):  # noqa: F811
    monkeypatch.delenv("MIGRATION_045_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="035 must precede"):
        await migration045.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration035.run_migration(configured=settings(), migration_engine=data_api.engine)
    with pytest.raises(RuntimeError, match="restore point"):
        await migration045.run_migration(
            configured=SimpleNamespace(
                workouts_api_enabled=True, environment="production", app_release_id=None
            ),
            migration_engine=data_api.engine,
        )


async def test_public_projection_is_an_allow_list():
    workout, incomplete = discover.public_workout(REEL)
    assert incomplete is False
    assert set(workout) <= WORKOUT_KEYS and workout["notes"] == []
    assert workout["blocks"][0]["label"] == "Main circuit"
    assert workout["source_creator"] == "Coach Nani"
    for block in workout["blocks"]:
        assert set(block) <= BLOCK_KEYS and block["evidence"] == []
        for exercise in block["exercises"]:
            assert set(exercise) <= EXERCISE_KEYS
            assert exercise["exercise_id"] is None and exercise["evidence"] == []
            assert exercise["notes"] is None and exercise["effort"] is None
    assert PRIVATE_NOTE not in json.dumps(workout)
    assert discover.source_identity(SOURCE) == ("youtube:video:abcDEF12345", "youtube")


async def test_feed_and_detail_responses_are_allow_listed(discover_api):
    api = discover_api
    row = await published_reel(api)
    page = await feed(api)
    assert page["total"] == 1 and set(page["items"][0]) == CARD_KEYS
    card = page["items"][0]
    assert card["source_platform"] == "youtube" and card["is_owner"] is False
    assert card["contributor"]["contributor_id"].startswith("chef_")
    detail = await api.client.get(f"/api/v1/workouts/discover/{row['id']}", headers=OTHER)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    workout = body["workout"]
    assert set(body) == CARD_KEYS | {"workout"}
    assert set(workout) <= WORKOUT_KEYS and workout["notes"] == []
    assert workout["blocks"][0]["label"] == "Main circuit"
    for block in workout["blocks"]:
        assert set(block) <= BLOCK_KEYS and block["evidence"] == []
        for exercise in block["exercises"]:
            assert set(exercise) <= EXERCISE_KEYS
            assert exercise["exercise_id"] is None and exercise["evidence"] == []
            assert exercise["notes"] is None and exercise["effort"] is None
    serialized = detail.text + json.dumps(page)
    for private in (PRIVATE_NOTE, '"owner"', "generation", "app_user_id", "user_distinct_subject"):
        assert private not in serialized


async def test_publishing_requires_disclosure_completeness_and_ownership(discover_api):
    api = discover_api
    async with api.sessions.begin() as db:
        await db.execute(
            update(AppUser).where(AppUser.id == "owner").values(publishing_disclosure_version=0)
        )
    row = await save(api, REEL)
    assert (await publish(api, row["id"])).status_code == 409
    await accept_disclosure(api, "owner")
    assert (await publish(api, row["id"], OTHER)).status_code == 404
    incomplete = {
        **REEL,
        "blocks": [{"id": "b", "label": "B", "exercises": [{"name": "Plank hold"}]}],
    }
    draft = await save(api, incomplete)
    response = await publish(api, draft["id"])
    assert response.status_code == 422 and "reps, time or distance" in response.text
    state = (await publish(api, row["id"])).json()
    assert state["is_public"] and state["discover_visible"] and state["published_at"]
    # An edit that removes the dose unpublishes instead of exposing a draft.
    edited = await api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json=incomplete,
        headers=GENERATION,
    )
    assert edited.status_code == 200 and edited.json()["publication"]["is_public"] is False
    assert (await feed(api))["total"] == 0
    unpublished = await publish(api, draft["id"], action="unpublish")
    assert unpublished.status_code == 200 and unpublished.json()["published_at"] is None


async def test_dedupe_save_and_filters(discover_api):
    api = discover_api
    first = await published_reel(api)
    # Same video, different URL form: the importer keeps a private copy, the
    # feed keeps the earliest card, and the duplicate stays readable by id.
    duplicate = await published_reel(
        api, {**REEL, "source_url": "https://youtu.be/abcDEF12345"}, OTHER
    )
    page = await feed(api, headers={})
    assert page["total"] == 1 and page["items"][0]["id"] == first["id"]
    assert (await api.client.get(f"/api/v1/workouts/discover/{duplicate['id']}")).status_code == 200
    bodyweight = {
        **REEL,
        "title": "Couch core",
        "source_url": None,
        "provenance": "user",
        "capture_kind": None,
        "equipment_required": [],
        "estimated_minutes": 25,
        "blocks": [
            {
                **REEL["blocks"][0],
                "exercises": [{**REEL["blocks"][0]["exercises"][0], "provenance": "user"}],
            }
        ],
    }
    await published_reel(api, bodyweight)
    assert (await feed(api))["total"] == 2
    for query, expected in (
        ("?q=goblet", 2),
        ("?q=COUCH", 1),
        ("?q=%25", 0),
        ("?equipment=dumbbell", 1),
        ("?equipment=Dumbbells", 1),
        ("?equipment=kettlebell", 0),
        ("?equipment=none", 1),
        ("?platform=youtube", 1),
        ("?min_minutes=20", 1),
        ("?max_minutes=10", 1),
        ("?limit=1", 2),
    ):
        assert (await feed(api, query))["total"] == expected, query
    assert (await feed(api, "?limit=1"))["has_more"] is True

    path = f"/api/v1/workouts/discover/{first['id']}/save"
    saved = await api.client.post(path, headers=GENERATION | OTHER)
    assert saved.status_code == 201, saved.text
    copy = saved.json()
    assert copy["id"] != first["id"] and copy["content"]["notes"] == []
    assert copy["publication"]["is_public"] is False
    assert PRIVATE_NOTE not in saved.text
    replay = await api.client.post(path, headers=GENERATION | OTHER)
    assert replay.status_code == 200 and replay.json()["id"] == copy["id"]
    assert (await api.client.post(path, headers=GENERATION)).status_code == 409
    cards = {item["id"]: item for item in (await feed(api))["items"]}
    assert cards[first["id"]]["saved_workout_id"] == copy["id"]


async def test_moderation_blocks_reports_and_hidden_users(discover_api):
    api = discover_api
    row = await published_reel(api)
    report = await api.client.post(
        f"/api/v1/workouts/discover/{row['id']}/report",
        json={"category": "spam", "details": "Not a workout"},
        headers=OTHER,
    )
    assert report.status_code == 201, report.text
    async with api.sessions() as db:
        stored = await db.scalar(select(ContentReport))
        assert stored.target_type == "contributor" and stored.target_user_id == "owner"
        assert stored.details.startswith(f"Workouts Discover {row['id']}")

    blocked = await api.client.post(f"/api/v1/workouts/discover/{row['id']}/block", headers=OTHER)
    assert blocked.status_code == 201
    assert (await feed(api))["total"] == 0 and (await feed(api, headers={}))["total"] == 1
    unblocked = await api.client.delete(
        f"/api/blocks/{blocked.json()['contributor_id']}", headers=OTHER
    )
    assert unblocked.status_code == 204 and (await feed(api))["total"] == 1

    api.app.dependency_overrides[require_admin] = lambda: user("moderator")
    path = f"/api/v1/workouts/admin/discover/{row['id']}/moderation"
    hidden = await api.client.put(path, json={"moderation_status": "hidden", "reason": "spam"})
    assert hidden.status_code == 200 and hidden.json()["moderation_status"] == "hidden"
    assert (await feed(api))["total"] == 0
    owner_view = await api.client.get(f"/api/v1/workouts/library/{row['id']}")
    assert owner_view.json()["publication"]["discover_visible"] is False
    listed = await api.client.get("/api/v1/workouts/admin/discover?moderation_status=hidden")
    assert [item["id"] for item in listed.json()] == [row["id"]]
    await api.client.put(path, json={"moderation_status": "active", "reason": "appeal ok"})
    private = await save(api, REEL)
    assert (
        await api.client.put(
            f"/api/v1/workouts/admin/discover/{private['id']}/moderation",
            json={"moderation_status": "hidden", "reason": "private"},
        )
    ).status_code == 404
    async with api.sessions.begin() as db:
        assert await db.scalar(select(func.count()).select_from(AdminAuditEvent)) == 2
        await db.execute(
            update(AppUser).where(AppUser.id == "owner").values(moderation_status="hidden")
        )
    assert (await feed(api))["total"] == 0


async def test_discover_follows_tester_gate(discover_api, monkeypatch):
    await published_reel(discover_api)
    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: settings().model_copy(
            update={"workouts_public_access_enabled": False, "workouts_tester_user_ids": "owner"}
        ),
    )
    assert (
        await discover_api.client.get("/api/v1/workouts/discover", headers=OTHER)
    ).status_code == 403
    assert (await discover_api.client.get("/api/v1/workouts/discover")).status_code == 200
    del discover_api.app.dependency_overrides[get_current_user]
    assert (await discover_api.client.get("/api/v1/workouts/discover")).status_code in {401, 403}


async def test_data_and_account_deletion_remove_public_workouts(discover_api):
    api = discover_api
    public = text("SELECT count(*) FROM workouts_library WHERE is_public")
    await published_reel(api)
    erased = await api.client.request("DELETE", "/api/v1/workouts/data", headers=GENERATION)
    assert erased.status_code == 200 and (await feed(api))["total"] == 0
    await published_reel(api, headers=OTHER)
    async with api.sessions() as db:
        assert await db.scalar(public) == 1
        await delete_account(db=db, user=user("other"))
    async with api.sessions() as db:
        assert await db.scalar(public) == 0
    assert (await feed(api, headers={}))["total"] == 0


async def test_import_accept_can_request_public(automation_api, monkeypatch):  # noqa: F811
    api = automation_api
    await migration045.run_migration(configured=settings(), migration_engine=api.engine)
    mount(api)
    await consent(api)
    job = (await enqueue(api)).json()
    await api.worker.tick()
    path = f"/api/v1/workouts/imports/{job['id']}/accept"
    assert (
        await api.client.post(path, headers=GENERATION, json={"is_public": True})
    ).status_code == 409
    await accept_disclosure(api, "owner")
    accepted = await api.client.post(path, headers=GENERATION, json={"is_public": True})
    assert accepted.status_code == 200, accepted.text
    state = await api.client.get(f"/api/v1/workouts/library/{accepted.json()['id']}")
    assert state.json()["publication"]["is_public"] is True
    private_job = (await enqueue(api)).json()
    await api.worker.tick()
    private = await api.client.post(
        f"/api/v1/workouts/imports/{private_job['id']}/accept", headers=GENERATION, json={}
    )
    listed = await api.client.get(f"/api/v1/workouts/library/{private.json()['id']}")
    assert listed.json()["publication"]["is_public"] is False
    assert automation_router.AcceptImport().is_public is False


async def test_045_retry_completes_a_committed_first_phase(data_api):  # noqa: F811
    await migration035.run_migration(configured=settings(), migration_engine=data_api.engine)
    async with data_api.engine.begin() as connection:
        await connection.execute(text(migration045.COLUMNS))
        await connection.execute(
            text(
                "ALTER TABLE workouts_library ADD CONSTRAINT ck_workouts_library_moderation_status"
                " CHECK (moderation_status IN ('active','hidden')) NOT VALID"
            )
        )
    await migration045.run_migration(configured=settings(), migration_engine=data_api.engine)
    await verify_discover_schema(data_api.engine, settings())
    async with data_api.engine.connect() as connection:
        assert await connection.scalar(
            text(
                "SELECT bool_and(convalidated) FROM pg_constraint WHERE conname LIKE 'ck_workouts_library_%'"
            )
        )


async def prepare_test_source_cover(
    api, monkeypatch, *, kind="url", fail_upload=False, hold_upload=None
):
    from uuid import uuid4

    import app.services.storage as storage_module
    from app.domains.workouts import source_media
    from app.domains.workouts.automation_models import WorkoutImport
    from app.domains.workouts.lifecycle import now
    from app.domains.workouts.models import WorkoutsConsent
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob
    from app.services.storage import StorageService
    from tests.test_storage import ReadableS3, _png_bytes

    await importlib.import_module("migrations.047_add_workouts_source_media").run_migration(
        configured=settings(), migration_engine=api.engine
    )
    monkeypatch.setattr(
        storage_module,
        "get_settings",
        lambda: SimpleNamespace(
            s3_enabled=True,
            s3_bucket_name="recipe-images",
            aws_region="us-west-2",
            recipe_media_base_url=None,
        ),
    )
    store = StorageService()
    store._client = ReadableS3(_png_bytes("red"))
    store._workouts_thumbnail_client = store._client
    if fail_upload:
        put = store._client.put_object

        def fail_second_variant(**kwargs):
            if store._client.puts:
                raise RuntimeError("synthetic partial upload failure")
            put(**kwargs)

        store._client.put_object = fail_second_variant
    downloads = []

    async def download(url):
        downloads.append(url)
        return _png_bytes("red"), "image/png"

    store._download_public_url = download
    original = store.store_prepared_workouts_thumbnail_variants_locked

    async def registered_before_upload(variants, namespace):
        async with api.sessions() as db:
            media = await db.get(
                WorkoutSourceMedia, source_media.UUID(namespace.removeprefix("workouts-"))
            )
            assert media is not None and media.canonical_url is None
            guard = await db.get(DeletionCleanupJob, media.cleanup_job_id)
            assert guard.status == "queued" and guard.storage_prefixes == [
                source_media.asset_prefix(media.id)
            ]
        if hold_upload:
            hold_upload[0].set()
            await hold_upload[1].wait()
        return await original(variants, namespace)

    store.store_prepared_workouts_thumbnail_variants_locked = registered_before_upload
    monkeypatch.setattr(source_media, "storage_service", store)
    monkeypatch.setattr(source_media, "AsyncSessionLocal", api.sessions)
    identifier, accepted = uuid4(), now()
    async with api.sessions.begin() as db:
        db.add(
            WorkoutsConsent(
                app_user_id="owner", generation=1, disclosure_version=1, accepted_at=accepted
            )
        )
        db.add(
            WorkoutImport(
                id=identifier,
                app_user_id="owner",
                generation=1,
                request_id=uuid4(),
                request_hash="a" * 64,
                status="processing",
                payload={"kind": kind},
                ai_accepted_at=accepted,
                expires_at=accepted + source_media.timedelta(hours=24),
            )
        )
    url = await source_media.prepare_source_cover(
        api.sessions,
        "owner",
        1,
        identifier,
        "https://public.example/cover.jpg",
        expected_ai_accepted_at=accepted,
    )
    return url, identifier, store, downloads


async def uploaded_cover_fixture(api, monkeypatch):
    from app.domains.workouts import cover_upload

    url, _, store, _ = await prepare_test_source_cover(api, monkeypatch)
    api.app.include_router(automation_router.imports_router)
    api.app.include_router(automation_router.router)
    monkeypatch.setattr(cover_upload, "storage_service", store)
    monkeypatch.setattr(cover_upload, "AsyncSessionLocal", api.sessions)
    created = await api.client.post("/api/v1/workouts/library", headers=GENERATION,
                                    json={**REEL, "source_thumbnail_url": url})
    assert created.status_code == 201, created.text
    return created.json(), store


async def upload_cover(api, row, key, *, data=None, revision=None, headers=None):
    from tests.test_storage import _png_bytes

    return await api.client.post(
        f"/api/v1/workouts/library/{row['id']}/cover",
        params={"expected_revision": revision or row["revision"]},
        headers={**GENERATION, "Idempotency-Key": str(key), **(headers or {})},
        files={"image": ("cover.png", data if data is not None else _png_bytes("blue"), "image/png")},
    )


async def test_cover_upload_optional048_preserves_047_readers_and_requires_restore(
    discover_api, assembled_exports, monkeypatch  # noqa: F811
):
    from uuid import uuid4

    from app.domains.workouts import cover_upload
    from app.domains.workouts.source_media_models import WorkoutSourceMedia

    row, store = await uploaded_cover_fixture(discover_api, monkeypatch)
    capability = await discover_api.client.get("/api/v1/workouts/capabilities")
    assert capability.json()["cover_upload"] is False
    assert (await upload_cover(discover_api, row, uuid4())).status_code == 503
    await verify_optional_workouts_schema(configured=settings(), target_engine=discover_api.engine)
    # New application code uses only old mapped columns before migration048.
    async with discover_api.sessions() as db:
        assert (await db.scalars(select(WorkoutSourceMedia))).all()
        assert not await cover_upload.upload_ready(db)
    migration048 = importlib.import_module("migrations.048_add_workouts_cover_upload")
    monkeypatch.delenv("MIGRATION_048_RESTORE_POINT", raising=False)
    configured = settings().model_copy(update={"environment": "production"})
    with pytest.raises(RuntimeError, match="verified restore point"):
        await migration048.run_migration(configured=configured, migration_engine=discover_api.engine)
    await migration048.run_migration(configured=settings(), migration_engine=discover_api.engine)
    await migration048.run_migration(configured=configured, migration_engine=discover_api.engine)
    capability = await discover_api.client.get("/api/v1/workouts/capabilities")
    assert capability.json()["cover_upload"] is True
    # Widened CHECK still rejects arbitrary purposes and uploads missing frozen metadata.
    for purpose in ("upload", "invalid"):
        async with discover_api.sessions() as db:
            from sqlalchemy.exc import IntegrityError

            with pytest.raises(IntegrityError):
                await db.execute(text("""INSERT INTO workouts_source_media
                    (id,app_user_id,generation,source_id,purpose)
                    VALUES(:id,'owner',1,:source,:purpose)"""),
                    {"id": uuid4(), "source": uuid4(), "purpose": purpose})
    assert len(store._client.puts) == 2  # Only original test cover was written.


async def test_upload_cover_versions_replay_frozen_request_and_preserve_private_credit(discover_api, monkeypatch):
    from uuid import uuid4

    from tests.test_storage import _png_bytes

    row, store = await uploaded_cover_fixture(discover_api, monkeypatch)
    await importlib.import_module("migrations.048_add_workouts_cover_upload").run_migration(
        configured=settings(), migration_engine=discover_api.engine)
    from copy import deepcopy
    from uuid import UUID

    from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
    # Server-owned source context and unknown historical JSON must stay exact.
    async with discover_api.sessions() as db:
        saved = await db.get(WorkoutRecord, UUID(row["id"]))
        saved.content = {**saved.content,
            "instructions": ["Complete the source circuit."],
            "source_context": {"parts": [{"location": "caption", "text": "PRIVATE RAW SOURCE"}]}}
        initial = await db.scalar(select(WorkoutVersion).where(WorkoutVersion.workout_id == saved.id))
        initial.content = deepcopy(saved.content)
        await db.commit()
        row["content"] = deepcopy(saved.content)
    key = uuid4()
    response = await upload_cover(discover_api, row, key)
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["revision"] == 2 and updated["content"]["cover_origin"] == "user"
    content = updated["content"]
    for field in ("source_url", "source_title", "source_creator", "notes", "blocks", "instructions", "source_context"):
        assert content[field] == row["content"][field]
    assert content["source_thumbnail_url"] != row["content"]["source_thumbnail_url"]
    writes = len(store._client.puts)
    replay = await upload_cover(discover_api, row, key)
    assert replay.status_code == 200 and replay.json()["revision"] == 2
    assert len(store._client.puts) == writes
    changed = await upload_cover(discover_api, row, key, data=_png_bytes("green"))
    assert changed.status_code == 409
    assert (await upload_cover(discover_api, row, key, revision=2)).status_code == 409
    assert (await upload_cover(discover_api, row, uuid4())).status_code == 409
    versions = (await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}/versions")).json()
    assert len(versions) == 2
    assert versions[1]["content"]["source_thumbnail_url"] == row["content"]["source_thumbnail_url"]
    assert "cover_origin" not in versions[1]["content"]
    # Old mobile omitted the new marker: save keeps the cover and honest origin.
    old_content = {k: v for k, v in content.items() if k not in {
        "id", "version", "parent_version_id", "cover_origin", "source_thumbnail_url"}}
    edited = await discover_api.client.put(f"/api/v1/workouts/library/{row['id']}?expected_revision=2",
                                           json=old_content, headers=GENERATION)
    assert edited.status_code == 200, edited.text
    assert edited.json()["content"]["cover_origin"] == "user"
    replay = await upload_cover(discover_api, row, key)
    assert replay.status_code == 200 and replay.json()["revision"] == 3
    assert len((await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}/versions")).json()) == 3
    public, _ = discover.public_workout(edited.json()["content"])
    assert public["cover_origin"] == "user" and public["notes"] == []
    assert "source_context" not in public
    async with discover_api.sessions() as db:
        historical = await db.get(WorkoutVersion, UUID(versions[0]["id"]))
        historical.content = {**historical.content, "future_server_field": {"keep": True}}
        await db.commit()
    before_restore = (await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}/versions")).json()
    restored = await discover_api.client.post(
        f"/api/v1/workouts/library/{row['id']}/versions/{versions[0]['id']}/restore?expected_revision=3",
        headers=GENERATION)
    assert restored.status_code == 200, restored.text
    assert restored.json()["content"]["source_context"] == content["source_context"]
    assert restored.json()["content"]["instructions"] == content["instructions"]
    assert restored.json()["content"]["source_thumbnail_url"] == content["source_thumbnail_url"]
    assert restored.json()["content"]["cover_origin"] == "user"
    assert restored.json()["content"]["future_server_field"] == {"keep": True}
    assert (await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}/versions")).json()[1:] == before_restore


async def test_upload_cover_rejects_enlarged_content_without_losing_original_or_cleanup(discover_api, monkeypatch):
    import math
    from uuid import uuid4

    from app.domains.workouts import source_media
    from app.domains.workouts.router import bounded_content
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    row, store = await uploaded_cover_fixture(discover_api, monkeypatch)
    await importlib.import_module("migrations.048_add_workouts_cover_upload").run_migration(
        configured=settings(), migration_engine=discover_api.engine)
    versions_path = f"/api/v1/workouts/library/{row['id']}/versions"
    original_version = (await discover_api.client.get(versions_path)).json()[0]
    candidate = {**row["content"], "version": 2, "parent_version_id": original_version["id"], "notes": []}
    def size():
        return len(json.dumps(candidate, ensure_ascii=False).encode())
    target = 240 * 1024 - 8
    candidate["notes"] = [""] * math.ceil((target - size() + 2) / 4004)
    remaining = target - size()
    for index in range(len(candidate["notes"])):
        count = min(4000, remaining)
        candidate["notes"][index] = "x" * count
        remaining -= count
    assert remaining == 0 and size() == target
    bounded_content(candidate)  # The existing, fully-versioned prescription is valid.
    payload = {key: value for key, value in candidate.items() if key not in {"id", "version", "parent_version_id"}}
    edited = await discover_api.client.put(f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
                                          json=payload, headers=GENERATION)
    assert edited.status_code == 200, edited.text
    row = edited.json()
    assert len(json.dumps(row["content"], ensure_ascii=False).encode()) == target
    before = (await discover_api.client.get(versions_path)).json()
    response = await upload_cover(discover_api, row, uuid4())
    assert response.status_code == 422 and "saved-record limit" in response.text
    assert (await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}")).json() == row
    assert (await discover_api.client.get(versions_path)).json() == before
    async with discover_api.sessions() as db:
        receipt = await db.scalar(select(WorkoutSourceMedia).where(WorkoutSourceMedia.purpose == "upload"))
        assert receipt and not receipt.retained and receipt.canonical_url is None
        cleanup = await db.get(DeletionCleanupJob, receipt.cleanup_job_id)
        assert cleanup.status == "queued"
        assert cleanup.storage_prefixes == [source_media.asset_prefix(receipt.id)]
        assert any(item["Key"].startswith(source_media.asset_prefix(receipt.id)) for item in store._client.puts)


async def test_upload_cover_bounds_owner_generation_and_spoofed_origin(discover_api, monkeypatch):
    from uuid import uuid4

    from app.domains.workouts.cover_upload import MAX_COVER_BYTES

    row, store = await uploaded_cover_fixture(discover_api, monkeypatch)
    await importlib.import_module("migrations.048_add_workouts_cover_upload").run_migration(
        configured=settings(), migration_engine=discover_api.engine)
    writes = len(store._client.puts)
    for payload in (b"not an image", b"x" * (MAX_COVER_BYTES + 1)):
        response = await upload_cover(discover_api, row, uuid4(), data=payload)
        assert response.status_code == 422, response.text
    assert (await upload_cover(discover_api, row, uuid4(), headers=OTHER)).status_code == 404
    assert (await upload_cover(discover_api, row, uuid4(), headers={"X-Workouts-Generation": "2"})).status_code == 409
    spoof = await discover_api.client.post("/api/v1/workouts/library", headers=GENERATION,
        json={**REEL, "source_thumbnail_url": row["content"]["source_thumbnail_url"], "cover_origin": "user"})
    assert spoof.status_code == 201, spoof.text
    assert "cover_origin" not in spoof.json()["content"]
    assert len(store._client.puts) == writes


async def test_upload_failure_has_durable_cleanup_and_retry_uses_one_version(discover_api, monkeypatch):
    from uuid import uuid4

    from app.domains.workouts import source_media
    from app.domains.workouts.models import WorkoutsConsent
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    row, store = await uploaded_cover_fixture(discover_api, monkeypatch)
    await importlib.import_module("migrations.048_add_workouts_cover_upload").run_migration(
        configured=settings(), migration_engine=discover_api.engine)
    async with discover_api.sessions.begin() as db:
        await db.delete(await db.get(WorkoutsConsent, "owner"))  # A photo needs no AI permission.
    writer = store.store_prepared_workouts_thumbnail_variants_locked
    namespaces = []

    async def fail_after_durable_write(variants, namespace):
        namespaces.append(namespace)
        await writer(variants, namespace)
        raise RuntimeError("synthetic lost storage acknowledgement")

    monkeypatch.setattr(store, "store_prepared_workouts_thumbnail_variants_locked", fail_after_durable_write)
    key = uuid4()
    with pytest.raises(RuntimeError, match="lost storage acknowledgement"):
        await upload_cover(discover_api, row, key)
    async with discover_api.sessions() as db:
        receipt = await db.scalar(select(WorkoutSourceMedia).where(WorkoutSourceMedia.purpose == "upload"))
        assert receipt and not receipt.retained and receipt.canonical_url is None
        identifier = receipt.id
        cleanup = await db.get(DeletionCleanupJob, receipt.cleanup_job_id)
        assert cleanup.status == "queued" and cleanup.storage_prefixes == [source_media.asset_prefix(identifier)]
    original = (await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}")).json()
    assert original == row
    monkeypatch.setattr(store, "store_prepared_workouts_thumbnail_variants_locked", writer)
    retried = await upload_cover(discover_api, row, key)
    assert retried.status_code == 200, retried.text
    assert source_media.asset_id(retried.json()["content"]["source_thumbnail_url"]) == identifier
    assert namespaces == [f"workouts-{identifier}"]
    async with discover_api.sessions() as db:
        receipt = await db.get(WorkoutSourceMedia, identifier)
        assert receipt.retained and receipt.canonical_url
        assert (await db.get(DeletionCleanupJob, receipt.cleanup_job_id)).status == "completed"
    assert len((await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}/versions")).json()) == 2


async def test_upload_rechecks_edit_before_apply_and_public_copy_preserves_origin(discover_api, monkeypatch):
    import asyncio
    from uuid import uuid4

    from app.domains.workouts import source_media
    from app.domains.workouts.source_media_models import WorkoutSourceMedia

    row, store = await uploaded_cover_fixture(discover_api, monkeypatch)
    await importlib.import_module("migrations.048_add_workouts_cover_upload").run_migration(
        configured=settings(), migration_engine=discover_api.engine)
    prepare = store.prepare_thumbnail_variants
    entered, release = asyncio.Event(), asyncio.Event()

    async def held_prepare(image):
        entered.set()
        await release.wait()
        return await prepare(image)

    monkeypatch.setattr(store, "prepare_thumbnail_variants", held_prepare)
    pending = asyncio.create_task(upload_cover(discover_api, row, uuid4()))
    await asyncio.wait_for(entered.wait(), timeout=5)
    try:
        edit = await discover_api.client.put(f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
                                             json={**REEL, "title": "Owner's newer edit"}, headers=GENERATION)
        assert edit.status_code == 200, edit.text
    finally:
        release.set()
    assert (await pending).status_code == 409
    async with discover_api.sessions() as db:
        receipt = await db.scalar(select(WorkoutSourceMedia).where(WorkoutSourceMedia.purpose == "upload"))
        assert receipt and receipt.canonical_url is None and not receipt.retained
    monkeypatch.setattr(store, "prepare_thumbnail_variants", prepare)
    uploaded = await upload_cover(discover_api, edit.json(), uuid4())
    assert uploaded.status_code == 200, uploaded.text
    await accept_disclosure(discover_api, "owner")
    assert (await publish(discover_api, row["id"])).status_code == 200
    copied = await discover_api.client.post(f"/api/v1/workouts/discover/{row['id']}/save", headers=GENERATION | OTHER)
    assert copied.status_code == 201, copied.text
    assert copied.json()["content"]["cover_origin"] == "user"
    assert copied.json()["content"]["source_creator"] == REEL["source_creator"]
    assert copied.json()["content"]["source_thumbnail_url"] != uploaded.json()["content"]["source_thumbnail_url"]
    async with discover_api.sessions() as db:
        identifier = source_media.asset_id(copied.json()["content"]["source_thumbnail_url"])
        assert (await db.get(WorkoutSourceMedia, identifier)).retained


async def test_public_cover_receipt_precedes_upload_and_product_erasure_is_exact(
    discover_api, monkeypatch
):
    from app.domains.workouts import source_media
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    before = await legacy_columns(discover_api.engine)
    url, _, store, _ = await prepare_test_source_cover(discover_api, monkeypatch)
    assert url and len(store._client.puts) == 2
    assert await legacy_columns(discover_api.engine) == before
    row = await save(discover_api, {**REEL, "source_thumbnail_url": url})
    assert row["content"]["source_thumbnail_url"] == url
    edited = await discover_api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        headers=GENERATION,
        json={**REEL, "title": "Edited by an older client"},
    )
    assert edited.status_code == 200 and edited.json()["content"]["source_thumbnail_url"] == url
    async with discover_api.sessions() as db:
        media = await db.get(WorkoutSourceMedia, source_media.asset_id(url))
        assert (
            media.retained
            and (await db.get(DeletionCleanupJob, media.cleanup_job_id)).status == "completed"
        )
    deleted = await discover_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert deleted.status_code == 200, deleted.text
    async with discover_api.sessions() as db:
        assert await db.get(WorkoutSourceMedia, source_media.asset_id(url)) is None
        jobs = (
            await db.scalars(
                select(DeletionCleanupJob).where(DeletionCleanupJob.kind == "workout_media")
            )
        ).all()
        assert any(
            job.storage_prefixes == [source_media.asset_prefix(source_media.asset_id(url))]
            for job in jobs
        )


async def test_restore_retains_historical_cover_and_refreshes_public_source_organization_and_export(discover_api, monkeypatch):
    from uuid import UUID

    from app.domains.workouts import source_media
    from app.domains.workouts.export_models import WorkoutsExportEpoch
    from app.domains.workouts.library_organization_models import WorkoutLibraryOrganization
    from app.domains.workouts.library_organization_service import source_key
    from app.domains.workouts.source_media_models import WorkoutSourceMedia

    api = discover_api
    for name in ("038_add_workouts_library_organization", "043_add_workouts_export_snapshots"):
        await importlib.import_module("migrations." + name).run_migration(configured=settings(), migration_engine=api.engine)
    url, _, store, _ = await prepare_test_source_cover(api, monkeypatch)
    row = await save(api, {**REEL, "source_thumbnail_url": url})
    assert (await publish(api, row["id"])).status_code == 200
    versions = f"/api/v1/workouts/library/{row['id']}/versions"
    original = (await api.client.get(versions)).json()[0]
    async with api.sessions.begin() as db:
        organization = await db.get(WorkoutLibraryOrganization, UUID(row["id"]))
        organization.favorite, organization.tags, organization.tag_keys = True, ["Keep"], ["keep"]
    changed = await api.client.put(f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
                                  json={**REEL, "source_url": "https://youtu.be/changed12345"}, headers=GENERATION)
    assert changed.status_code == 200 and "source_thumbnail_url" not in changed.json()["content"]
    async with api.sessions() as db:
        epoch = await db.get(WorkoutsExportEpoch, ("owner", 1))
        before_restore_epoch = epoch.revision if epoch else 0
    restored = await api.client.post(f"{versions}/{original['id']}/restore?expected_revision=2", headers=GENERATION)
    assert restored.status_code == 200, restored.text
    assert restored.json()["content"]["source_thumbnail_url"] == url
    assert restored.json()["organization"]["favorite"] and restored.json()["organization"]["tags"] == ["Keep"]
    assert (await feed(api))["items"][0]["source_url"] == SOURCE
    async with api.sessions() as db:
        assert (await db.get(WorkoutSourceMedia, source_media.asset_id(url))).retained
        assert (await db.get(WorkoutLibraryOrganization, UUID(row["id"]))).source_key == source_key(SOURCE)
        assert (await db.get(WorkoutsExportEpoch, ("owner", 1))).revision == before_restore_epoch + 1
    assert len(store._client.puts) == 2  # Restoring reuses the owned historical cover.


async def test_restoring_an_incomplete_version_removes_it_from_discover(discover_api):
    api = discover_api
    row = await save(api, {**REEL, "blocks": []})
    versions = f"/api/v1/workouts/library/{row['id']}/versions"
    original = (await api.client.get(versions)).json()[0]
    changed = await api.client.put(f"/api/v1/workouts/library/{row['id']}?expected_revision=1", json=REEL, headers=GENERATION)
    assert changed.status_code == 200
    assert (await publish(api, row["id"])).status_code == 200
    restored = await api.client.post(f"{versions}/{original['id']}/restore?expected_revision=2", headers=GENERATION)
    assert restored.status_code == 200 and not restored.json()["publication"]["is_public"]
    assert (await feed(api))["items"] == []


@pytest.mark.parametrize("kind,failed", [("images", False), ("url", True)])
async def test_private_capture_or_failed_upload_never_attaches_cover(
    discover_api, monkeypatch, kind, failed
):
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    url, import_id, store, downloads = await prepare_test_source_cover(
        discover_api, monkeypatch, kind=kind, fail_upload=failed
    )
    assert url is None and len(store._client.puts) == (1 if failed else 0)
    async with discover_api.sessions() as db:
        rows = (await db.scalars(select(WorkoutSourceMedia))).all()
        assert len(rows) == (1 if failed else 0)
        if failed:
            guard = await db.get(DeletionCleanupJob, rows[0].cleanup_job_id)
            assert guard.status == "queued" and guard.storage_prefixes
            assert rows[0].canonical_url is None
        else:
            assert downloads == []
    if failed:
        from app.domains.workouts.automation_models import WorkoutImport
        from app.domains.workouts.extraction import SourceMetadata, WorkoutExtractionResult
        from app.domains.workouts.imports import save_import_result
        from app.domains.workouts.models import WorkoutRecord
        from app.domains.workouts.schemas import WorkoutContent
        from app.domains.workouts.source_media import membership_for

        result = WorkoutExtractionResult(
            status="ready",
            workout=WorkoutContent.model_validate({**REEL, "source_title": "Original workout title"}),
            source=SourceMetadata(title="Original workout title", creator="Coach Nani", url=SOURCE),
        )
        original_source = result.source.model_dump()
        async with discover_api.sessions.begin() as db:
            await membership_for(db, "owner", generation=1, write=True)
            job = await db.get(WorkoutImport, import_id)
            await save_import_result(db, job, result, {"is_public": False})
            saved_id = job.accepted_workout_id
            assert saved_id and result.source.model_dump() == original_source
        async with discover_api.sessions() as db:
            saved = await db.get(WorkoutRecord, saved_id)
            assert saved.content["title"] == REEL["title"]
            assert saved.content["source_title"] == "Original workout title"
            assert saved.content["source_creator"] == "Coach Nani"
            assert saved.content["blocks"][0]["exercises"][0]["name"] == "Goblet squat"
            assert not saved.content.get("source_thumbnail_url")


async def test_unretained_import_cover_release_queues_cleanup(discover_api, monkeypatch):
    from app.domains.workouts import source_media
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    url, identifier, _, _ = await prepare_test_source_cover(discover_api, monkeypatch)
    async with discover_api.sessions.begin() as db:
        await source_media.membership_for(db, "owner", generation=1, write=True)
        await source_media.release_source_cover(db, "owner", 1, identifier)
    async with discover_api.sessions() as db:
        assert await db.get(WorkoutSourceMedia, source_media.asset_id(url)) is None
        jobs = (
            await db.scalars(
                select(DeletionCleanupJob).where(DeletionCleanupJob.kind == "workout_media")
            )
        ).all()
        assert any(
            job.next_attempt_at is None
            and job.storage_prefixes == [source_media.asset_prefix(source_media.asset_id(url))]
            for job in jobs
        )


async def test_047_widens_real019_cleanup_constraint_and_replays(discover_api, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    async with discover_api.engine.begin() as connection:
        await connection.execute(text("DROP TABLE deleted_auth_identities"))
        await connection.execute(text("DROP TABLE deletion_cleanup_jobs CASCADE"))
    migration019 = importlib.import_module("migrations.019_add_durable_deletion_cleanup")
    monkeypatch.setattr(migration019, "engine", discover_api.engine)
    await migration019.run_migration()
    migration047 = importlib.import_module("migrations.047_add_workouts_source_media")
    await migration047.run_migration(configured=settings(), migration_engine=discover_api.engine)
    # Repair a recorded pre-release047 that omitted the real019 allowlist.
    async with discover_api.engine.begin() as connection:
        await connection.execute(
            text("ALTER TABLE deletion_cleanup_jobs DROP CONSTRAINT ck_deletion_cleanup_kind")
        )
        await connection.execute(
            text("""ALTER TABLE deletion_cleanup_jobs ADD CONSTRAINT ck_deletion_cleanup_kind
            CHECK (kind IN ('account','recipe'))""")
        )
    await migration047.run_migration(configured=settings(), migration_engine=discover_api.engine)
    await migration047.run_migration(configured=settings(), migration_engine=discover_api.engine)
    async with discover_api.engine.begin() as connection:
        for kind in ("account", "recipe", "workout_media"):
            await connection.execute(
                text("INSERT INTO deletion_cleanup_jobs(kind,app_user_id) VALUES(:kind,'owner')"),
                {"kind": kind},
            )
        assert await connection.scalar(
            text("SELECT convalidated FROM pg_constraint WHERE conname='ck_deletion_cleanup_kind'")
        )
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM workouts_schema_migrations WHERE version=47")
            )
            == 1
        )
    async with discover_api.engine.begin() as connection:
        with pytest.raises(IntegrityError):
            await connection.execute(
                text(
                    "INSERT INTO deletion_cleanup_jobs(kind,app_user_id) VALUES('unsupported','owner')"
                )
            )
    url, _, store, _ = await prepare_test_source_cover(discover_api, monkeypatch)
    assert url and len(store._client.puts) == 2


async def test_due_cover_cleanup_waits_for_held_upload(discover_api, monkeypatch):
    import asyncio

    import app.deletion_cleanup as cleanup
    from app.domains.workouts import source_media
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    started, release = asyncio.Event(), asyncio.Event()
    upload = asyncio.create_task(
        prepare_test_source_cover(discover_api, monkeypatch, hold_upload=(started, release))
    )
    await asyncio.wait_for(started.wait(), timeout=5)
    store = source_media.storage_service
    deleted = []

    async def delete_prefix(prefix):
        assert len(store._client.puts) == 2
        deleted.append(prefix)
        store._client.puts.clear()
        return 2

    store.delete_prefix = delete_prefix
    monkeypatch.setattr(cleanup, "storage_service", store)
    monkeypatch.setattr(cleanup, "AsyncSessionLocal", discover_api.sessions)
    async with discover_api.sessions.begin() as db:
        media = await db.scalar(select(WorkoutSourceMedia))
        guard = await db.get(DeletionCleanupJob, media.cleanup_job_id)
        guard.next_attempt_at = source_media.now() - source_media.timedelta(seconds=1)
        guard_id = guard.id
    worker = cleanup.DurableDeletionCleanupWorker()
    assert await worker.claim_next_job() == guard_id
    deletion = asyncio.create_task(worker.execute_claimed_job(guard_id))
    await asyncio.sleep(0.05)
    assert not deletion.done() and not deleted
    release.set()
    url, _, _, _ = await upload
    await asyncio.wait_for(deletion, timeout=5)
    assert url and deleted == [source_media.asset_prefix(source_media.asset_id(url))]
    assert store._client.puts == []
    async with discover_api.sessions() as db:
        assert (await db.get(DeletionCleanupJob, guard_id)).status == "completed"


async def test_legacy_title_edit_preserves_extraction_uncertainty(discover_api):
    warning = "Review the source instructions"
    metadata = {"source_title": "Original source title", "source_creator": "Source creator"}
    row = await save(discover_api, {**REEL, **metadata, "extraction_warnings": [warning]})
    legacy = {key: value for key, value in REEL.items() if key != "source_creator"}
    response = await discover_api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**legacy, "title": "My revised title"}, headers=GENERATION,
    )
    assert response.status_code == 200, response.text
    assert response.json()["content"]["extraction_warnings"] == [warning]
    saved = await discover_api.client.get(f"/api/v1/workouts/library/{row['id']}")
    assert saved.json()["content"]["extraction_warnings"] == [warning]
    assert all(saved.json()["content"][key] == value for key, value in metadata.items())
    explicit_clear = await discover_api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=2",
        json={**REEL, "source_title": None, "source_creator": None}, headers=GENERATION,
    )
    assert explicit_clear.status_code == 200, explicit_clear.text
    assert explicit_clear.json()["content"]["source_title"] is None
    assert explicit_clear.json()["content"]["source_creator"] is None


async def test_discover_copy_has_independent_cover_after_source_account_deletion(
    discover_api, monkeypatch
):
    from app.domains.workouts import source_media
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    url, _, _, _ = await prepare_test_source_cover(discover_api, monkeypatch)
    source = await published_reel(discover_api, {**REEL, "source_thumbnail_url": url})
    cards = (await feed(discover_api))["items"]
    assert cards[0]["thumbnail_url"].endswith("/list.webp")
    copied = await discover_api.client.post(
        f"/api/v1/workouts/discover/{source['id']}/save", headers=GENERATION | OTHER
    )
    assert copied.status_code == 201, copied.text
    copied_url = copied.json()["content"]["source_thumbnail_url"]
    assert copied_url != url and source_media.asset_id(copied_url)
    async with discover_api.sessions() as db:
        await delete_account(db, user())
    async with discover_api.sessions() as db:
        assert await db.get(WorkoutSourceMedia, source_media.asset_id(url)) is None
        assert (await db.get(WorkoutSourceMedia, source_media.asset_id(copied_url))).retained
        account = await db.scalar(
            select(DeletionCleanupJob).where(DeletionCleanupJob.kind == "account")
        )
        assert source_media.asset_prefix(source_media.asset_id(url)) in account.storage_prefixes
        assert (
            source_media.asset_prefix(source_media.asset_id(copied_url))
            not in account.storage_prefixes
        )
    detail = await discover_api.client.get(
        f"/api/v1/workouts/library/{copied.json()['id']}", headers=OTHER
    )
    assert (
        detail.status_code == 200 and detail.json()["content"]["source_thumbnail_url"] == copied_url
    )


async def test_program_cannot_attach_another_owners_cover(discover_api, monkeypatch):
    from app.domains.workouts.programming import RULE_VERSION

    url, _, _, _ = await prepare_test_source_cover(discover_api, monkeypatch)
    await save(discover_api, {**REEL, "source_thumbnail_url": url})
    response = await discover_api.client.post(
        "/api/v1/workouts/programs",
        headers=GENERATION | OTHER,
        json={
            "title": "Other owner's plan",
            "proposal": {
                "status": "ready",
                "rule_version": RULE_VERSION,
                "progression_policy": "No inferred progression",
                "sessions": [
                    {
                        "id": "one",
                        "date": "2026-10-15",
                        "purpose": "Test workout",
                        "workout": {**REEL, "source_thumbnail_url": url},
                    }
                ],
            },
        },
    )
    assert response.status_code == 422 and "Source cover" in response.text


async def test_expired_cover_fallback_does_not_commit_retained_asset(discover_api, monkeypatch):
    from app.domains.workouts import source_media
    from app.domains.workouts.automation_models import WorkoutImport
    from app.domains.workouts.extraction import WorkoutExtractionResult
    from app.domains.workouts.imports import save_import_result
    from app.domains.workouts.models import WorkoutRecord
    from app.domains.workouts.schemas import WorkoutContent
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    url, import_id, _, _ = await prepare_test_source_cover(discover_api, monkeypatch)
    identifier = source_media.asset_id(url)
    async with discover_api.sessions.begin() as db:
        await source_media.membership_for(db, "owner", generation=1, write=True)
        media = await db.get(WorkoutSourceMedia, identifier)
        guard = await db.get(DeletionCleanupJob, media.cleanup_job_id)
        # A completed expiry cleanup can finish before the worker retains the preview.
        guard.status = "completed"
        guard.next_attempt_at = source_media.now() - source_media.timedelta(seconds=1)
        guard.storage_prefixes, guard.storage_prefix_count = [], 0
        job = await db.get(WorkoutImport, import_id)
        result = WorkoutExtractionResult(
            status="ready", workout=WorkoutContent.model_validate({**REEL, "source_thumbnail_url": url}),
        )
        await save_import_result(db, job, result, {"is_public": False})
        saved_id = job.accepted_workout_id
        assert saved_id and result.workout.source_thumbnail_url is None
        # Context exit commits the same session that caught the retention failure.
    async with discover_api.sessions() as db:
        assert not (await db.get(WorkoutSourceMedia, identifier)).retained
        saved = await db.get(WorkoutRecord, saved_id)
        assert not saved.content.get("source_thumbnail_url")
    # Knowing the old canonical URL must not authorize a later dangling attachment.
    attach = await discover_api.client.post(
        "/api/v1/workouts/library", headers=GENERATION,
        json={**REEL, "source_thumbnail_url": url},
    )
    assert attach.status_code == 422 and "Source cover expired" in attach.text
    async with discover_api.sessions() as db:
        assert not (await db.get(WorkoutSourceMedia, identifier)).retained

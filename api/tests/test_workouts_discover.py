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
    original = store.store_prepared_thumbnail_variants_locked

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

    store.store_prepared_thumbnail_variants_locked = registered_before_upload
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


@pytest.mark.parametrize("kind,failed", [("images", False), ("url", True)])
async def test_private_capture_or_failed_upload_never_attaches_cover(
    discover_api, monkeypatch, kind, failed
):
    from app.domains.workouts.source_media_models import WorkoutSourceMedia
    from app.models.deletion import DeletionCleanupJob

    url, _, store, downloads = await prepare_test_source_cover(
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

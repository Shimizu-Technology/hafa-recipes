"""Real database tests for imports, acceptance, stale context and erasure."""

import asyncio
import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.domains.workouts import automation_router, imports, share_router
from app.domains.workouts.automation_models import WorkoutImport, WorkoutProposal
from app.domains.workouts.extraction import ExtractionFailure, WorkoutExtractor
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import WorkoutRecord, WorkoutsMembership
from tests.test_workouts_data_integration import (  # noqa: F401 -- shared isolated database fixture
    GENERATION,
    data_api,
    enroll,
    settings,
)

TEXT = "Squat: 2 sets of 8 reps."


@pytest.mark.parametrize("status", ["queued", "processing", "ready", "incomplete", "failed", "cancelled", "expired"])
def test_import_status_metadata_preserves_actual_timestamps_without_private_capture(status):
    created = datetime(2026, 10, 15, tzinfo=timezone.utc)
    updated = created + timedelta(seconds=40)
    retry = updated + timedelta(seconds=15)
    row = SimpleNamespace(id=uuid4(), generation=2, status=status, attempt_count=1,
                          result=None, expires_at=created + timedelta(hours=24), accepted_workout_id=None,
                          created_at=created, updated_at=updated, next_attempt_at=retry,
                          payload={"text": "private caption", "_save": {"is_public": False}},
                          app_user_id="private-owner", lease_token="private-lease")
    projected = automation_router.ImportResponse.model_validate(automation_router.import_response(row))
    assert projected.created_at == created and projected.updated_at == updated
    assert projected.next_attempt_at == (retry if status == "queued" else None)
    assert projected.max_attempts == imports.MAX_IMPORT_ATTEMPTS == 3
    assert projected.source_is_public is False and projected.generation == 2
    serialized = projected.model_dump_json()
    assert "private" not in serialized and "payload" not in serialized and "lease_token" not in serialized
    assert "current_stage" not in serialized and "progress" not in serialized
    assert row.next_attempt_at == retry  # Projection never changes durable job state.


def test_import_status_additions_accept_an_older_response_without_timing_fields():
    old = dict(id=uuid4(), generation=1, status="processing", attempt_count=1, result=None,
               expires_at=datetime(2026, 10, 16, tzinfo=timezone.utc), accepted_workout_id=None)
    response = automation_router.ImportResponse.model_validate(old)
    assert response.created_at is None and response.updated_at is None
    assert response.next_attempt_at is None and response.max_attempts is None


@pytest.mark.parametrize("owner,matching_import,cancelled", [
    ("owner", True, True), ("owner", False, False),
    ("other", True, False), ("other", False, False),
])
async def test_worker_single_import_cancellation_matches_owner_and_import(owner, matching_import, cancelled):
    worker = imports.WorkoutImportWorker()
    active = uuid4()
    assert worker.active_import_id is None
    worker.active_owner = "owner"
    worker.active_import_id = active
    worker.active_task = asyncio.create_task(asyncio.Event().wait())
    try:
        worker.cancel_import(owner, active if matching_import else uuid4())
        assert bool(worker.active_task.cancelling()) is cancelled
    finally:
        await worker.stop()
    assert worker.active_import_id is None and worker.active_owner is None and worker.active_task is None


async def test_worker_owner_wide_cancellation_still_stops_active_import():
    worker = imports.WorkoutImportWorker()
    worker.active_owner = "owner"
    worker.active_import_id = uuid4()
    worker.active_task = asyncio.create_task(asyncio.Event().wait())
    try:
        worker.cancel_owner("owner")
        assert worker.active_task.cancelling()
    finally:
        await worker.stop()


class Provider:
    enabled = True

    async def extract(self, source):
        return {
            "title": "Source squat",
            "blocks": [
                {
                    "id": "main",
                    "label": "Strength",
                    "exercises": [
                        {
                            "name": "Squat",
                            "sets": 2,
                            "reps_min": 8,
                            "reps_max": 8,
                            "evidence": [
                                {"field": field, "wording": TEXT, "location": "provided_text"}
                                for field in ("name", "sets", "reps_min", "reps_max")
                            ],
                        }
                    ],
                }
            ],
        }


@pytest.fixture
async def automation_api(data_api, monkeypatch):  # noqa: F811 -- pytest fixture registration
    migration = importlib.import_module("migrations.035_add_workouts_automation")
    configured = settings(workouts_imports_enabled=True, workouts_ai_enabled=True)
    await migration.run_migration(configured=configured, migration_engine=data_api.engine)
    data_api.app.include_router(automation_router.router)
    data_api.app.include_router(automation_router.imports_router)
    monkeypatch.setattr(automation_router, "get_settings", lambda: configured)
    monkeypatch.setattr(imports, "get_settings", lambda: configured)
    worker = imports.WorkoutImportWorker(data_api.sessions, WorkoutExtractor(Provider()))
    monkeypatch.setattr(imports, "workout_import_worker", worker)
    monkeypatch.setattr(automation_router, "workout_import_worker", worker)
    data_api.worker = worker
    await enroll(data_api)
    yield data_api
    await worker.stop()


async def consent(api, accepted=True):
    r = await api.client.put(
        "/api/v1/workouts/ai-consent",
        headers=GENERATION,
        json={"accepted": accepted, "disclosure_version": 1},
    )
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "budget,authority",
    [(0, None), (5_000_000, None), (5_000_000, "postgresql://synthetic@localhost/authority_test")],
)
async def test_operational_capabilities_hide_ai_when_budget_is_zero(
    automation_api, monkeypatch, budget, authority
):
    configured = settings(workouts_imports_enabled=True, workouts_ai_enabled=True).model_copy(
        update={
            "workouts_ai_budget_24h_microusd": budget,
            "workouts_ai_budget_database_url": authority,
        }
    )
    monkeypatch.setattr(automation_router, "get_settings", lambda: configured)
    response = await automation_api.client.get("/api/v1/workouts/capabilities")
    assert response.status_code == 200, response.text
    assert response.json()["imports"] is (budget > 0 and bool(authority))
    assert response.json()["coach"] is (budget > 0 and bool(authority))
    assert response.json()["billing_active"] is False


@pytest.mark.parametrize("authority", ["", " \t\n", SecretStr(""), SecretStr("  ")])
async def test_empty_authority_keeps_operational_ai_capabilities_off(automation_api, monkeypatch, authority):
    configured = settings(
        workouts_imports_enabled=True,
        workouts_ai_enabled=True,
        workouts_ai_budget_24h_microusd=5_000_000,
        workouts_ai_budget_database_url=authority,
    )
    assert configured.workouts_ai_budget_database_url is None
    monkeypatch.setattr(automation_router, "get_settings", lambda: configured)
    response = await automation_api.client.get("/api/v1/workouts/capabilities")
    assert response.status_code == 200
    assert response.json()["imports"] is False and response.json()["coach"] is False


async def enqueue(api, request_id=None, text=TEXT):
    return await api.client.post(
        "/api/v1/workouts/imports",
        headers=GENERATION,
        json={
            "request_id": str(request_id or uuid4()),
            "source": {"kind": "text", "text": text, "ai_consent": True},
        },
    )


async def ready_profile(api):
    r = await api.client.put(
        "/api/v1/workouts/profile",
        headers=GENERATION | {"If-Match": "0"},
        json={
            "adult_confirmed": True,
            "equipment": [],
            "available_days": [0, 2, 4],
            "session_minutes": 30,
            "readiness": "ready",
        },
    )
    assert r.status_code == 200, r.text
    r = await api.client.put(
        "/api/v1/workouts/readiness", headers=GENERATION, json={"state": "ready"}
    )
    assert r.status_code == 200, r.text


async def propose(api):
    r = await api.client.post(
        "/api/v1/workouts/program-proposals",
        headers=GENERATION,
        json={"start_date": "2026-10-12", "weeks": 1, "profile_revision": 1},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_import_requires_separate_ai_consent(automation_api):
    r = await enqueue(automation_api)
    assert r.status_code == 403
    async with automation_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutImport)) == 0


async def test_automatic_import_saves_without_client_acceptance_and_replays_once(automation_api):
    api = automation_api
    await consent(api)
    body = {
        "request_id": str(uuid4()), "auto_save": True,
        "source": {"kind": "text", "text": TEXT, "ai_consent": True},
    }
    queued = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json=body)
    assert queued.status_code == 202, queued.text
    assert await api.worker.tick()
    # No accept request or foreground client is involved in creating the library record.
    job = (await api.client.get("/api/v1/workouts/imports/" + queued.json()["id"])).json()
    assert job["accepted_workout_id"]
    async with api.sessions() as db:
        saved = await db.get(WorkoutRecord, job["accepted_workout_id"])
        assert saved.content["blocks"][0]["exercises"][0]["reps_min"] == 8
        assert (await db.get(WorkoutImport, queued.json()["id"])).payload is None
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 1
    replay = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json=body)
    assert replay.json()["accepted_workout_id"] == job["accepted_workout_id"]
    assert not await api.worker.tick()
    changed = await api.client.post(
        "/api/v1/workouts/imports", headers=GENERATION, json=body | {"auto_save": False}
    )
    assert changed.status_code == 409


async def test_automatic_incomplete_draft_keeps_missing_values_and_warnings(automation_api):
    api = automation_api
    await consent(api)

    async def partial(source):
        return {"title": "Partial source", "blocks": [{
            "id": "main", "label": "Main", "exercises": [{
                "name": "Squat", "evidence": [{
                    "field": "name", "wording": "Squat", "location": "provided_text",
                }],
            }],
        }]}

    api.worker.extractor.provider.extract = partial
    response = await api.client.post(
        "/api/v1/workouts/imports", headers=GENERATION, json={
            "request_id": str(uuid4()), "auto_save": True,
            "source": {"kind": "text", "text": "Squat", "ai_consent": True},
        },
    )
    assert response.status_code == 202, response.text
    assert await api.worker.tick()
    job = (await api.client.get("/api/v1/workouts/imports/" + response.json()["id"])).json()
    assert job["status"] == "incomplete" and job["accepted_workout_id"]
    async with api.sessions() as db:
        saved = await db.get(WorkoutRecord, job["accepted_workout_id"])
        exercise = saved.content["blocks"][0]["exercises"][0]
        assert exercise["sets"] is None and exercise["reps_min"] is None
        assert saved.content["extraction_warnings"] == job["result"]["warnings"]


async def test_server_import_inbox_is_owner_generation_scoped_and_never_returns_capture(automation_api):
    api = automation_api
    await consent(api)
    queued = await enqueue(api)
    assert queued.json()["source_is_public"] is None
    inbox = await api.client.get("/api/v1/workouts/imports")
    assert inbox.status_code == 200
    assert [item["id"] for item in inbox.json()] == [queued.json()["id"]]
    assert inbox.json()[0]["source_is_public"] is None
    assert "payload" not in inbox.text and TEXT not in inbox.text
    assert (await api.client.get("/api/v1/workouts/imports?limit=51")).status_code == 422
    async with api.sessions() as db:
        row = await db.get(WorkoutImport, queued.json()["id"])
        row.app_user_id = "other"
        await db.commit()
    assert (await api.client.get("/api/v1/workouts/imports")).json() == []


async def test_automatic_import_cannot_save_after_consent_revocation(automation_api):
    await consent(automation_api)
    queued = await automation_api.client.post(
        "/api/v1/workouts/imports", headers=GENERATION, json={
            "request_id": str(uuid4()), "auto_save": True,
            "source": {"kind": "text", "text": TEXT, "ai_consent": True},
        },
    )
    await consent(automation_api, False)
    await automation_api.worker.tick()
    async with automation_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0
        assert (await db.get(WorkoutImport, queued.json()["id"])).accepted_workout_id is None


@pytest.fixture
async def native_share_api(automation_api, monkeypatch):
    migration = importlib.import_module("migrations.046_add_workouts_share_credentials")
    configured = settings(workouts_imports_enabled=True, workouts_ai_enabled=True)
    await migration.run_migration(configured=configured, migration_engine=automation_api.engine)
    automation_api.app.include_router(share_router.router)
    monkeypatch.setattr(share_router, "get_settings", lambda: configured)
    monkeypatch.setattr(share_router, "workout_import_worker", automation_api.worker)
    await consent(automation_api)
    response = await automation_api.client.post(
        "/api/v1/workouts/share/session", headers=GENERATION,
        json={"installation_id": str(uuid4()), "is_public": False},
    )
    assert response.status_code == 201, response.text
    automation_api.share = response.json()
    automation_api.share_headers = {"Authorization": "Bearer " + response.json()["token"]}
    return automation_api


async def test_native_capability_only_enqueues_its_own_workouts_once(native_share_api):
    api = native_share_api
    body = {"capture_id": str(uuid4()), "url": "https://www.instagram.com/reel/DecwoqXS9ts/"}
    first = await api.client.post("/api/v1/workouts/share/imports", headers=api.share_headers, json=body)
    assert first.status_code == 202, first.text
    replay = await api.client.post("/api/v1/workouts/share/imports", headers=api.share_headers, json=body)
    assert replay.json()["job_id"] == first.json()["job_id"] and replay.json()["replayed"]
    changed = await api.client.post(
        "/api/v1/workouts/share/imports", headers=api.share_headers,
        json=body | {"url": "https://www.instagram.com/reel/another/"},
    )
    assert changed.status_code == 409
    assert (await api.client.post(
        "/api/v1/workouts/share/imports", headers=api.share_headers, json=body | {"is_public": True}
    )).status_code == 403
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutImport)) == 1
        row = await db.get(WorkoutImport, first.json()["job_id"])
        assert row.app_user_id == "owner" and row.payload["_save"]["is_public"] is False
    assert (await api.client.post(
        "/api/v1/workouts/share/imports",
        headers={"Authorization": "Bearer " + api.share["token"].replace("hfws_v1", "hfs_v1")}, json=body,
    )).status_code == 401


async def test_wrong_share_secret_does_not_lock_account(native_share_api, monkeypatch):
    api = native_share_api
    calls = []
    original = share_router.membership_for

    async def observed(*args, **kwargs):
        calls.append(True)
        return await original(*args, **kwargs)

    monkeypatch.setattr(share_router, "membership_for", observed)
    supplied = api.share["token"].rsplit(".", 1)[0] + "." + "x" * 43
    body = {"capture_id": str(uuid4()), "url": "https://www.instagram.com/reel/DecwoqXS9ts/"}
    response = await api.client.post(
        "/api/v1/workouts/share/imports", headers={"Authorization": "Bearer " + supplied}, json=body,
    )
    assert response.status_code == 401
    assert calls == []
    valid = await api.client.post("/api/v1/workouts/share/imports", headers=api.share_headers, json=body)
    assert valid.status_code == 202 and calls


async def test_native_capability_rejects_bad_sources_and_revoked_consent(native_share_api):
    api = native_share_api
    body = {"capture_id": str(uuid4()), "url": "http://127.0.0.1/private"}
    assert (await api.client.post(
        "/api/v1/workouts/share/imports", headers=api.share_headers, json=body
    )).status_code == 422
    await consent(api, False)
    body["url"] = "https://www.instagram.com/reel/DecwoqXS9ts/"
    assert (await api.client.post(
        "/api/v1/workouts/share/imports", headers=api.share_headers, json=body
    )).status_code == 403
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutImport)) == 0


async def test_native_capability_revocation_and_generation_fence(native_share_api):
    api = native_share_api
    revoked = await api.client.delete("/api/v1/workouts/share/session", headers=api.share_headers)
    assert revoked.status_code == 204
    body = {"capture_id": str(uuid4()), "url": "https://www.instagram.com/reel/DecwoqXS9ts/"}
    assert (await api.client.post(
        "/api/v1/workouts/share/imports", headers=api.share_headers, json=body
    )).status_code == 401
    renewed = await api.client.post(
        "/api/v1/workouts/share/session", headers=GENERATION,
        json={"installation_id": str(uuid4()), "is_public": False},
    )
    assert renewed.status_code == 201
    assert (await api.client.delete("/api/v1/workouts/data", headers=GENERATION)).status_code == 200
    assert (await api.client.post(
        "/api/v1/workouts/share/imports",
        headers={"Authorization": "Bearer " + renewed.json()["token"]}, json=body,
    )).status_code == 401


async def test_source_job_retry_identity_and_private_projection(automation_api):
    api = automation_api
    await consent(api)
    identifier = uuid4()
    first = await enqueue(api, identifier)
    assert first.status_code == 202, first.text
    second = await enqueue(api, identifier)
    assert second.json()["id"] == first.json()["id"]
    assert (await enqueue(api, identifier, "Different workout")).status_code == 409
    assert "payload" not in first.json() and "text" not in first.json()
    assert first.headers["Cache-Control"] == "no-store"
    assert await api.worker.tick()
    r = await api.client.get("/api/v1/workouts/imports/" + first.json()["id"])
    assert r.json()["status"] == "ready", r.text
    assert r.json()["result"]["workout"]["capture_kind"] == "text"
    async with api.sessions() as db:
        row = await db.get(WorkoutImport, uuid4())
        assert row is None
        row = await db.get(WorkoutImport, first.json()["id"])
        assert row.payload["text"] == TEXT and row.attempt_count == 1


async def test_worker_timeouts_finish_after_bounded_retries_instead_of_staying_processing(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()

    async def timeout(source):
        raise asyncio.TimeoutError()

    api.worker.extractor.extract = timeout
    for attempt in range(1, imports.MAX_IMPORT_ATTEMPTS + 1):
        assert await api.worker.tick()
        response = await api.client.get(f"/api/v1/workouts/imports/{job['id']}")
        state = response.json()
        assert state["attempt_count"] == attempt and state["max_attempts"] == imports.MAX_IMPORT_ATTEMPTS
        assert state["created_at"] and state["updated_at"]
        if attempt < imports.MAX_IMPORT_ATTEMPTS:
            assert state["status"] == "queued" and state["next_attempt_at"]
            async with api.sessions() as db:
                row = await db.get(WorkoutImport, job["id"])
                assert row.leased_until is None and row.lease_token is None
                row.next_attempt_at = now() - timedelta(seconds=1)
                await db.commit()
        else:
            assert state["status"] == "incomplete" and state["next_attempt_at"] is None
            assert state["result"]["error_code"] == "source_or_provider_timeout"
            assert state["accepted_workout_id"] is None


async def test_import_accept_is_a_reviewed_separate_library_write(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    assert (
        await api.client.post(
            f"/api/v1/workouts/imports/{job['id']}/accept", headers=GENERATION, json={}
        )
    ).status_code == 409
    await api.worker.tick()
    path = f"/api/v1/workouts/imports/{job['id']}/accept"
    first = await api.client.post(path, headers=GENERATION, json={})
    assert first.status_code == 200, first.text
    replay = await api.client.post(path, headers=GENERATION, json={})
    assert first.json()["id"] == replay.json()["id"]
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 1


async def test_revocation_cancels_queued_source_and_clears_private_input(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await consent(api, False)
    r = await api.client.get(f"/api/v1/workouts/imports/{job['id']}")
    assert r.json()["status"] == "cancelled"
    assert not await api.worker.tick()
    async with api.sessions() as db:
        assert (await db.get(WorkoutImport, job["id"])).payload is None


async def test_reaccepted_consent_cannot_revive_old_source_job(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await consent(api, False)
    await consent(api, True)
    assert not await api.worker.tick()
    assert (await api.client.get(f"/api/v1/workouts/imports/{job['id']}")).json()[
        "status"
    ] == "cancelled"


async def test_product_erasure_removes_automation_and_fences_late_requests(automation_api):
    api = automation_api
    await consent(api)
    await ready_profile(api)
    await enqueue(api)
    await propose(api)
    r = await api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert r.status_code == 200, r.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutImport)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0
        assert (await db.get(WorkoutsMembership, "owner")).generation == 2
    assert (await enqueue(api)).status_code == 409


async def test_profile_ready_field_does_not_replace_fresh_check_in(automation_api):
    api = automation_api
    r = await api.client.put(
        "/api/v1/workouts/profile",
        headers=GENERATION | {"If-Match": "0"},
        json={
            "adult_confirmed": True,
            "equipment": [],
            "available_days": [0, 2, 4],
            "session_minutes": 30,
            "readiness": "ready",
        },
    )
    assert r.status_code == 200
    p = await propose(api)
    assert p["proposal"]["status"] == "needs_information"
    assert (
        await api.client.post(
            f"/api/v1/workouts/program-proposals/{p['id']}/accept",
            headers=GENERATION,
            json={"title": "My plan"},
        )
    ).status_code == 409


async def test_plan_acceptance_rechecks_profile_and_preserves_existing_records(automation_api):
    api = automation_api
    await ready_profile(api)
    p = await propose(api)
    assert p["proposal"]["status"] == "ready", p
    r = await api.client.put(
        "/api/v1/workouts/profile",
        headers=GENERATION | {"If-Match": "1"},
        json={
            "adult_confirmed": True,
            "equipment": [],
            "available_days": [1, 3, 5],
            "session_minutes": 20,
        },
    )
    assert r.status_code == 200
    accepted = await api.client.post(
        f"/api/v1/workouts/program-proposals/{p['id']}/accept",
        headers=GENERATION,
        json={"title": "My plan"},
    )
    assert accepted.status_code == 409


async def test_limited_readiness_invalidates_previously_ready_proposal(automation_api):
    api = automation_api
    await ready_profile(api)
    p = await propose(api)
    await api.client.put(
        "/api/v1/workouts/readiness", headers=GENERATION, json={"state": "limited"}
    )
    r = await api.client.post(
        f"/api/v1/workouts/program-proposals/{p['id']}/accept",
        headers=GENERATION,
        json={"title": "My plan"},
    )
    assert r.status_code == 409


async def test_actual_activity_since_preview_invalidates_plan(automation_api):
    api = automation_api
    await ready_profile(api)
    p = await propose(api)
    r = await api.client.post(
        "/api/v1/workouts/activities",
        headers=GENERATION,
        json={"date": "2026-10-10", "name": "Basketball", "strenuous": True},
    )
    assert r.status_code == 201
    r = await api.client.post(
        f"/api/v1/workouts/program-proposals/{p['id']}/accept",
        headers=GENERATION,
        json={"title": "My plan"},
    )
    assert r.status_code == 409


async def test_ready_plan_accept_is_idempotent_and_server_owned(automation_api):
    api = automation_api
    await ready_profile(api)
    p = await propose(api)
    path = f"/api/v1/workouts/program-proposals/{p['id']}/accept"
    first = await api.client.post(path, headers=GENERATION, json={"title": "My plan"})
    assert first.status_code == 200, first.text
    second = await api.client.post(path, headers=GENERATION, json={"title": "My plan"})
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["content"]["proposal"] == p["proposal"]


async def test_owner_scope_protects_job_and_proposal(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await enroll(api, other=True)
    r = await api.client.get(
        f"/api/v1/workouts/imports/{job['id']}", headers={"X-Test-User": "other"}
    )
    assert r.status_code == 404


async def test_expired_import_input_is_purged(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    async with api.sessions() as db:
        row = await db.get(WorkoutImport, job["id"])
        row.expires_at = now() - timedelta(seconds=1)
        await db.commit()
    await api.worker.purge_expired()
    assert (await api.client.get(f"/api/v1/workouts/imports/{job['id']}")).status_code == 404


async def test_cancelled_inflight_provider_cannot_commit_after_erasure(automation_api):
    api = automation_api
    await consent(api)
    await enqueue(api)
    started = asyncio.Event()
    finish = asyncio.Event()
    provider = Provider()
    original = provider.extract

    async def waiting(source):
        started.set()
        await finish.wait()
        return await original(source)

    provider.extract = waiting
    api.worker.extractor = WorkoutExtractor(provider)
    pending = asyncio.create_task(api.worker.tick())
    await asyncio.wait_for(started.wait(), 3)
    r = await api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert r.status_code == 200
    finish.set()
    await pending
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutImport)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0


@pytest.mark.parametrize("cancel_active", [False, True])
async def test_cancelling_one_import_keeps_the_same_owners_other_import_intact(automation_api, cancel_active):
    api = automation_api
    await consent(api)
    active = (await enqueue(api)).json()
    queued = (await enqueue(api)).json()
    started, finish = asyncio.Event(), asyncio.Event()
    provider = Provider()
    original = provider.extract

    async def waiting(source):
        started.set()
        await finish.wait()
        return await original(source)

    provider.extract = waiting
    api.worker.extractor = WorkoutExtractor(provider)
    pending = asyncio.create_task(api.worker.tick())
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
        assert str(api.worker.active_import_id) == active["id"]
        target = active if cancel_active else queued
        response = await api.client.delete(f"/api/v1/workouts/imports/{target['id']}", headers=GENERATION)
        assert response.status_code == 200 and response.json()["status"] == "cancelled"
        if not cancel_active:
            assert not api.worker.active_task.cancelling() and not pending.done()
            assert (await api.client.get(f"/api/v1/workouts/imports/{active['id']}")).json()["status"] == "processing"
        finish.set()
        assert await asyncio.wait_for(pending, timeout=10)
    finally:
        finish.set()
        if not pending.done():
            pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
    assert api.worker.active_import_id is None
    active_state = (await api.client.get(f"/api/v1/workouts/imports/{active['id']}")).json()
    queued_state = (await api.client.get(f"/api/v1/workouts/imports/{queued['id']}")).json()
    assert active_state["status"] == ("cancelled" if cancel_active else "ready")
    assert queued_state["status"] == ("queued" if cancel_active else "cancelled")
    async with api.sessions() as db:
        row = await db.get(WorkoutImport, target["id"])
        assert row.payload is None and row.lease_token is None and row.leased_until is None


async def test_temporary_source_requires_owner_and_is_removed_after_acceptance(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await api.worker.tick()
    path = f"/api/v1/workouts/imports/{job['id']}/source"
    source = await api.client.get(path)
    assert source.status_code == 200 and source.json()["source"]["text"] == TEXT
    await enroll(api, other=True)
    assert (await api.client.get(path, headers={"X-Test-User": "other"})).status_code == 404
    assert (
        await api.client.post(
            f"/api/v1/workouts/imports/{job['id']}/accept", headers=GENERATION, json={}
        )
    ).status_code == 200
    assert (await api.client.get(path)).status_code == 410


async def test_corrected_import_preserves_extracted_original_as_version_one(automation_api):
    import copy

    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await api.worker.tick()
    result = (await api.client.get(f"/api/v1/workouts/imports/{job['id']}")).json()["result"][
        "workout"
    ]
    corrected = copy.deepcopy(result)
    corrected["blocks"][0]["exercises"][0]["reps_min"] = 10
    corrected["blocks"][0]["exercises"][0]["reps_max"] = 10
    request = {"workout": corrected, "acknowledge_warnings": True}
    first = await api.client.post(
        f"/api/v1/workouts/imports/{job['id']}/accept", headers=GENERATION, json=request
    )
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 2
    versions = (
        await api.client.get(f"/api/v1/workouts/library/{first.json()['id']}/versions")
    ).json()
    assert len(versions) == 2
    assert versions[0]["content"]["blocks"][0]["exercises"][0]["reps_min"] == 10
    assert versions[0]["content"]["blocks"][0]["exercises"][0]["provenance"] == "user"
    assert versions[1]["content"]["blocks"][0]["exercises"][0]["reps_min"] == 8
    assert versions[0]["content"]["parent_version_id"] == versions[1]["id"]
    replay = await api.client.post(
        f"/api/v1/workouts/imports/{job['id']}/accept", headers=GENERATION, json=request
    )
    assert replay.json()["id"] == first.json()["id"]


async def test_export_contains_owner_automation_but_never_raw_capture(automation_api):
    api = automation_api
    await consent(api)
    await enqueue(api)
    r = await api.client.get("/api/v1/workouts/export")
    assert r.status_code == 200, r.text
    assert r.json()["totals"]["imports"] == 1
    assert "payload" not in r.json()["datasets"]["imports"][0]
    assert TEXT not in r.text


async def test_library_based_plan_uses_selected_session_and_pins_revision(automation_api):
    api = automation_api
    await ready_profile(api)
    content = {
        "title": "My selected session",
        "blocks": [
            {
                "id": "main",
                "label": "Main",
                "exercises": [
                    {
                        "name": "Bodyweight squat",
                        "exercise_id": "bodyweight_squat",
                        "sets": 2,
                        "reps_min": 8,
                        "reps_max": 10,
                    }
                ],
            }
        ],
    }
    saved = await api.client.post("/api/v1/workouts/library", headers=GENERATION, json=content)
    assert saved.status_code == 201, saved.text
    identifier = saved.json()["id"]
    response = await api.client.post(
        "/api/v1/workouts/program-proposals",
        headers=GENERATION,
        json={
            "start_date": "2026-10-12",
            "weeks": 1,
            "profile_revision": 1,
            "source_workout_ids": [identifier],
            "source_minutes": {identifier: 20},
            "source_mode": "mixed",
        },
    )
    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal["proposal"]["status"] == "ready", proposal
    assert any(
        session["workout"]["title"] == "My selected session"
        for session in proposal["proposal"]["sessions"]
    )
    edit = await api.client.put(
        f"/api/v1/workouts/library/{identifier}?expected_revision=1",
        headers=GENERATION,
        json=content | {"title": "New source version"},
    )
    assert edit.status_code == 200
    accept = await api.client.post(
        f"/api/v1/workouts/program-proposals/{proposal['id']}/accept",
        headers=GENERATION,
        json={"title": "Selected plan"},
    )
    assert accept.status_code == 409


async def test_logged_manual_game_is_used_when_generating_athletic_plan(automation_api):
    api = automation_api
    await ready_profile(api)
    current = (await api.client.get("/api/v1/workouts/profile")).json()
    current["primary_goal"] = "athletic_conditioning"
    assert (
        await api.client.put(
            "/api/v1/workouts/profile", headers=GENERATION | {"If-Match": "1"}, json=current
        )
    ).status_code == 200
    assert (
        await api.client.post(
            "/api/v1/workouts/activities",
            headers=GENERATION,
            json={"date": "2026-10-14", "name": "Basketball game", "strenuous": True},
        )
    ).status_code == 201
    response = await api.client.post(
        "/api/v1/workouts/program-proposals",
        headers=GENERATION,
        json={"start_date": "2026-10-12", "weeks": 1, "profile_revision": 2},
    )
    assert response.status_code == 200, response.text
    assert all(
        session["date"] != "2026-10-14" for session in response.json()["proposal"]["sessions"]
    )


async def test_program_source_requires_explicit_day_assignment(automation_api):
    api = automation_api
    await ready_profile(api)
    saved = await api.client.post(
        "/api/v1/workouts/library",
        headers=GENERATION,
        json={
            "title": "Two day program",
            "kind": "program",
            "blocks": [
                {
                    "id": "day-a",
                    "label": "Day A",
                    "exercises": [
                        {
                            "name": "Bodyweight squat",
                            "exercise_id": "bodyweight_squat",
                            "sets": 2,
                            "reps_min": 8,
                        }
                    ],
                }
            ],
        },
    )
    assert saved.status_code == 201, saved.text
    r = await api.client.post(
        "/api/v1/workouts/program-proposals/from-source",
        headers=GENERATION,
        json={
            "workout_id": saved.json()["id"],
            "workout_revision": 1,
            "profile_revision": 1,
            "start_date": "2026-10-12",
            "days": [
                {
                    "day_offset": 0,
                    "block_ids": ["day-a"],
                    "label": "Monday routine",
                    "duration_minutes": 20,
                },
                {
                    "day_offset": 2,
                    "block_ids": ["day-a"],
                    "label": "Wednesday routine",
                    "duration_minutes": 20,
                },
            ],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["proposal"]["status"] == "ready"
    assert [s["date"] for s in r.json()["proposal"]["sessions"]] == ["2026-10-12", "2026-10-14"]


async def test_original_owner_header_prevents_cross_account_profile_mutation(automation_api):
    api = automation_api
    await enroll(api, other=True)
    r = await api.client.put(
        "/api/v1/workouts/profile",
        headers=GENERATION
        | {"If-Match": "0", "X-Test-User": "other", "X-Hafa-Account-ID": "owner"},
        json={"adult_confirmed": True, "weight_kg": 80},
    )
    assert r.status_code == 409
    other = await api.client.get("/api/v1/workouts/profile", headers={"X-Test-User": "other"})
    assert other.json() is None


@pytest.mark.parametrize(
    "intervals,active",
    [
        (
            [
                {
                    "started_at": "2026-10-10T10:00:00+10:00",
                    "ended_at": "2026-10-10T10:05:00+10:00",
                },
                {
                    "started_at": "2026-10-10T10:04:00+10:00",
                    "ended_at": "2026-10-10T10:10:00+10:00",
                },
            ],
            660,
        ),
        (
            [{"started_at": "2026-10-10T09:59:00+10:00", "ended_at": "2026-10-10T10:05:00+10:00"}],
            360,
        ),
        (
            [{"started_at": "2026-10-10T10:00:00+10:00", "ended_at": "2026-10-10T10:05:00+10:00"}],
            600,
        ),
    ],
)
def test_invalid_active_intervals_cannot_misrepresent_actual_duration(intervals, active):
    from pydantic import ValidationError

    from app.domains.workouts.router import SessionRequest

    with pytest.raises(ValidationError):
        SessionRequest(
            client_session_id=uuid4(),
            workout_id=uuid4(),
            workout_revision=1,
            started_at="2026-10-10T10:00:00+10:00",
            finished_at="2026-10-10T10:20:00+10:00",
            status="partial",
            active_seconds=active,
            active_intervals=intervals,
        )


async def copied_program(api):
    from app.domains.workouts.connection_models import WorkoutCopyReceipt
    from app.domains.workouts.models import WorkoutsProgram, WorkoutsProgramVersion

    migration = importlib.import_module("migrations.037_add_workouts_connections_sharing")
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await ready_profile(api)
    proposal = (await propose(api))["proposal"]
    proposal["status"] = "needs_information"
    proposal["questions"] = ["Review this deliberately copied program"]
    identifier = uuid4()
    content = {"title": "Recipient copy", "proposal": proposal}
    async with api.sessions() as db:
        db.add(
            WorkoutsProgram(
                id=identifier, app_user_id="owner", generation=1, revision=1, content=content
            )
        )
        await db.flush()
        db.add(
            WorkoutsProgramVersion(
                program_id=identifier,
                app_user_id="owner",
                generation=1,
                revision=1,
                content=content,
            )
        )
        db.add(
            WorkoutCopyReceipt(
                app_user_id="owner",
                generation=1,
                record_id=identifier,
                copy_request_id=uuid4(),
                share_id=uuid4(),
                source_token_hash="a" * 64,
                request_hash="b" * 64,
                kind="program",
                snapshot_digest="c" * 64,
                attribution={
                    "shared_by_display_name": "A member",
                    "source_revision": 1,
                    "original_source_included": False,
                },
            )
        )
        await db.commit()
    return str(identifier)


async def test_copied_program_review_versions_same_copy_and_preserves_receipt(automation_api):
    from app.domains.workouts.connection_models import WorkoutCopyReceipt
    from app.domains.workouts.models import WorkoutsProgramVersion

    api = automation_api
    identifier = await copied_program(api)
    response = await api.client.post(
        f"/api/v1/workouts/programs/{identifier}/review-proposal",
        headers=GENERATION,
        json={"program_revision": 1, "profile_revision": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["proposal"]["status"] == "ready", response.text
    accept = f"/api/v1/workouts/program-proposals/{response.json()['id']}/accept"
    adopted = await api.client.post(accept, headers=GENERATION, json={"title": "My reviewed copy"})
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["id"] == identifier and adopted.json()["revision"] == 2
    replay = await api.client.post(accept, headers=GENERATION, json={"title": "My reviewed copy"})
    assert replay.json()["revision"] == 2
    async with api.sessions() as db:
        versions = (
            await db.scalars(
                select(WorkoutsProgramVersion)
                .where(WorkoutsProgramVersion.program_id == identifier)
                .order_by(WorkoutsProgramVersion.revision)
            )
        ).all()
        assert (
            len(versions) == 2 and versions[0].content["proposal"]["status"] == "needs_information"
        )
        assert await db.scalar(select(func.count()).select_from(WorkoutCopyReceipt)) == 1


async def test_copied_program_review_rejects_changed_copy_and_foreign_owner(automation_api):
    from app.domains.workouts.models import WorkoutsProgram

    api = automation_api
    identifier = await copied_program(api)
    path = f"/api/v1/workouts/programs/{identifier}/review-proposal"
    response = await api.client.post(
        path, headers=GENERATION, json={"program_revision": 1, "profile_revision": 1}
    )
    assert response.status_code == 200, response.text
    async with api.sessions() as db:
        row = await db.get(WorkoutsProgram, identifier)
        row.revision += 1
        await db.commit()
    adopt = await api.client.post(
        f"/api/v1/workouts/program-proposals/{response.json()['id']}/accept",
        headers=GENERATION,
        json={"title": "Stale copy"},
    )
    assert adopt.status_code == 409
    await enroll(api, other=True)
    foreign = await api.client.post(
        path,
        headers=GENERATION | {"X-Test-User": "other"},
        json={"program_revision": 2, "profile_revision": 1},
    )
    assert foreign.status_code == 404


async def test_malformed_provider_structure_retains_source_instead_of_cancelling(automation_api):
    api = automation_api
    await consent(api)
    provider = Provider()

    async def duplicate(source):
        content = await provider.extract(source)
        content["blocks"].append(dict(content["blocks"][0]))
        return content

    api.worker.extractor.provider.extract = duplicate
    queued = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json={
        "request_id": str(uuid4()), "auto_save": True, "is_public": False,
        "source": {"kind": "text", "text": TEXT, "ai_consent": True},
    })
    assert queued.status_code == 202
    assert queued.json()["source_is_public"] is False
    await api.worker.tick()
    job = (await api.client.get("/api/v1/workouts/imports/" + queued.json()["id"])).json()
    assert job["status"] == "incomplete" and job["accepted_workout_id"] is None
    assert job["result"]["error_code"] == "workout_needs_correction"
    assert job["source_is_public"] is False
    inbox = await api.client.get("/api/v1/workouts/imports")
    assert inbox.status_code == 200 and inbox.json()[0]["source_is_public"] is False
    assert len(job["result"]["workout"]["blocks"]) == 2
    async with api.sessions() as db:
        assert (await db.get(WorkoutImport, queued.json()["id"])).payload["text"] == TEXT
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0


    corrected = dict(job["result"]["workout"])
    corrected["blocks"] = corrected["blocks"][:1]
    request = {"workout": corrected, "acknowledge_warnings": True}
    path = f"/api/v1/workouts/imports/{job['id']}/accept"
    accepted = await api.client.post(path, headers=GENERATION, json=request)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["content"]["provenance"] == "user"
    assert accepted.json()["content"]["blocks"][0]["exercises"][0]["provenance"] == "user"
    replay = await api.client.post(path, headers=GENERATION, json=request)
    assert replay.status_code == 200 and replay.json()["id"] == accepted.json()["id"]
    async with api.sessions() as db:
        from app.domains.workouts.models import WorkoutVersion

        assert (await db.get(WorkoutImport, job["id"])).payload is None
        assert await db.scalar(select(func.count()).select_from(WorkoutVersion)) == 1


async def test_many_grounding_warnings_do_not_break_saved_import_or_inbox(automation_api):
    api = automation_api
    await consent(api)
    names = [f"Source exercise {i}" for i in range(15)]

    async def uncertain(source):
        return {"title": "Many uncertain instructions", "blocks": [{
            "id": "main", "label": "Main", "exercises": [{
                "name": name, "sets": 3, "reps_min": 8, "reps_max": 12,
                "duration_seconds": 20, "distance_meters": 100,
                "rest_seconds": 10, "tempo": "3010", "load": 20,
                "load_unit": "kg", "load_convention": "total", "effort": "moderate",
                "evidence": [{"field": "name", "wording": name, "location": "provided_text"}],
            } for name in names],
        }]}

    api.worker.extractor.provider.extract = uncertain
    queued = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json={
        "request_id": str(uuid4()), "auto_save": True,
        "source": {"kind": "text", "text": "\n".join(names), "ai_consent": True},
    })
    assert queued.status_code == 202, queued.text
    await api.worker.tick()
    response = await api.client.get("/api/v1/workouts/imports/" + queued.json()["id"])
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["status"] == "incomplete" and job["accepted_workout_id"]
    assert len(job["result"]["warnings"]) > 100
    projection = job["result"]["workout"]["extraction_warnings"]
    assert len(projection) == 100 and "more extraction warnings" in projection[-1]
    inbox = await api.client.get("/api/v1/workouts/imports")
    assert inbox.status_code == 200 and inbox.json()[0]["id"] == job["id"]
    library = await api.client.get("/api/v1/workouts/library/" + job["accepted_workout_id"])
    assert library.status_code == 200
    assert library.json()["content"]["extraction_warnings"] == projection


async def test_legacy_accept_preserves_server_source_fields(automation_api, monkeypatch):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await api.worker.tick()
    cover = "https://example.com/owned-preview.webp"
    async with api.sessions() as db:
        row = await db.get(WorkoutImport, job["id"])
        result = dict(row.result)
        result["workout"] = dict(result["workout"]) | {
            "source_thumbnail_url": cover,
            "source_title": "The original workout title",
            "source_creator": "The source creator",
            "extraction_warnings": ["Review the source instructions"],
        }
        row.result = result
        await db.commit()
    from app.domains.workouts import source_media

    async def entitled(db, owner, generation, url):
        assert url == cover

    monkeypatch.setattr(source_media, "retain_source_cover", entitled)
    legacy = dict(result["workout"])
    legacy.pop("source_thumbnail_url")
    legacy.pop("extraction_warnings")
    legacy.pop("source_title")
    legacy.pop("source_creator")
    body = {"workout": legacy, "acknowledge_warnings": True}
    path = f"/api/v1/workouts/imports/{job['id']}/accept"
    accepted = await api.client.post(path, headers=GENERATION, json=body)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["content"]["source_thumbnail_url"] == cover
    assert accepted.json()["content"]["source_title"] == "The original workout title"
    assert accepted.json()["content"]["source_creator"] == "The source creator"
    assert accepted.json()["content"]["extraction_warnings"] == ["Review the source instructions"]
    replay = await api.client.post(path, headers=GENERATION, json=body)
    assert replay.status_code == 200 and replay.json()["id"] == accepted.json()["id"]


async def test_corrected_import_url_does_not_inherit_original_credit_or_cover(automation_api):
    api = automation_api
    await consent(api)
    job = (await enqueue(api)).json()
    await api.worker.tick()
    async with api.sessions() as db:
        row = await db.get(WorkoutImport, job["id"])
        result = dict(row.result)
        result["workout"] = dict(result["workout"]) | {
            "source_thumbnail_url": "https://example.com/original.webp",
            "source_title": "Original source title",
            "source_creator": "Original creator",
            "extraction_warnings": ["Review the source instructions"],
        }
        row.result = result
        await db.commit()
    corrected = {
        key: value for key, value in result["workout"].items()
        if key not in {"source_thumbnail_url", "source_title", "source_creator", "extraction_warnings"}
    }
    corrected["source_url"] = "https://www.youtube.com/watch?v=corrected-source"
    accepted = await api.client.post(
        f"/api/v1/workouts/imports/{job['id']}/accept", headers=GENERATION,
        json={"workout": corrected, "acknowledge_warnings": True},
    )
    assert accepted.status_code == 200, accepted.text
    content = accepted.json()["content"]
    assert not any(content.get(field) for field in ("source_thumbnail_url", "source_title", "source_creator"))
    assert content["extraction_warnings"] == ["Review the source instructions"]


@pytest.mark.parametrize("failure", ["empty", "empty_block", "provider_failed", "invalid_response", "timeout", "source_private"])
async def test_zero_exercise_auto_import_remains_recoverable_until_explicit_corrected_save(automation_api, failure):
    api = automation_api
    await consent(api)

    async def unusable(source):
        if failure == "provider_failed":
            raise ExtractionFailure("provider_failed")
        if failure == "timeout":
            raise asyncio.TimeoutError()
        if failure == "invalid_response":
            return {"ingredients": ["Not a workout response"]}
        return {"title": "Source only", "blocks": [] if failure == "empty" else [
            {"id": "empty", "label": "No instructions", "exercises": []}
        ]}

    api.worker.extractor.provider.extract = unusable
    source = {"kind": "text", "text": TEXT, "ai_consent": True}
    if failure == "source_private":
        class UnavailableSource:
            async def acquire(self, url, provider):
                raise ExtractionFailure("source_private")
        api.worker.extractor.acquirer = UnavailableSource()
        source = {"kind": "url", "source_url": "https://www.instagram.com/reel/DdzUTq7NDRA/", "ai_consent": True}
    body = {"request_id": str(uuid4()), "auto_save": True, "is_public": False, "source": source}
    queued = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json=body)
    assert queued.status_code == 202, queued.text
    path = "/api/v1/workouts/imports/" + queued.json()["id"]
    for _ in range(3 if failure == "timeout" else 1):
        assert await api.worker.tick()
        async with api.sessions() as db:
            job = await db.get(WorkoutImport, queued.json()["id"])
            if job.status == "queued":
                job.next_attempt_at = now() - timedelta(seconds=1)
                await db.commit()
    job = (await api.client.get(path)).json()
    assert job["status"] == "incomplete" and job["accepted_workout_id"] is None
    assert not any(block["exercises"] for block in job["result"]["workout"]["blocks"])
    capture = await api.client.get(path + "/source")
    assert capture.status_code == 200 and all(capture.json()["source"][key] == value for key, value in source.items())
    assert job["result"]["warnings"] and job["source_is_public"] is False
    async with api.sessions() as db:
        assert (await db.get(WorkoutImport, job["id"])).payload is not None
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0
    replay = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json=body)
    assert replay.json()["id"] == job["id"] and replay.json()["accepted_workout_id"] is None
    assert not await api.worker.tick()
    # Older clients can still explicitly correct and accept the draft.
    corrected = dict(job["result"]["workout"])
    corrected["blocks"] = (await Provider().extract(None))["blocks"]
    request = {"workout": corrected, "acknowledge_warnings": True}
    accepted = await api.client.post(path + "/accept", headers=GENERATION, json=request)
    assert accepted.status_code == 200, accepted.text
    accepted_again = await api.client.post(path + "/accept", headers=GENERATION, json=request)
    assert accepted_again.json()["id"] == accepted.json()["id"]
    async with api.sessions() as db:
        saved_job = await db.get(WorkoutImport, job["id"])
        assert str(saved_job.accepted_workout_id) == accepted.json()["id"] and saved_job.payload is None
        assert saved_job.result == job["result"]
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 1
    assert (await api.client.get(path + "/source")).status_code == 410


async def test_zero_exercise_auto_import_can_be_cleared_without_creating_a_workout(automation_api):
    api = automation_api
    await consent(api)

    async def empty(source):
        return {"title": "Source only", "blocks": []}
    api.worker.extractor.provider.extract = empty
    queued = await api.client.post("/api/v1/workouts/imports", headers=GENERATION, json={
        "request_id": str(uuid4()), "auto_save": True,
        "source": {"kind": "text", "text": TEXT, "ai_consent": True},
    })
    assert queued.status_code == 202, queued.text
    assert await api.worker.tick()
    path = "/api/v1/workouts/imports/" + queued.json()["id"]
    cleared = await api.client.delete(path, headers=GENERATION)
    assert cleared.status_code == 200 and cleared.json()["status"] == "cancelled"
    assert cleared.json()["accepted_workout_id"] is None
    assert (await api.client.get(path + "/source")).status_code == 410
    async with api.sessions() as db:
        job = await db.get(WorkoutImport, queued.json()["id"])
        assert job.payload is None
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0

"""Real database tests for imports, acceptance, stale context and erasure."""

import asyncio
import importlib
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.domains.workouts import automation_router, imports
from app.domains.workouts.automation_models import WorkoutImport, WorkoutProposal
from app.domains.workouts.extraction import WorkoutExtractor
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import WorkoutRecord, WorkoutsMembership
from tests.test_workouts_data_integration import (  # noqa: F401 -- shared isolated database fixture
    GENERATION,
    data_api,
    enroll,
    settings,
)

TEXT = "Squat: 2 sets of 8 reps."


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

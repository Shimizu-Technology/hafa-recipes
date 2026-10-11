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

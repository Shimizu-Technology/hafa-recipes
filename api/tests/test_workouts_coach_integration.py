"""Own disposable PostgreSQL only: consent races, receipts, actuals, privacy."""

import asyncio
import importlib
import json
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select

from app.domains.workouts import (
    automation_router,
    coach,
    coach_actions,
    coach_control,
    coach_router,
)
from app.domains.workouts.automation_models import WorkoutCoachMessage, WorkoutProposal
from app.domains.workouts.coach_actions import prepare_action
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsProfile,
    WorkoutsProgram,
    WorkoutsSession,
    WorkoutVersion,
)
from app.domains.workouts.programming import build_program
from app.domains.workouts.router import content_digest
from app.models.ai import AIInvocation
from tests.test_workouts_automation_integration import consent, ready_profile
from tests.test_workouts_data_integration import (  # noqa: F401
    GENERATION,
    data_api,
    enroll,
    settings,
)


def answer(text="Here is your training suggestion. Review it before accepting."):
    return {
        "status": "completed",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


class FakeProvider:
    enabled = True

    def __init__(self):
        self.action = None
        self.sent = []
        self.before_response = None

    async def respond(self, items, *, tools):
        self.sent.append(json.loads(json.dumps(items)))
        if self.before_response:
            await self.before_response()
        if tools and self.action:
            name, arguments = self.action
            return {
                "status": "completed",
                "output": [
                    {"type": "reasoning", "id": "reason", "summary": []},
                    {
                        "type": "function_call",
                        "name": name,
                        "call_id": "call1",
                        "arguments": json.dumps(arguments),
                    },
                ],
            }
        return answer()


@pytest.fixture
async def coach_api(data_api, monkeypatch):  # noqa: F811
    configured = settings(workouts_ai_enabled=True)
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=configured, migration_engine=data_api.engine
    )
    data_api.app.include_router(automation_router.router)
    data_api.app.include_router(coach_router.router)
    data_api.app.include_router(coach_router.send_router)
    monkeypatch.setattr(coach_router, "get_settings", lambda: configured)
    monkeypatch.setattr(coach_actions, "get_settings", lambda: configured)
    monkeypatch.setattr(coach_control, "get_settings", lambda: configured)
    monkeypatch.setattr(automation_router, "get_settings", lambda: configured)
    data_api.provider = FakeProvider()
    data_api.coach = coach.WorkoutCoach(data_api.provider, session_factory=data_api.sessions)
    monkeypatch.setattr(coach_router, "workout_coach", data_api.coach)
    await enroll(data_api)
    await consent(data_api)
    await ready_profile(data_api)
    yield data_api


async def send(api, message="Please help me train", request_id=None):
    return await api.client.post(
        "/api/v1/workouts/coach/messages",
        headers=GENERATION,
        json={"request_id": str(request_id or uuid4()), "message": message},
    )


async def action(api, operation="accept", proposal_id=None):
    if proposal_id is None:
        response = await send(api)
        assert response.status_code == 200, response.text
        proposal_id = response.json()["actions"][0]["proposal_id"]
    kwargs = {"json": {"title": "My plan"}} if operation == "accept" else {}
    response = await api.client.post(
        f"/api/v1/workouts/coach/actions/{proposal_id}/{operation}", headers=GENERATION, **kwargs
    )
    return response, proposal_id


def plan_action():
    return "propose_training_plan", {
        "start_date": (now() + timedelta(days=14)).date().isoformat(),
        "weeks": 1,
        "source_workout_ids": [],
    }


async def create_workout(api, *, loaded=False):
    exercise = {
        "exercise_id": "goblet_squat" if loaded else "bodyweight_squat",
        "name": "Squat",
        "sets": 2,
        "reps_min": 8,
        "reps_max": 12,
    }
    if loaded:
        exercise.update(load=20, load_unit="kg", load_convention="total")
    response = await api.client.post(
        "/api/v1/workouts/library",
        headers=GENERATION,
        json={
            "title": "Squat",
            "estimated_minutes": 20,
            "blocks": [{"id": "main", "label": "Strength", "exercises": [exercise]}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_persistent_history_idempotency_and_private_owner(coach_api):
    api = coach_api
    identifier = uuid4()
    first = await send(api, request_id=identifier)
    assert first.status_code == 200, first.text
    assert first.headers["Cache-Control"] == "no-store"
    repeated = await send(api, request_id=identifier)
    assert repeated.json()["id"] == first.json()["id"]
    assert len(api.provider.sent) == 1
    assert (await send(api, "Different", identifier)).status_code == 409
    history = await api.client.get("/api/v1/workouts/coach/messages")
    assert len(history.json()["messages"]) == 1
    await enroll(api, other=True)
    other = await api.client.get(
        "/api/v1/workouts/coach/messages", headers={"X-Test-User": "other"}
    )
    assert other.json()["messages"] == []


async def test_consent_required_before_reservation_and_no_paid_default(coach_api):
    api = coach_api
    await consent(api, False)
    assert (await send(api)).status_code == 403
    assert not api.provider.sent
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutCoachMessage)) == 0
    assert not coach.ProductionCoachProvider().enabled


async def test_plan_is_concrete_proposed_accept_idempotent_undo(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    response = await send(api)
    assert response.status_code == 200, response.text
    assert response.json()["actions"][0]["status"] == "ready"
    assert len(api.provider.sent) == 2
    assert any(item.get("type") == "reasoning" for item in api.provider.sent[1])
    identifier = response.json()["actions"][0]["proposal_id"]
    inspected = await api.client.get(f"/api/v1/workouts/coach/actions/{identifier}")
    assert inspected.json()["proposal"]["sessions"]
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsProgram)) == 0
    accepted, _ = await action(api, proposal_id=identifier)
    assert accepted.status_code == 200, accepted.text
    replay, _ = await action(api, proposal_id=identifier)
    assert replay.json() == accepted.json()
    undone, _ = await action(api, "undo", identifier)
    assert undone.status_code == 200, undone.text
    assert (await action(api, proposal_id=identifier))[0].status_code == 409
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsProgram)) == 0


async def test_preferences_accept_and_undo_new_revisions_only(coach_api):
    api = coach_api
    api.provider.action = (
        "update_training_preferences",
        {
            "primary_goal": None,
            "experience": None,
            "equipment": None,
            "available_days": [1, 3],
            "session_minutes": 20,
        },
    )
    accepted, identifier = await action(api)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["revision"] == 2
    undone, _ = await action(api, "undo", identifier)
    assert undone.status_code == 200, undone.text
    async with api.sessions() as db:
        profile = await db.get(WorkoutsProfile, "owner")
        assert profile.revision == 3 and profile.content["session_minutes"] == 30


async def test_adaptation_separate_copy_and_source_unchanged(coach_api):
    api = coach_api
    workout = await create_workout(api)
    api.provider.action = (
        "adapt_saved_workout",
        {"workout_id": workout["id"], "expected_revision": 1, "minutes": None},
    )
    accepted, identifier = await action(api)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["record_id"] != workout["id"]
    async with api.sessions() as db:
        assert (await db.get(WorkoutRecord, UUID(workout["id"]))).revision == 1
    assert (await action(api, "undo", identifier))[0].status_code == 200


async def test_old_history_user_visible_but_not_sent_after_profile_change_or_reconsent(coach_api):
    api = coach_api
    first = await send(api, "Old equipment assertion")
    assert first.status_code == 200
    async with api.sessions() as db:
        profile = await db.get(WorkoutsProfile, "owner")
        profile.updated_at = now()
        profile.revision += 1
        await db.commit()
    assert (await send(api)).status_code == 200
    assert "Old equipment assertion" not in api.provider.sent[-1][1]["content"]
    await consent(api, False)
    await consent(api, True)
    assert (await send(api)).status_code == 200
    context = json.loads(api.provider.sent[-1][1]["content"].split("\n", 1)[1])
    assert context["history"] == []
    history = await api.client.get("/api/v1/workouts/coach/messages")
    assert len(history.json()["messages"]) == 3


async def test_imported_health_activity_and_derivatives_never_sent(coach_api):
    api = coach_api
    async with api.sessions() as db:
        db.add(
            WorkoutsActivity(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                content={
                    "date": now().date().isoformat(),
                    "name": "HEALTH SECRET",
                    "origin_id": "unknown-origin",
                },
            )
        )
        db.add(
            WorkoutRecord(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                revision=1,
                content={
                    "title": "RESTRICTED SECRET",
                    "source_url": "https://strava.com/activities/1",
                },
            )
        )
        db.add(
            WorkoutsProgram(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                revision=1,
                content={"title": "DERIVED SECRET", "used_health_context": True},
            )
        )
        await db.commit()
    assert (await send(api)).status_code == 200
    transmitted = json.dumps(api.provider.sent)
    assert "SECRET" not in transmitted and "unknown-origin" not in transmitted


@pytest.mark.parametrize("change", ["revoke", "clear", "profile"])
async def test_inflight_output_cannot_commit_after_consent_clear_or_profile_change(
    coach_api, change
):
    api = coach_api
    started, release = asyncio.Event(), asyncio.Event()

    async def blocked():
        started.set()
        await release.wait()

    api.provider.before_response = blocked
    api.provider.action = plan_action()
    task = asyncio.create_task(send(api))
    await asyncio.wait_for(started.wait(), 5)
    if change == "revoke":
        await consent(api, False)
    elif change == "clear":
        assert (
            await api.client.delete("/api/v1/workouts/coach/messages", headers=GENERATION)
        ).status_code == 204
    else:
        async with api.sessions() as db:
            profile = await db.get(WorkoutsProfile, "owner")
            profile.revision += 1
            profile.updated_at = now()
            await db.commit()
    release.set()
    response = await task
    assert response.status_code in {403, 409}, response.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0
    assert len(api.provider.sent) == 1


async def test_clear_removes_private_content_and_proposals_tombstone_blocks_replay(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    identifier = uuid4()
    response = await send(api, "PRIVATE BODY INFORMATION", identifier)
    assert response.status_code == 200
    assert (
        await api.client.delete("/api/v1/workouts/coach/messages", headers=GENERATION)
    ).status_code == 204
    assert (await send(api, "PRIVATE BODY INFORMATION", identifier)).status_code == 410
    assert (await api.client.get("/api/v1/workouts/coach/messages")).json()["messages"] == []
    async with api.sessions() as db:
        row = await db.scalar(select(WorkoutCoachMessage))
        assert row.user_message == row.assistant_message == ""
        assert row.request_hash == "0" * 64 and row.proposals == {"state": "cleared"}
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0


async def test_quota_cannot_be_reset_by_clearing(coach_api):
    api = coach_api
    async with api.sessions() as db:
        for _ in range(50):
            db.add(
                WorkoutCoachMessage(
                    id=uuid4(),
                    app_user_id="owner",
                    generation=1,
                    request_id=uuid4(),
                    request_hash="0" * 64,
                    user_message="",
                    assistant_message="",
                    proposals={"state": "cleared"},
                    used_health_context=False,
                )
            )
        await db.commit()
    assert (await send(api)).status_code == 429
    assert not api.provider.sent


async def test_unknown_tool_or_uninspected_ids_fail_without_proposals(coach_api):
    api = coach_api
    api.provider.action = "delete_account", {}
    assert (await send(api)).status_code == 503
    api.provider.action = (
        "adapt_saved_workout",
        {"workout_id": str(uuid4()), "expected_revision": 1, "minutes": None},
    )
    assert (await send(api)).status_code == 503
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0


async def test_profile_change_stales_receipt_and_reconsent_does_not_revive_it(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    response = await send(api)
    identifier = response.json()["actions"][0]["proposal_id"]
    await consent(api, False)
    assert (await action(api, proposal_id=identifier))[0].status_code == 403
    await consent(api, True)
    assert (await action(api, proposal_id=identifier))[0].status_code == 409


async def test_medical_request_has_useful_boundary_and_no_provider_send(coach_api):
    api = coach_api
    response = await send(api, "Can you diagnose my chest pain?")
    assert response.status_code == 200
    assert "urgent medical help" in response.json()["assistant_message"]
    assert not api.provider.sent


async def test_future_schedule_edit_undo_preserves_program_versions(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    async with api.sessions() as db:
        program = await db.get(WorkoutsProgram, UUID(identifier))
        session = program.content["proposal"]["sessions"][0]
        before = json.loads(json.dumps(program.content))
    api.provider.action = (
        "edit_future_schedule",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "session_id": session["id"],
            "operation": "skip",
            "target_date": None,
        },
    )
    accepted, proposal_id = await action(api)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["revision"] == 2
    undone, _ = await action(api, "undo", proposal_id)
    assert undone.status_code == 200, undone.text
    async with api.sessions() as db:
        program = await db.get(WorkoutsProgram, UUID(identifier))
        assert program.revision == 3 and program.content == before


async def test_progression_missing_actual_feedback_holds_no_phantom_load(coach_api):
    api = coach_api
    workout = await create_workout(api, loaded=True)
    api.provider.action = (
        "review_actual_progression",
        {
            "workout_id": workout["id"],
            "expected_revision": 1,
            "block_id": "main",
            "exercise_index": 0,
        },
    )
    response = await send(api)
    assert response.status_code == 200, response.text
    identifier = response.json()["actions"][0]["proposal_id"]
    inspected = await api.client.get(f"/api/v1/workouts/coach/actions/{identifier}")
    assert inspected.json()["proposal"]["evaluation"]["action"] != "increase_load"
    assert inspected.json()["proposal"]["workout"] is None
    assert (await action(api, proposal_id=identifier))[0].status_code == 409


async def test_completed_actuals_cannot_be_undone_or_changed_by_schedule(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    accepted, proposal_id = await action(api)
    identifier = UUID(accepted.json()["record_id"])
    async with api.sessions() as db:
        program = await db.get(WorkoutsProgram, identifier)
        session = program.content["proposal"]["sessions"][0]
        actual = {
            "status": "completed",
            "program_session_id": session["id"],
            "started_at": now().isoformat(),
            "actuals": [],
        }
        db.add(
            WorkoutsSession(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                client_session_id=uuid4(),
                request_hash=content_digest(actual),
                source_program_id=identifier,
                content=actual,
            )
        )
        await db.commit()
    assert (await action(api, "undo", proposal_id))[0].status_code == 409
    async with api.sessions() as db:
        with pytest.raises(Exception) as error:
            await prepare_action(
                db,
                "owner",
                1,
                "edit_future_schedule",
                {
                    "program_id": str(identifier),
                    "expected_revision": 1,
                    "session_id": session["id"],
                    "operation": "skip",
                    "target_date": None,
                },
            )
        assert error.value.status_code == 409
        assert (await db.scalar(select(WorkoutsSession))).content == actual


@pytest.mark.parametrize(
    "pain,expected", [(False, "increase_load"), (None, "hold"), (True, "hold")]
)
async def test_comparable_actual_progression_is_result_based_and_actuals_immutable(
    coach_api, pain, expected
):
    api = coach_api
    workout = await create_workout(api, loaded=True)
    async with api.sessions() as db:
        acquired = {"parts": [{"location": "caption", "text": "PRIVATE RAW PROGRESSION SOURCE"}]}
        # Seed the server-acquired prescription when its immutable version is
        # first created; updating an existing version is correctly forbidden.
        source = automation_router.store_workout(db, "owner", 1, {
            **workout["content"], "source_context": acquired,
            "source_title": "Original creator instructions", "instructions": ["Repeat in order"],
            "blocks": [{**block, "exercises": [{**exercise, "instructions": "Keep heels down"}
                for exercise in block["exercises"]]} for block in workout["content"]["blocks"]],
        })
        workout = {"id": str(source.id), "revision": source.revision}
        profile = await db.get(WorkoutsProfile, "owner")
        profile.content = dict(profile.content, equipment=["dumbbell"], available_loads_kg=[20, 21])
        profile.revision += 1
        profile.updated_at = now()
        await db.commit()
    for days in [2, 1]:
        started = now() - timedelta(days=days)
        actuals = [
            {
                "block_id": "main",
                "exercise_index": 0,
                "set_index": index,
                "reps": 12,
                "load": 20,
                "load_unit": "kg",
                "load_convention": "total",
                "completed": True,
                "difficulty": "manageable",
                "pain_reported": pain,
            }
            for index in [1, 2]
        ]
        response = await api.client.post(
            "/api/v1/workouts/sessions",
            headers=GENERATION,
            json={
                "client_session_id": str(uuid4()),
                "workout_id": workout["id"],
                "workout_revision": 1,
                "started_at": started.isoformat(),
                "finished_at": (started + timedelta(minutes=20)).isoformat(),
                "status": "completed",
                "actuals": actuals,
            },
        )
        assert response.status_code == 201, response.text
    async with api.sessions() as db:
        actual_before = [
            row.content
            for row in (
                await db.scalars(select(WorkoutsSession).order_by(WorkoutsSession.id))
            ).all()
        ]
    api.provider.action = (
        "review_actual_progression",
        {
            "workout_id": workout["id"],
            "expected_revision": 1,
            "block_id": "main",
            "exercise_index": 0,
        },
    )
    response = await send(api)
    assert response.status_code == 200, response.text
    assert len(api.provider.sent) == 2
    assert "PRIVATE RAW PROGRESSION SOURCE" not in json.dumps(api.provider.sent)
    assert "source_context" not in json.dumps(api.provider.sent)
    identifier = response.json()["actions"][0]["proposal_id"]
    inspected = await api.client.get(f"/api/v1/workouts/coach/actions/{identifier}")
    assert inspected.json()["proposal"]["evaluation"]["action"] == expected
    if expected == "increase_load":
        accepted, _ = await action(api, proposal_id=identifier)
        assert accepted.status_code == 200, accepted.text
        async with api.sessions() as db:
            saved = await db.get(WorkoutRecord, UUID(accepted.json()["record_id"]))
            assert saved.content["blocks"][0]["exercises"][0]["load"] == 21
            assert "source_context" not in saved.content
            assert saved.content["instructions"] == ["Repeat in order"]
            assert saved.content["blocks"][0]["exercises"][0]["instructions"] == "Keep heels down"
            assert saved.content["source_title"] == "Original creator instructions"
            original = await db.get(WorkoutRecord, UUID(workout["id"]))
            assert original.content["source_context"] == acquired
            version = await db.scalar(select(WorkoutVersion).where(WorkoutVersion.workout_id == original.id))
            assert version.content["source_context"] == acquired
            assert (await db.get(WorkoutRecord, UUID(workout["id"]))).content["blocks"][0][
                "exercises"
            ][0]["load"] == 20
            assert [
                row.content
                for row in (
                    await db.scalars(select(WorkoutsSession).order_by(WorkoutsSession.id))
                ).all()
            ] == actual_before


async def test_source_plan_hook_pins_owned_revisions_until_acceptance(coach_api):
    api = coach_api
    workout = await create_workout(api)
    captured = []

    async def compose(profile, start_date, weeks, sources):
        captured.append(sources)
        return build_program(profile, start_date, weeks)

    api.coach.compose_library_program = compose
    name, arguments = plan_action()
    arguments["source_workout_ids"] = [workout["id"]]
    api.provider.action = name, arguments
    response = await send(api)
    assert response.status_code == 200, response.text
    assert captured[0][0]["revision"] == 1 and captured[0][0]["id"] == workout["id"]
    identifier = response.json()["actions"][0]["proposal_id"]
    async with api.sessions() as db:
        source = await db.get(WorkoutRecord, UUID(workout["id"]))
        source.revision += 1
        source.updated_at = now()
        await db.commit()
    assert (await action(api, proposal_id=identifier))[0].status_code == 409


async def test_invocation_quota_survives_product_history_erasure(coach_api):
    api = coach_api
    async with api.sessions() as db:
        for _ in range(50):
            db.add(
                AIInvocation(
                    id=uuid4(),
                    request_id=str(uuid4()),
                    user_id="owner",
                    job_id=None,
                    capability="workout_coach",
                    model="synthetic",
                    prompt_version="test",
                    status="success",
                    latency_ms=1,
                )
            )
        await db.commit()
    assert (await send(api)).status_code == 429
    assert not api.provider.sent


async def test_audit_only_uuid_cannot_be_reused_to_bypass_erasure_quota(coach_api):
    api = coach_api
    identifier = uuid4()
    async with api.sessions() as db:
        db.add(
            AIInvocation(
                id=uuid4(),
                request_id=str(identifier),
                user_id="owner",
                job_id=None,
                capability="workout_coach",
                model="synthetic",
                prompt_version="test",
                status="success",
                latency_ms=1,
            )
        )
        await db.commit()
    assert (await send(api, request_id=identifier)).status_code == 410
    assert not api.provider.sent
    assert (await send(api, request_id=uuid4())).status_code == 200


async def test_cancellation_marks_receipt_failed_without_proposals(coach_api):
    api = coach_api
    entered = asyncio.Event()

    async def blocked():
        entered.set()
        await asyncio.Event().wait()

    api.provider.before_response = blocked
    identifier = uuid4()
    task = asyncio.create_task(send(api, request_id=identifier))
    await asyncio.wait_for(entered.wait(), 5)
    api.coach.cancel_owner("owner")
    with pytest.raises(asyncio.CancelledError):
        await task
    async with api.sessions() as db:
        row = await db.scalar(select(WorkoutCoachMessage))
        assert row.proposals["state"] == "failed"
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0
    assert not api.coach._inflight


async def test_normal_four_week_program_is_inspected_for_schedule_actions(coach_api):
    api = coach_api
    name, arguments = plan_action()
    arguments["weeks"] = 4
    api.provider.action = name, arguments
    accepted, _ = await action(api)
    assert accepted.status_code == 200, accepted.text
    program_id = accepted.json()["record_id"]
    async with api.sessions() as db:
        program = await db.get(WorkoutsProgram, UUID(program_id))
        session = program.content["proposal"]["sessions"][7]
    api.provider.action = (
        "edit_future_schedule",
        {
            "program_id": program_id,
            "expected_revision": 1,
            "session_id": session["id"],
            "operation": "skip",
            "target_date": None,
        },
    )
    response = await send(api)
    assert response.status_code == 200, response.text
    context = json.loads(api.provider.sent[-2][1]["content"].split("\n", 1)[1])
    assert context["programs"][0]["content"]["session_count"] >= 8
    assert any(
        item["id"] == session["id"] for item in context["programs"][0]["content"]["sessions"]
    )


async def test_preference_tool_cannot_infer_or_store_body_metrics(coach_api):
    api = coach_api
    api.provider.action = (
        "update_training_preferences",
        {
            "primary_goal": None,
            "experience": None,
            "equipment": None,
            "available_days": None,
            "session_minutes": 20,
            "weight_kg": 90,
        },
    )
    response = await send(api)
    assert response.status_code == 503
    async with api.sessions() as db:
        profile = await db.get(WorkoutsProfile, "owner")
        assert profile.revision == 1 and profile.content.get("weight_kg") is None
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0


async def test_disabled_coach_checks_flags_before_parsing_or_authentication(coach_api, monkeypatch):
    from app.auth import get_current_user

    api = coach_api
    configured = settings(workouts_ai_enabled=False)
    monkeypatch.setattr(coach_router, "get_settings", lambda: configured)

    def forbidden():
        raise AssertionError("No authentication for disabled coach")

    api.app.dependency_overrides[get_current_user] = forbidden
    response = await api.client.post("/api/v1/workouts/coach/messages", content=b"not-json")
    assert response.status_code == 503
    assert not api.provider.sent


async def test_generic_accept_cannot_bypass_coach_consent_revocation(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    response = await send(api)
    assert response.status_code == 200, response.text
    identifier = response.json()["actions"][0]["proposal_id"]
    await consent(api, False)
    accepted = await api.client.post(
        f"/api/v1/workouts/program-proposals/{identifier}/accept",
        headers=GENERATION,
        json={"title": "Bypass"},
    )
    assert accepted.status_code == 403, accepted.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsProgram)) == 0


async def test_coach_equipment_change_updates_selected_location_only(coach_api):
    api = coach_api
    async with api.sessions() as db:
        current = await db.get(WorkoutsProfile, "owner")
        current.content = current.content | {
            "equipment_locations": [
                {"id": "home", "name": "Home", "equipment": [], "available_loads_kg": []},
                {"id": "gym", "name": "Gym", "equipment": ["barbell"], "available_loads_kg": [20]},
            ],
            "active_equipment_location_id": "home",
        }
        await db.commit()
    api.provider.action = (
        "update_training_preferences",
        {
            "primary_goal": None,
            "experience": None,
            "equipment": ["dumbbell"],
            "available_days": None,
            "session_minutes": None,
        },
    )
    accepted, _ = await action(api)
    assert accepted.status_code == 200, accepted.text
    current = (await api.client.get("/api/v1/workouts/profile")).json()
    assert current["equipment"] == ["dumbbell"]
    assert current["equipment_locations"][0]["equipment"] == ["dumbbell"]
    assert current["equipment_locations"][1]["equipment"] == ["barbell"]


@pytest.mark.parametrize("instructions", ["legacy", "present", "cleared"])
@pytest.mark.parametrize("transport", ["json", "stream"])
async def test_coach_receives_source_flow_and_timed_actuals_without_private_notes(coach_api, instructions, transport, monkeypatch):
    api = coach_api
    workout = await create_workout(api)
    identifier, client_id = uuid4(), uuid4()
    flow = "Repeat the circuit for 20 minutes."
    async with api.sessions() as db:
        row = await db.get(WorkoutRecord, UUID(workout["id"]))
        content = json.loads(json.dumps(row.content))
        content.update(provenance="source", notes=[flow, "PRIVATE WORKOUT NOTE"],
            source_context={"parts": [{"location": "caption", "text": "PRIVATE RAW CAPTION"}]})
        if instructions != "legacy":
            content["instructions"] = [flow] if instructions == "present" else []
        content["blocks"][0]["evidence"] = [
            {"field": "workout_notes" if instructions == "legacy" else "workout_instructions",
             "wording": flow, "location": "caption"}
        ]
        row.content = content
        actual = {
            "client_session_id": str(client_id), "workout_id": str(row.id),
            "status": "partial", "started_at": now().isoformat(), "active_seconds": 125,
            "activity_type": "running", "notes": "PRIVATE SESSION NOTE",
            "prescription_snapshot": content,
            "actuals": [{"block_id": "main", "exercise_index": 0, "set_index": 1,
                         "completed": True, "duration_seconds": 125, "distance_meters": 400,
                         "effort": 7, "notes": "PRIVATE SET NOTE"}],
        }
        db.add(WorkoutsSession(id=identifier, app_user_id="owner", generation=1,
                              client_session_id=client_id, request_hash=content_digest(actual),
                              source_workout_id=row.id, content=actual))
        await db.commit()
    if transport == "stream":
        original = api.provider.respond
        async def respond(items, *, tools, on_text_delta):
            await on_text_delta("Provisional text")
            return await original(items, tools=tools)
        request, unused = await stream_fixture(api, monkeypatch, respond)
        await unused.aclose()
        response = await api.client.post("/api/v1/workouts/coach/messages/stream",
            headers=GENERATION, json=request.model_dump(mode="json"))
        assert response.status_code == 200
        assert json.loads(response.text.splitlines()[-1])["receipt"]["state"] == "completed"
        assert "PRIVATE" not in response.text
    else:
        assert (await send(api)).status_code == 200
    context = json.loads(api.provider.sent[-1][1]["content"].split("\n", 1)[1])
    expected = [] if instructions == "cleared" else [flow]
    assert context["library"][0]["content"].get("source_instructions", []) == expected
    result = context["actuals"][0]
    assert result["active_seconds"] == 125 and result["activity_type"] == "running"
    assert result.get("source_instructions", []) == expected
    assert result["actuals"][0]["duration_seconds"] == 125
    assert result["actuals"][0]["distance_meters"] == 400
    assert result["actuals"][0]["effort"] == 7
    assert "PRIVATE" not in json.dumps(context)
    if instructions == "cleared":
        assert flow not in json.dumps(context)  # Legacy notes cannot resurrect explicitly cleared instructions.


async def test_oversized_focused_workout_reports_missing_context_instead_of_silent_omission(coach_api):
    api = coach_api
    workout = await create_workout(api)
    async with api.sessions() as db:
        row = await db.get(WorkoutRecord, UUID(workout["id"]))
        content = json.loads(json.dumps(row.content))
        content["blocks"][0]["exercises"] *= 100
        row.content = content
        await db.commit()
        accepted = await coach.require_ai_consent(db, "owner", 1)
        with pytest.raises(HTTPException) as error:
            await coach.build_context(db, "owner", 1, accepted, focus={"context_workout_id": workout["id"], "context_revision": 1})
        assert error.value.status_code == 409
        assert "selected training context is too large" in error.value.detail
    assert api.provider.sent == []


@pytest.mark.parametrize("path", ["direct", "coach"])
async def test_unused_missed_move_to_today_preserves_snapshot_state_and_versions(coach_api, path):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    async with api.sessions() as db:
        program = await db.get(WorkoutsProgram, UUID(identifier))
        stored_profile = await db.get(WorkoutsProfile, "owner")
        stored_profile.content = stored_profile.content | {"available_days": list(range(7)), "timezone": "UTC"}
        content = json.loads(json.dumps(program.content))
        session = content["proposal"]["sessions"][0]
        session["date"] = (now() - timedelta(days=7)).date().isoformat()
        content["schedule_state"] = {"status": "active", "paused_at": "2026-01-01T00:00:00+00:00"}
        program.content = content
        await db.commit()
    original = json.loads(json.dumps(content))
    target = now().date().isoformat()
    if path == "direct":
        changed = json.loads(json.dumps(content))
        changed["proposal"]["sessions"][0]["date"] = target
        response = await api.client.put(
            f"/api/v1/workouts/programs/{identifier}?expected_revision=1",
            headers=GENERATION, json={"title": content["title"], "proposal": changed["proposal"]},
        )
        proposal_id = None
    else:
        api.provider.action = ("edit_future_schedule", {
            "program_id": identifier, "expected_revision": 1, "session_id": session["id"],
            "operation": "move", "target_date": target,
        })
        response, proposal_id = await action(api)
    assert response.status_code == 200, response.text
    saved = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    assert saved["revision"] == 2
    selected = next(item for item in saved["content"]["proposal"]["sessions"] if item["id"] == session["id"])
    assert selected == session | {"date": target}
    assert saved["content"]["schedule_state"] == original["schedule_state"]
    versions = (await api.client.get(f"/api/v1/workouts/programs/{identifier}/versions")).json()
    assert [item["revision"] for item in versions] == [2, 1]
    if proposal_id:
        undone, _ = await action(api, "undo", proposal_id)
        assert undone.status_code == 200, undone.text
        restored = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
        assert restored["revision"] == 3 and restored["content"] == original


@pytest.mark.parametrize("status,actuals", [("partial", []), ("completed", [])])
async def test_direct_program_edit_cannot_move_or_rewrite_any_recorded_prescription(coach_api, status, actuals):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    saved = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    content = saved["content"]
    session = content["proposal"]["sessions"][0]
    recording = await api.client.post("/api/v1/workouts/sessions", headers=GENERATION, json={
        "client_session_id": str(uuid4()), "program_id": identifier, "program_revision": 1,
        "program_session_id": session["id"], "started_at": now().isoformat(),
        "finished_at": now().isoformat(), "status": status, "actuals": actuals,
    })
    assert recording.status_code == 201, recording.text
    for edit in ("date", "workout"):
        changed = json.loads(json.dumps(content))
        if edit == "date":
            changed["proposal"]["sessions"][0]["date"] = (now() + timedelta(days=60)).date().isoformat()
        else:
            changed["proposal"]["sessions"][0]["workout"]["title"] = "Changed prescription"
        response = await api.client.put(
            f"/api/v1/workouts/programs/{identifier}?expected_revision=1", headers=GENERATION,
            json={"title": content["title"], "proposal": changed["proposal"]},
        )
        assert response.status_code == 409 and "Recorded" in response.json()["detail"], response.text
    unchanged = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    assert unchanged["revision"] == 1 and unchanged["content"] == content


async def test_move_conflicts_are_shared_owner_scoped_and_rechecked_at_acceptance(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    saved = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    content = saved["content"]
    session = content["proposal"]["sessions"][0]
    target = now().date() + timedelta(days=60)
    target += timedelta(days=(-target.weekday()) % 7)
    changed = json.loads(json.dumps(content))
    changed["proposal"]["sessions"][0]["date"] = target.isoformat()
    arguments = {"program_id": identifier, "expected_revision": 1, "session_id": session["id"],
                 "operation": "move", "target_date": target.isoformat()}
    conflict = json.loads(json.dumps(content))
    conflict["proposal"]["sessions"] = [session | {"date": target.isoformat()}]
    # Another owner's date and an earlier enrollment's date are never constraints.
    async with api.sessions() as db:
        db.add_all([
            WorkoutsProgram(id=uuid4(), app_user_id="other", generation=1, revision=1, content=conflict),
            WorkoutsProgram(id=uuid4(), app_user_id="owner", generation=2, revision=1, content=conflict),
        ])
        await db.commit()
        await prepare_action(db, "owner", 1, "edit_future_schedule", arguments)
    api.provider.action = "edit_future_schedule", arguments
    prepared = await send(api)
    assert prepared.status_code == 200 and prepared.json()["actions"], prepared.text
    proposal_id = prepared.json()["actions"][0]["proposal_id"]
    async with api.sessions() as db:
        db.add(WorkoutsProgram(id=uuid4(), app_user_id="owner", generation=1, revision=1, content=conflict))
        await db.commit()
        with pytest.raises(HTTPException) as error:
            await prepare_action(db, "owner", 1, "edit_future_schedule", arguments)
        assert "Another plan" in error.value.detail
    direct = await api.client.put(
        f"/api/v1/workouts/programs/{identifier}?expected_revision=1", headers=GENERATION,
        json={"title": content["title"], "proposal": changed["proposal"]},
    )
    assert direct.status_code == 409 and "Another plan" in direct.json()["detail"], direct.text
    accepted, _ = await action(api, proposal_id=proposal_id)
    assert accepted.status_code == 409 and "Another plan" in accepted.json()["detail"], accepted.text
    current = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    assert current["revision"] == 1 and current["content"] == content


@pytest.mark.parametrize("paused", [False, True])
async def test_plan_archive_round_trip_preserves_versions_and_blocks_legacy_activation(coach_api, paused):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    async with api.sessions() as db:
        program = await db.get(WorkoutsProgram, UUID(identifier))
        content = json.loads(json.dumps(program.content))
        if paused:
            queued = content["proposal"]["sessions"][1:]
            content["proposal"]["sessions"] = content["proposal"]["sessions"][:1]
            content["schedule_state"] = {"status": "paused", "paused_sessions": queued,
                                         "paused_at": now().isoformat()}
            program.content = content
            await db.commit()
    path = f"/api/v1/workouts/programs/{identifier}/archive"
    archived = await api.client.put(path + "?expected_revision=1", headers=GENERATION, json={"archived": True})
    assert archived.status_code == 200, archived.text
    assert archived.json()["revision"] == 2
    assert archived.json()["content"]["proposal"] == content["proposal"]
    assert archived.json()["content"]["schedule_state"]["status"] == "paused"
    legacy = await api.client.put(f"/api/v1/workouts/programs/{identifier}?expected_revision=2",
                                 headers=GENERATION, json={"title": content["title"], "proposal": content["proposal"]})
    assert legacy.status_code == 409 and "Restore" in legacy.json()["detail"], legacy.text
    arguments = {"program_id": identifier, "expected_revision": 2, "operation": "return",
                 "shift_days": None, "start_date": (now() + timedelta(days=60)).date().isoformat()}
    async with api.sessions() as db:
        accepted_consent = await coach.require_ai_consent(db, "owner", 1)
        context, _ = await coach.build_context(db, "owner", 1, accepted_consent)
        assert context["programs"][0]["content"]["schedule_state"]["archived"] is True
        with pytest.raises(HTTPException) as error:
            await prepare_action(db, "owner", 1, "adjust_program_calendar", arguments)
        assert "Restore" in error.value.detail
        with pytest.raises(HTTPException) as error:
            await prepare_action(db, "owner", 1, "edit_future_schedule", {
                "program_id": identifier, "expected_revision": 2,
                "session_id": content["proposal"]["sessions"][0]["id"],
                "operation": "skip", "target_date": None,
            })
        assert "Restore" in error.value.detail
    review = await api.client.post(f"/api/v1/workouts/programs/{identifier}/review-proposal",
                                  headers=GENERATION, json={"program_revision": 2, "profile_revision": 1})
    assert review.status_code == 409 and "Restore" in review.json()["detail"], review.text
    # The exact same archive request is a no-op when its current revision is supplied.
    repeated = await api.client.put(path + "?expected_revision=2", headers=GENERATION, json={"archived": True})
    assert repeated.status_code == 200 and repeated.json()["revision"] == 2
    stale = await api.client.put(path + "?expected_revision=1", headers=GENERATION, json={"archived": False})
    assert stale.status_code == 409
    await enroll(api, other=True)
    foreign = await api.client.put(path + "?expected_revision=2", headers=GENERATION | {"X-Test-User": "other"}, json={"archived": False})
    assert foreign.status_code in (403, 404)
    wrong_generation = await api.client.put(path + "?expected_revision=2", headers={"X-Workouts-Generation": "2"}, json={"archived": False})
    assert wrong_generation.status_code == 409
    restored = await api.client.put(path + "?expected_revision=2", headers=GENERATION, json={"archived": False})
    assert restored.status_code == 200 and restored.json()["revision"] == 3
    assert restored.json()["content"] == content
    versions = (await api.client.get(f"/api/v1/workouts/programs/{identifier}/versions")).json()
    assert [item["revision"] for item in versions] == [3, 2, 1]
    assert versions[1]["content"]["schedule_state"]["archived_at"]


async def test_recorded_training_remains_readable_after_plan_archive(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    saved = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    session = saved["content"]["proposal"]["sessions"][0]
    recording = await api.client.post("/api/v1/workouts/sessions", headers=GENERATION, json={
        "client_session_id": str(uuid4()), "program_id": identifier, "program_revision": 1,
        "program_session_id": session["id"], "started_at": now().isoformat(),
        "finished_at": now().isoformat(), "status": "partial", "actuals": [],
    })
    assert recording.status_code == 201, recording.text
    before = recording.json()
    archived = await api.client.put(f"/api/v1/workouts/programs/{identifier}/archive?expected_revision=1",
                                   headers=GENERATION, json={"archived": True})
    assert archived.status_code == 200, archived.text
    reread = await api.client.get(f"/api/v1/workouts/sessions/{before['id']}")
    assert reread.json() == before


async def test_pending_coach_and_copy_acceptance_cannot_reactivate_an_archived_plan(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    accepted, _ = await action(api)
    identifier = accepted.json()["record_id"]
    content = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()["content"]
    session = content["proposal"]["sessions"][0]
    api.provider.action = "edit_future_schedule", {
        "program_id": identifier, "expected_revision": 1, "session_id": session["id"],
        "operation": "skip", "target_date": None,
    }
    prepared = await send(api)
    assert prepared.status_code == 200 and prepared.json()["actions"], prepared.text
    coach_proposal_id = prepared.json()["actions"][0]["proposal_id"]
    async with api.sessions() as db:
        pending_copy = await automation_router.persist_proposal(
            db, "owner", 1, "program", 1, content["proposal"],
            target_id=UUID(identifier), target_revision=1,
        )
        copy_proposal_id = pending_copy.id
        await db.commit()
    archived = await api.client.put(f"/api/v1/workouts/programs/{identifier}/archive?expected_revision=1",
                                   headers=GENERATION, json={"archived": True})
    assert archived.status_code == 200, archived.text
    coached, _ = await action(api, proposal_id=coach_proposal_id)
    assert coached.status_code == 409 and "Restore" in coached.json()["detail"], coached.text
    copied = await api.client.post(f"/api/v1/workouts/program-proposals/{copy_proposal_id}/accept",
                                  headers=GENERATION, json={"title": "Changed title"})
    assert copied.status_code == 409 and "Restore" in copied.json()["detail"], copied.text
    current = (await api.client.get(f"/api/v1/workouts/programs/{identifier}")).json()
    assert current == archived.json()


async def stop(api, identifier, *, headers=GENERATION):
    return await api.client.post(
        f"/api/v1/workouts/coach/messages/{identifier}/cancel", headers=headers
    )


async def test_stop_before_send_is_hidden_bounded_receipt_and_never_starts_provider(coach_api):
    api = coach_api
    identifier = uuid4()
    stopped = await stop(api, identifier)
    assert stopped.status_code == 200, stopped.text
    assert stopped.headers["Cache-Control"] == "no-store"
    assert stopped.json()["state"] == "failed" and stopped.json()["cancelled"] is True
    assert (await stop(api, identifier)).json() == stopped.json()
    assert (await send(api, request_id=identifier)).json() == stopped.json()
    assert not api.provider.sent
    assert (await api.client.get("/api/v1/workouts/coach/messages")).json()["messages"] == []
    async with api.sessions() as db:
        row = await db.scalar(select(WorkoutCoachMessage))
        assert row.request_hash == "0" * 64
        assert row.user_message == row.assistant_message == ""
        assert await coach_control.message_quota_count(db, "owner") == 1


async def test_stop_closes_only_exact_request_retains_hash_and_blocks_paid_replay(coach_api):
    api = coach_api
    entered, closed, release_other = asyncio.Event(), asyncio.Event(), asyncio.Event()
    count = 0

    async def blocked():
        nonlocal count
        count += 1
        if count == 1:
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                closed.set()
        else:
            await release_other.wait()

    api.provider.before_response = blocked
    identifier = uuid4()
    first = asyncio.create_task(send(api, request_id=identifier))
    await asyncio.wait_for(entered.wait(), 5)
    second = asyncio.create_task(send(api))
    try:
        assert (await stop(api, identifier, headers={"X-Workouts-Generation": "2"})).status_code == 409
        await enroll(api, other=True)
        foreign = await stop(api, identifier, headers=GENERATION | {"X-Test-User": "other"})
        assert foreign.status_code == 200 and foreign.json()["cancelled"] is True
        assert not first.done()
        async with api.sessions() as db:
            row = await db.scalar(select(WorkoutCoachMessage).where(
                WorkoutCoachMessage.app_user_id == "owner", WorkoutCoachMessage.request_id == identifier
            ))
            original_hash = row.request_hash
        result = await stop(api, identifier)
        assert result.json()["cancelled"] is True and result.json()["actions"] == []
        with pytest.raises(asyncio.CancelledError):
            await first
        await asyncio.wait_for(closed.wait(), 5)
        assert not second.done()
        replay = await send(api, request_id=identifier)
        assert replay.json() == result.json()
        assert (await send(api, "Changed message", identifier)).status_code == 409
        async with api.sessions() as db:
            row = await db.get(WorkoutCoachMessage, UUID(result.json()["id"]))
            assert row.request_hash == original_hash and "token" not in row.proposals
            assert row.proposals["state"] == "failed" and row.proposals["cancelled"] is True
            assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0
        release_other.set()
        assert (await second).status_code == 200
        assert len(api.provider.sent) == 2
        assert not api.coach._inflight and not api.coach._requests
    finally:
        release_other.set()
        for task in (first, second):
            if not task.done():
                task.cancel()
        await asyncio.gather(first, second, return_exceptions=True)


@pytest.mark.parametrize("turn", [1, 2])
async def test_other_worker_stop_closes_actual_provider_and_fences_tool_proposals(coach_api, monkeypatch, turn):
    api = coach_api
    entered, closed = asyncio.Event(), asyncio.Event()
    api.provider.action = plan_action()

    async def blocked():
        if len(api.provider.sent) == turn:
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                closed.set()

    api.provider.before_response = blocked
    identifier = uuid4()
    original = asyncio.create_task(send(api, request_id=identifier))
    await asyncio.wait_for(entered.wait(), 5)
    other_worker = coach.WorkoutCoach(api.provider, session_factory=api.sessions)
    monkeypatch.setattr(coach_router, "workout_coach", other_worker)
    try:
        stopped = await stop(api, identifier)
        assert stopped.status_code == 200 and stopped.json()["cancelled"] is True
        response = await asyncio.wait_for(original, 5)
        assert response.status_code == 409, response.text
        assert closed.is_set()
        assert (await send(api, request_id=identifier)).json() == stopped.json()
        assert len(api.provider.sent) == turn
        async with api.sessions() as db:
            assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0
            assert await db.scalar(select(func.count()).select_from(WorkoutsProgram)) == 0
            assert await coach_control.message_quota_count(db, "owner") == 1
        assert not api.coach._inflight and not api.coach._requests
    finally:
        if not original.done():
            original.cancel()
        await asyncio.gather(original, return_exceptions=True)


async def test_completed_reply_wins_stop_race_and_keeps_reviewable_actions(coach_api):
    api = coach_api
    api.provider.action = plan_action()
    identifier = uuid4()
    completed = await send(api, request_id=identifier)
    assert completed.status_code == 200
    assert completed.json()["state"] == "completed" and completed.json()["actions"]
    stopped = await stop(api, identifier)
    assert stopped.json() == completed.json() and "cancelled" not in stopped.json()
    assert (await send(api, request_id=identifier)).json() == completed.json()
    assert len(api.provider.sent) == 2
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 1
        assert await db.scalar(select(func.count()).select_from(WorkoutsProgram)) == 0


async def test_stop_remains_callable_after_ai_disabled_and_consent_revoked(coach_api, monkeypatch):
    api = coach_api
    entered = asyncio.Event()

    async def blocked():
        entered.set()
        await asyncio.Event().wait()

    api.provider.before_response = blocked
    identifier = uuid4()
    original = asyncio.create_task(send(api, request_id=identifier))
    await asyncio.wait_for(entered.wait(), 5)
    try:
        await consent(api, False)
        configured = settings(workouts_ai_enabled=False)
        monkeypatch.setattr(coach_router, "get_settings", lambda: configured)
        monkeypatch.setattr(coach_control, "get_settings", lambda: configured)
        stopped = await stop(api, identifier)
        assert stopped.status_code == 200 and stopped.json()["cancelled"] is True
        with pytest.raises(asyncio.CancelledError):
            await original
        assert (await stop(api, uuid4())).status_code == 200
        assert (await send(api, request_id=identifier)).status_code == 503
        assert len(api.provider.sent) == 1
    finally:
        if not original.done():
            original.cancel()
        await asyncio.gather(original, return_exceptions=True)


async def test_unknown_stop_cannot_bypass_quota_but_existing_request_can_always_stop(coach_api):
    api = coach_api
    identifier = uuid4()
    async with api.sessions() as db:
        for index in range(50):
            db.add(WorkoutCoachMessage(
                id=uuid4(), app_user_id="owner", generation=1,
                request_id=identifier if index == 0 else uuid4(), request_hash="a" * 64,
                user_message="", assistant_message="", used_health_context=False,
                proposals={"state": "pending", "token": "reserved"} if index == 0 else {"state": "failed"},
            ))
        await db.commit()
    assert (await stop(api, uuid4())).status_code == 429
    result = await stop(api, identifier)
    assert result.status_code == 200 and result.json()["cancelled"] is True
    assert (await stop(api, identifier)).json() == result.json()
    async with api.sessions() as db:
        assert await coach_control.message_quota_count(db, "owner") == 50
    assert not api.provider.sent


async def stream_fixture(api, monkeypatch, respond):
    from app.domains.workouts.coach_delivery import message_events

    monkeypatch.setattr(coach, "get_settings", lambda: settings(workouts_ai_enabled=True))
    api.provider.respond = respond
    request = coach.CoachRequest(request_id=uuid4(), message="Help me plan my training")
    return request, message_events(api.coach, "owner", 1, request)


async def next_stream_event(events):
    return json.loads(await asyncio.wait_for(anext(events), timeout=5))


async def test_coach_stream_route_replays_one_durable_request_and_rejects_changed_payload(coach_api, monkeypatch):
    api = coach_api
    calls = []

    async def respond(items, *, tools, on_text_delta):
        calls.append(items)
        await on_text_delta("Real provider text")
        return answer("Authoritative final answer")

    request, unused = await stream_fixture(api, monkeypatch, respond)
    await unused.aclose()
    path = "/api/v1/workouts/coach/messages/stream"
    body = request.model_dump(mode="json")
    first = await api.client.post(path, headers=GENERATION, json=body)
    assert first.status_code == 200 and first.headers["content-type"].startswith("application/x-ndjson")
    assert first.headers["cache-control"] == "no-store" and first.headers["x-accel-buffering"] == "no"
    receipt = json.loads(first.text.splitlines()[-1])
    assert receipt["type"] == "receipt" and receipt["receipt"]["assistant_message"] == "Authoritative final answer"
    assert isinstance(receipt["receipt"]["created_at"], str)
    assert datetime.fromisoformat(receipt["receipt"]["created_at"]).tzinfo is not None
    assert all(isinstance(json.loads(line), dict) for line in first.text.splitlines())
    assert first.text.endswith("\n")
    replay = await api.client.post(path, headers=GENERATION, json=body)
    assert json.loads(replay.text)["receipt"] == receipt["receipt"]
    changed = await api.client.post(path, headers=GENERATION, json={**body, "message": "Different payload"})
    assert json.loads(changed.text) == {"type": "error", "code": "coach_request_unavailable", "status": 409,
                                       "request_id": str(request.request_id), "generation": 1}
    assert len(calls) == 1
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutCoachMessage)) == 1


async def test_coach_stream_delivers_actual_delta_before_completion_without_saving_partial_answer(coach_api, monkeypatch):
    api = coach_api
    release = asyncio.Event()

    async def respond(items, *, tools, on_text_delta):
        await on_text_delta("Actual early text")
        await release.wait()
        return answer("Final validated text")

    request, events = await stream_fixture(api, monkeypatch, respond)
    try:
        assert (await next_stream_event(events))["type"] == "reset"
        assert (await next_stream_event(events))["text"] == "Actual early text"
        async with api.sessions() as db:
            row = await db.scalar(select(WorkoutCoachMessage).where(WorkoutCoachMessage.request_id == request.request_id))
            assert row.proposals["state"] == "pending" and row.assistant_message == ""
        release.set()
        remaining = [json.loads(event) async for event in events]
        assert remaining[-1]["receipt"]["assistant_message"] == "Final validated text"
        assert remaining[-1]["receipt"]["state"] == "completed"
    finally:
        release.set()
        await events.aclose()
    assert not api.coach._requests and not api.coach._inflight


async def test_coach_stream_resets_first_turn_prose_before_tool_round_and_only_commits_reviewable_actions(coach_api, monkeypatch):
    api = coach_api
    first, second = asyncio.Event(), asyncio.Event()
    workout = await create_workout(api)
    private_context = {"parts": [{"location": "caption", "text": "PRIVATE RAW CAPTION"}]}
    async with api.sessions() as db:
        row = await db.get(WorkoutRecord, UUID(workout["id"]))
        row.content = {**row.content, "source_context": private_context, "instructions": []}
        await db.commit()
    async def compose(profile, start_date, weeks, sources):
        return build_program(profile, start_date, weeks)
    api.coach.compose_library_program = compose
    api.provider.action = plan_action()
    api.provider.action[1]["source_workout_ids"] = [workout["id"]]
    original = api.provider.respond

    async def respond(items, *, tools, on_text_delta):
        # Both initial context and recursive tool preview must exclude acquired text.
        assert "PRIVATE RAW CAPTION" not in json.dumps(items)
        assert "source_context" not in json.dumps(items)
        await on_text_delta("First-turn prose" if tools else "Review this proposal")
        await (first if tools else second).wait()
        return await original(items, tools=tools)

    request, events = await stream_fixture(api, monkeypatch, respond)
    try:
        assert await next_stream_event(events) == {"type": "reset", "turn": 1,
            "request_id": str(request.request_id), "generation": 1}
        assert (await next_stream_event(events))["text"] == "First-turn prose"
        first.set()
        assert (await next_stream_event(events))["turn"] == 2
        assert (await next_stream_event(events))["text"] == "Review this proposal"
        async with api.sessions() as db:
            assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0
        second.set()
        final = [json.loads(event) async for event in events]
        assert final[-1]["receipt"]["state"] == "completed"
        assert len(final[-1]["receipt"]["actions"]) == 1
        assert "preview" not in json.dumps(final) and "arguments" not in json.dumps(final)
    finally:
        first.set()
        second.set()
        await events.aclose()


async def test_coach_stream_remote_stop_discards_late_text_and_returns_durable_stop(coach_api, monkeypatch):
    api = coach_api
    closed = asyncio.Event()

    async def respond(items, *, tools, on_text_delta):
        await on_text_delta("Before Stop")
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    request, events = await stream_fixture(api, monkeypatch, respond)
    try:
        await next_stream_event(events)
        assert (await next_stream_event(events))["text"] == "Before Stop"
        # A different worker has no matching local task map; monitor must close I/O.
        remote = coach.WorkoutCoach(api.provider, session_factory=api.sessions)
        async with api.sessions() as db:
            stopped = await remote.cancel(db, "owner", 1, request.request_id)
        assert stopped["cancelled"] is True
        final = await next_stream_event(events)
        assert final["type"] == "receipt" and final["receipt"]["cancelled"] is True
        assert final["receipt"]["actions"] == [] and closed.is_set()
    finally:
        await events.aclose()


async def test_coach_stream_rereads_terminal_state_after_conversation_clear(coach_api, monkeypatch):
    api = coach_api
    complete = asyncio.Event()
    release = asyncio.Event()

    async def respond(items, *, tools, on_text_delta):
        await on_text_delta("Provisional text")
        await release.wait()
        complete.set()
        return answer("PRIVATE FINAL ANSWER")

    _, events = await stream_fixture(api, monkeypatch, respond)
    try:
        await next_stream_event(events)
        await next_stream_event(events)
        release.set()
        await asyncio.wait_for(complete.wait(), 5)
        # Serialize after completion's owner lock; either queued final or pending
        # is cleared before the next network delivery.
        async with api.sessions() as db:
            await coach.clear_conversation(db, "owner", 1)
        final = [json.loads(event) async for event in events]
        assert final[-1]["type"] == "error"
        assert "PRIVATE FINAL ANSWER" not in json.dumps(final)
    finally:
        release.set()
        await events.aclose()


async def test_coach_stream_slow_consumer_bounds_queue_and_disconnect_closes_exact_provider(coach_api, monkeypatch):
    api = coach_api
    blocked, closed = asyncio.Event(), asyncio.Event()
    emitted = []

    async def respond(items, *, tools, on_text_delta):
        try:
            for index in range(20):
                if index == 8:
                    blocked.set()
                await on_text_delta(str(index))
                emitted.append(index)
            return answer()
        finally:
            closed.set()

    _, events = await stream_fixture(api, monkeypatch, respond)
    assert (await next_stream_event(events))["type"] == "reset"
    await asyncio.wait_for(blocked.wait(), 5)
    assert len(emitted) <= 8  # One tiny bounded queue, not an accumulating transcript.
    await asyncio.wait_for(events.aclose(), 5)
    assert closed.is_set() and not api.coach._requests and not api.coach._inflight
    async with api.sessions() as db:
        row = await db.scalar(select(WorkoutCoachMessage))
        assert row.proposals["state"] == "failed" and row.assistant_message != ""


@pytest.mark.parametrize("retirement", ["consent", "profile"])
async def test_coach_stream_drops_queued_delta_after_its_authority_changes(coach_api, monkeypatch, retirement):
    api = coach_api
    release = asyncio.Event()

    async def respond(items, *, tools, on_text_delta):
        await on_text_delta("RETIRED PRIVATE DRAFT")
        await release.wait()
        return answer("RETIRED PRIVATE FINAL")

    _, events = await stream_fixture(api, monkeypatch, respond)
    try:
        await next_stream_event(events)
        if retirement == "consent":
            await consent(api, False)
        else:
            async with api.sessions.begin() as db:
                profile = await db.get(WorkoutsProfile, "owner")
                profile.revision += 1
                profile.updated_at = now()
        release.set()
        remaining = [json.loads(event) async for event in events]
        assert "RETIRED PRIVATE" not in json.dumps(remaining)
        assert remaining[-1]["type"] in {"error", "receipt"}
        if remaining[-1]["type"] == "receipt":
            assert remaining[-1]["receipt"]["state"] == "failed"
    finally:
        release.set()
        await events.aclose()


async def test_coach_stream_completion_wins_before_late_stop_and_retains_review(coach_api, monkeypatch):
    api = coach_api

    async def respond(items, *, tools, on_text_delta):
        await on_text_delta("Provisional")
        return answer("Completed answer")

    request, events = await stream_fixture(api, monkeypatch, respond)
    final = [json.loads(event) async for event in events][-1]["receipt"]
    async with api.sessions() as db:
        stopped = await api.coach.cancel(db, "owner", 1, request.request_id)
    assert jsonable_encoder(stopped) == final and final["state"] == "completed" and not final.get("cancelled")


async def test_coach_stream_disconnect_is_bounded_while_another_transaction_holds_owner_lock(coach_api, monkeypatch):
    from app.domains.workouts.lifecycle import membership_for

    api = coach_api
    closed = asyncio.Event()
    calls = []

    async def respond(items, *, tools, on_text_delta):
        calls.append(items)
        await on_text_delta("Before disconnect")
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    request, events = await stream_fixture(api, monkeypatch, respond)
    closing = None
    try:
        await next_stream_event(events)
        assert (await next_stream_event(events))["text"] == "Before disconnect"
        async with api.sessions() as blocker:
            await membership_for(blocker, "owner", generation=1, write=True)
            # Keep this lock held through disconnect AND cleanup assertions.
            baseline = api.engine.pool.checkedout()
            started = asyncio.get_running_loop().time()
            closing = asyncio.create_task(events.aclose())
            done, _ = await asyncio.wait({closing}, timeout=4)
            assert closing in done, "Owned stream cleanup waited for the held owner lock"
            await closing
            assert asyncio.get_running_loop().time() - started < 4
            assert closed.is_set() and not api.coach._requests and not api.coach._inflight
            assert api.engine.pool.checkedout() == baseline
            async with api.sessions() as db:
                row = await db.scalar(select(WorkoutCoachMessage).where(WorkoutCoachMessage.request_id == request.request_id))
                assert row.proposals["state"] in {"pending", "failed"}
                assert row.request_hash != "0" * 64 and not row.assistant_message.startswith("Before")
            await blocker.rollback()
        # A timed-out failure finalizer can retain pending; SAME UUID still does
        # not admit or charge another provider turn after its HTTP owner is gone.
        replay = await api.client.post("/api/v1/workouts/coach/messages", headers=GENERATION,
                                       json=request.model_dump(mode="json"))
        assert replay.status_code == 200 and replay.json()["state"] in {"pending", "failed"}
        assert len(calls) == 1
    finally:
        # On assertion failure the blocker context has already rolled back; let
        # old buggy code drain rather than hanging this regression's test runner.
        if closing is not None:
            await asyncio.gather(closing, return_exceptions=True)
        await events.aclose()


@pytest.fixture
async def coach_tcp_url(coach_api):
    """Existing opt-in uvicorn pattern; real loopback HTTP, synthetic providers."""
    import os
    import socket

    import uvicorn

    if os.environ.get("WORKOUTS_INGRESS_SOCKET_TEST") != "1":
        pytest.skip("Explicit socket runtime authorization required")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(
        coach_api.app, log_level="critical", access_log=False, lifespan="off",
    ))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        async with asyncio.timeout(5):
            while not server.started:
                if serving.done():
                    await serving
                await asyncio.sleep(0.01)
        yield f"http://127.0.0.1:{listener.getsockname()[1]}"
    finally:
        server.should_exit = True
        try:
            await asyncio.wait_for(serving, 5)
        finally:
            if not serving.done():
                serving.cancel()
                await asyncio.gather(serving, return_exceptions=True)
            listener.close()


async def test_coach_real_tcp_delivers_before_completion_and_replays_one_receipt(coach_api, coach_tcp_url, monkeypatch):
    import httpx

    api = coach_api
    release = asyncio.Event()
    calls = []

    async def respond(items, *, tools, on_text_delta):
        calls.append(items)
        await on_text_delta("Synthetic early text 🌴")
        await release.wait()
        return answer("Synthetic authoritative final")

    request, unused = await stream_fixture(api, monkeypatch, respond)
    await unused.aclose()
    body = request.model_dump(mode="json")
    path = "/api/v1/workouts/coach/messages/stream"
    try:
        async with httpx.AsyncClient(base_url=coach_tcp_url, timeout=5) as client:
            async with client.stream("POST", path, headers=GENERATION, json=body) as response:
                assert response.status_code == 200
                assert response.headers["content-type"].startswith("application/x-ndjson")
                events = response.aiter_lines()
                assert json.loads(await asyncio.wait_for(anext(events), 5))["type"] == "reset"
                assert json.loads(await asyncio.wait_for(anext(events), 5))["text"] == "Synthetic early text 🌴"
                async with api.sessions() as db:
                    row = await db.scalar(select(WorkoutCoachMessage).where(WorkoutCoachMessage.request_id == request.request_id))
                    assert row.proposals["state"] == "pending" and row.assistant_message == ""
                release.set()
                async with asyncio.timeout(5):
                    final = [json.loads(line) async for line in events][-1]["receipt"]
                assert final["state"] == "completed" and final["assistant_message"] == "Synthetic authoritative final"
            replay = await client.post(path, headers=GENERATION, json=body)
            assert json.loads(replay.text)["receipt"] == final
            changed = await client.post(path, headers=GENERATION, json={**body, "message": "Changed"})
            assert json.loads(changed.text)["type"] == "error" and json.loads(changed.text)["status"] == 409
        assert len(calls) == 1 and not api.coach._requests and not api.coach._inflight
    finally:
        release.set()


@pytest.mark.parametrize("retirement", ["stop", "clear"])
async def test_coach_real_tcp_retirement_drops_late_provider_text_and_replays_privately(coach_api, coach_tcp_url, monkeypatch, retirement):
    import httpx

    api = coach_api
    closed = asyncio.Event()
    calls = []

    async def respond(items, *, tools, on_text_delta):
        calls.append(items)
        await on_text_delta("Synthetic text before retirement")
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            # A cancellation-racing provider fragment must not escape its retired authority.
            await on_text_delta("RETIRED PRIVATE TEXT")
            raise
        finally:
            closed.set()

    request, unused = await stream_fixture(api, monkeypatch, respond)
    await unused.aclose()
    body = request.model_dump(mode="json")
    path = "/api/v1/workouts/coach/messages/stream"
    async with httpx.AsyncClient(base_url=coach_tcp_url, timeout=5) as client:
        async with client.stream("POST", path, headers=GENERATION, json=body) as response:
            assert response.status_code == 200
            events = response.aiter_lines()
            assert json.loads(await asyncio.wait_for(anext(events), 5))["type"] == "reset"
            assert json.loads(await asyncio.wait_for(anext(events), 5))["text"] == "Synthetic text before retirement"
            if retirement == "stop":
                stopped = await client.post(f"/api/v1/workouts/coach/messages/{request.request_id}/cancel", headers=GENERATION)
                assert stopped.status_code == 200 and stopped.json()["cancelled"] is True
            else:
                assert (await client.delete("/api/v1/workouts/coach/messages", headers=GENERATION)).status_code == 204
            async with asyncio.timeout(5):
                remaining = [json.loads(line) async for line in events]
            assert "RETIRED PRIVATE TEXT" not in json.dumps(remaining)
            if retirement == "stop":
                assert remaining[-1]["receipt"]["cancelled"] is True
                assert remaining[-1]["receipt"]["actions"] == []
            else:
                assert remaining[-1]["type"] == "error"
        replay = await client.post(path, headers=GENERATION, json=body)
        if retirement == "stop":
            assert json.loads(replay.text)["receipt"]["cancelled"] is True
        else:
            assert json.loads(replay.text)["type"] == "error" and json.loads(replay.text)["status"] == 410
    assert closed.is_set() and len(calls) == 1
    assert not api.coach._requests and not api.coach._inflight
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutProposal)) == 0


async def test_coach_real_tcp_slow_reader_disconnect_closes_owned_request_without_resend(coach_api, coach_tcp_url, monkeypatch):
    import httpx

    api = coach_api
    closed = asyncio.Event()
    calls = []

    async def respond(items, *, tools, on_text_delta):
        calls.append(items)
        await on_text_delta("Synthetic initial fragment")
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    request, unused = await stream_fixture(api, monkeypatch, respond)
    await unused.aclose()
    body = request.model_dump(mode="json")
    path = "/api/v1/workouts/coach/messages/stream"
    async with httpx.AsyncClient(base_url=coach_tcp_url, timeout=5) as client:
        async with client.stream("POST", path, headers=GENERATION, json=body) as response:
            events = response.aiter_lines()
            assert json.loads(await asyncio.wait_for(anext(events), 5))["type"] == "reset"
            # Deliberately stop consuming the remaining body. Small bounded output
            # does not claim to saturate OS buffers; direct queue tests cover that bound.
            async with api.sessions() as db:
                row = await db.scalar(select(WorkoutCoachMessage).where(WorkoutCoachMessage.request_id == request.request_id))
                assert row.proposals["state"] == "pending" and row.assistant_message == ""
        async with asyncio.timeout(5):
            await closed.wait()
            while api.coach._requests or api.coach._inflight:
                await asyncio.sleep(0.01)
        replay = await client.post(path, headers=GENERATION, json=body)
        receipt = json.loads(replay.text)["receipt"]
        assert receipt["state"] in {"pending", "failed"} and receipt["assistant_message"] != "Synthetic initial fragment"
    assert len(calls) == 1


async def private_attachment_fixture(api, monkeypatch):
    from types import SimpleNamespace

    from app.domains.workouts import coach_attachments

    await importlib.import_module("migrations.047_add_workouts_source_media").run_migration(
        configured=settings(), migration_engine=api.engine)
    await importlib.import_module("migrations.049_add_workouts_coach_attachments").run_migration(
        configured=settings(), migration_engine=api.engine)
    written = []
    async def store(identifier, image):
        from app.domains.workouts.coach_attachment_models import CoachAttachment
        from app.models.deletion import DeletionCleanupJob

        async with api.sessions() as db:
            row = await db.get(CoachAttachment, identifier)
            guard = await db.get(DeletionCleanupJob, row.cleanup_job_id)
            assert row.state == "pending" and guard.status == "queued"
            assert guard.storage_prefixes == [coach_attachments.prefix(identifier)]
            assert guard.next_attempt_at == row.expires_at
        written.append((identifier, image))
    monkeypatch.setattr(coach_attachments, "storage_service", SimpleNamespace(
        is_enabled=True, store_private_coach_image_locked=store,
        private_coach_image_url=lambda identifier, **_: f"https://signed.test/{identifier}?private=1"))
    return coach_attachments, written


def private_attachment_bytes(color="red"):
    import io

    from PIL import Image

    output = io.BytesIO()
    image = Image.new("RGB", (8, 8), color)
    exif = Image.Exif()
    exif[0x010E] = "PRIVATE_METADATA"
    image.save(output, format="JPEG", exif=exif)
    image.close()
    return output.getvalue()


async def test_private_image_receipt_replays_exact_bytes_and_never_uses_public_content(coach_api, monkeypatch):
    import io

    from PIL import Image

    from app.domains.workouts.coach_attachment_models import CoachAttachment

    api = coach_api
    images, writes = await private_attachment_fixture(api, monkeypatch)
    upload_id = uuid4()
    first = await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg")
    assert await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg") == first
    assert len(writes) == 1
    with Image.open(io.BytesIO(writes[0][1].data)) as normalized:
        assert normalized.format == "WEBP" and not normalized.getexif()
        assert b"PRIVATE_METADATA" not in writes[0][1].data
    with pytest.raises(HTTPException) as error:
        await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes("blue"), "image/jpeg")
    assert error.value.status_code == 409 and len(writes) == 1
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(CoachAttachment)) == 1
        assert (await images.read_url(db, "owner", 1, UUID(first["id"])))['expires_in'] == 60
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0
    capabilities = (await api.client.get("/api/v1/workouts/capabilities")).json()
    assert capabilities["coach_images"] is False


async def test_private_image_upload_failure_keeps_durable_cleanup_and_same_retry_identity(coach_api, monkeypatch):
    from app.domains.workouts.coach_attachment_models import CoachAttachment
    from app.models.deletion import DeletionCleanupJob

    api = coach_api
    images, writes = await private_attachment_fixture(api, monkeypatch)
    good_writer = images.storage_service.store_private_coach_image_locked
    async def failed(*_args):
        raise RuntimeError("Simulated storage outage")
    images.storage_service.store_private_coach_image_locked = failed
    upload_id = uuid4()
    with pytest.raises(RuntimeError):
        await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg")
    async with api.sessions() as db:
        row = await db.get(CoachAttachment, images.attachment_id("owner", 1, upload_id))
        assert row.state == "pending" and await db.get(DeletionCleanupJob, row.cleanup_job_id)
    images.storage_service.store_private_coach_image_locked = good_writer
    receipt = await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg")
    assert len(writes) == 1 and receipt["id"] == str(images.attachment_id("owner", 1, upload_id))


async def test_private_image_owner_consent_clear_expiry_and_product_erasure(coach_api, monkeypatch):
    from app.domains.workouts.coach_attachment_models import CoachAttachment
    from app.domains.workouts.models import WorkoutsConsent
    from app.models.deletion import DeletionCleanupJob

    api = coach_api
    images, _ = await private_attachment_fixture(api, monkeypatch)
    receipt = await images.upload(api.sessions, "owner", 1, uuid4(), private_attachment_bytes(), "image/jpeg")
    identifier = UUID(receipt["id"])
    await enroll(api, other=True)
    async with api.sessions() as db:
        with pytest.raises(HTTPException) as error:
            await images.read_url(db, "other", 1, identifier)
        assert error.value.status_code == 404
    async with api.sessions.begin() as db:
        row = await db.get(CoachAttachment, identifier)
        row.expires_at = now() - timedelta(seconds=1)
    async with api.sessions() as db:
        with pytest.raises(HTTPException) as error:
            await images.read_url(db, "owner", 1, identifier)
        assert error.value.status_code == 410
    receipt = await images.upload(api.sessions, "owner", 1, uuid4(), private_attachment_bytes(), "image/jpeg")
    identifier = UUID(receipt["id"])
    async with api.sessions.begin() as db:
        await coach.clear_conversation(db, "owner", 1)
    async with api.sessions() as db:
        assert (await db.get(CoachAttachment, identifier)).state == "deleted"
        jobs = (await db.scalars(select(DeletionCleanupJob))).all()
        assert any(job.next_attempt_at is None and images.prefix(identifier) in job.storage_prefixes for job in jobs)
        with pytest.raises(HTTPException) as error:
            await images.read_url(db, "owner", 1, identifier)
        assert error.value.status_code == 410
    async with api.sessions.begin() as db:
        (await db.get(WorkoutsConsent, "owner")).accepted_at = None
    with pytest.raises(HTTPException) as error:
        await images.upload(api.sessions, "owner", 1, uuid4(), private_attachment_bytes(), "image/jpeg")
    assert error.value.status_code == 403
    response = await api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert response.status_code == 200, response.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(CoachAttachment)) == 0
        assert any(images.prefix(identifier) in job.storage_prefixes for job in await db.scalars(select(DeletionCleanupJob)))


async def test_attachment049_is_optional_from047_and_marker_cannot_hide_schema_drift(coach_api):
    from sqlalchemy import text

    from app.domains.workouts.coach_attachments import attachments_ready

    api = coach_api
    await importlib.import_module("migrations.047_add_workouts_source_media").run_migration(
        configured=settings(), migration_engine=api.engine)
    async with api.sessions() as db:
        assert not await attachments_ready(db)
    migration049 = importlib.import_module("migrations.049_add_workouts_coach_attachments")
    await migration049.run_migration(configured=settings(), migration_engine=api.engine)
    await migration049.run_migration(configured=settings(), migration_engine=api.engine)
    async with api.sessions() as db:
        assert await attachments_ready(db)
        assert not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=48)"))
    async with api.engine.begin() as connection:
        await connection.execute(text("ALTER TABLE workouts_coach_attachments DROP COLUMN byte_hash"))
    async with api.sessions() as db:
        assert not await attachments_ready(db)
    with pytest.raises(RuntimeError, match="schema"):
        await migration049.run_migration(configured=settings(), migration_engine=api.engine)


@pytest.mark.parametrize("data,mime", [(b"not an image", "image/jpeg"), (b"x" * (2 * 1024 * 1024 + 1), "image/jpeg")])
def test_private_attachment_actual_bytes_are_bounded(data, mime):
    from app.domains.workouts.coach_attachments import normalized_image

    with pytest.raises(HTTPException) as error:
        normalized_image(data, mime)
    assert error.value.status_code == 422


def test_private_attachment_declared_mime_is_not_trusted():
    from app.domains.workouts.coach_attachments import normalized_image

    with pytest.raises(HTTPException) as error:
        normalized_image(private_attachment_bytes(), "image/png")
    assert error.value.status_code == 422


async def test_private_image_discard_before_upload_fences_late_source_bytes(coach_api, monkeypatch):
    from app.domains.workouts.coach_attachment_models import CoachAttachment

    api = coach_api
    images, writes = await private_attachment_fixture(api, monkeypatch)
    upload_id = uuid4()
    async with api.sessions.begin() as db:
        await images.retire_upload(db, "owner", 1, upload_id)
    with pytest.raises(HTTPException) as error:
        await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg")
    assert error.value.status_code == 410 and not writes
    async with api.sessions() as db:
        row = await db.get(CoachAttachment, images.attachment_id("owner", 1, upload_id))
        assert row.state == "deleted" and row.byte_hash == "0" * 64


async def test_private_image_clear_during_normalization_tombstones_pending_upload(coach_api, monkeypatch):
    import threading

    from app.domains.workouts.coach_attachment_models import CoachAttachment
    from app.models.deletion import DeletionCleanupJob

    api = coach_api
    images, writes = await private_attachment_fixture(api, monkeypatch)
    started, release = threading.Event(), threading.Event()
    normalize = images.normalized_image
    def blocked_normalize(*args):
        started.set()
        if not release.wait(10):
            raise RuntimeError("Test did not release normalization")
        return normalize(*args)
    monkeypatch.setattr(images, "normalized_image", blocked_normalize)
    upload_id = uuid4()
    identifier = images.attachment_id("owner", 1, upload_id)
    uploading = asyncio.create_task(images.upload(
        api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg"))
    try:
        assert await asyncio.wait_for(asyncio.to_thread(started.wait, 5), timeout=6)
        async with api.sessions() as db:
            row = await db.get(CoachAttachment, identifier)
            assert row.state == "pending" and row.byte_hash != "0" * 64
            cleanup = await db.get(DeletionCleanupJob, row.cleanup_job_id)
            assert cleanup.storage_prefixes == [images.prefix(identifier)]
            assert cleanup.status == "queued" and cleanup.next_attempt_at == row.expires_at
        async with api.sessions.begin() as db:
            await coach.clear_conversation(db, "owner", 1)
    finally:
        release.set()
        outcome, = await asyncio.wait_for(asyncio.gather(uploading, return_exceptions=True), timeout=6)
    assert isinstance(outcome, HTTPException) and outcome.status_code == 410 and not writes
    async with api.sessions() as db:
        assert (await db.get(CoachAttachment, identifier)).state == "deleted"
        with pytest.raises(HTTPException) as error:
            await images.read_url(db, "owner", 1, identifier)
        assert error.value.status_code == 410
    with pytest.raises(HTTPException) as error:
        await images.upload(api.sessions, "owner", 1, upload_id, private_attachment_bytes(), "image/jpeg")
    assert error.value.status_code == 410 and not writes


async def test_private_image_rechecks_consent_after_normalizing_before_storage(coach_api, monkeypatch):
    from app.domains.workouts.coach_attachment_models import CoachAttachment
    from app.domains.workouts.models import WorkoutsConsent

    api = coach_api
    images, writes = await private_attachment_fixture(api, monkeypatch)
    to_thread = asyncio.to_thread
    async def normalize_then_revoke(function, *args):
        image = await to_thread(function, *args)
        async with api.sessions.begin() as db:
            (await db.get(WorkoutsConsent, "owner")).accepted_at = None
        return image
    monkeypatch.setattr(images.asyncio, "to_thread", normalize_then_revoke)
    with pytest.raises(HTTPException) as error:
        await images.upload(api.sessions, "owner", 1, uuid4(), private_attachment_bytes(), "image/jpeg")
    assert error.value.status_code == 403 and not writes
    async with api.sessions() as db:
        rows = (await db.scalars(select(CoachAttachment))).all()
        assert len(rows) == 1 and rows[0].state == "pending"
        from app.models.deletion import DeletionCleanupJob

        cleanup = await db.get(DeletionCleanupJob, rows[0].cleanup_job_id)
        assert cleanup.storage_prefixes == [images.prefix(rows[0].id)]
        assert cleanup.status == "queued" and cleanup.next_attempt_at == rows[0].expires_at


async def test_private_image_signed_read_cannot_outlive_capture_expiry(coach_api, monkeypatch):
    from app.domains.workouts.coach_attachment_models import CoachAttachment

    api = coach_api
    images, _ = await private_attachment_fixture(api, monkeypatch)
    receipt = await images.upload(api.sessions, "owner", 1, uuid4(), private_attachment_bytes(), "image/jpeg")
    clock = now()
    monkeypatch.setattr(images, "now", lambda: clock)
    identifier = UUID(receipt["id"])
    async with api.sessions.begin() as db:
        (await db.get(CoachAttachment, identifier)).expires_at = clock + timedelta(seconds=10)
    async with api.sessions() as db:
        assert (await images.read_url(db, "owner", 1, identifier))["expires_in"] == 10


async def private_image_transport_fixture(api, monkeypatch):
    from app.domains.workouts import coach_attachment_router

    images, writes = await private_attachment_fixture(api, monkeypatch)
    api.app.include_router(coach_attachment_router.router)
    api.app.include_router(coach_attachment_router.upload_router)
    api.app.dependency_overrides[coach_attachment_router.attachment_sessions] = lambda: api.sessions
    monkeypatch.setattr(coach_attachment_router, "get_settings", lambda: settings(workouts_ai_enabled=True))
    return coach_attachment_router, images, writes


def private_image_upload_payload(color="red"):
    import base64

    return {"content_type": "image/jpeg", "base64_data": base64.b64encode(private_attachment_bytes(color)).decode("ascii")}


async def test_private_image_transport_replays_and_enforces_owner_generation_and_privacy(coach_api, monkeypatch):
    api = coach_api
    routes, images, writes = await private_image_transport_fixture(api, monkeypatch)
    upload_id = uuid4()
    path = f"/api/v1/workouts/coach/image-uploads/{upload_id}"
    payload = private_image_upload_payload()
    response = await api.client.post(path, headers=GENERATION, json=payload)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert set(response.json()) == {"id", "expires_at"}
    assert (await api.client.post(path, headers=GENERATION, json=payload)).json() == response.json()
    changed = await api.client.post(path, headers=GENERATION, json=private_image_upload_payload("blue"))
    assert changed.status_code == 409 and len(writes) == 1
    read = f"/api/v1/workouts/coach/images/{response.json()['id']}"
    signed = await api.client.get(read, headers=GENERATION)
    assert signed.status_code == 200 and signed.json()["expires_in"] == 60
    assert signed.headers["Cache-Control"] == "no-store"
    await enroll(api, other=True)
    for method in [api.client.get, api.client.delete]:
        assert (await method(read, headers=GENERATION | {"X-Test-User": "other"})).status_code == 404
        assert (await method(read, headers={"X-Workouts-Generation": "2"})).status_code == 409
    assert (await api.client.post(path, headers=GENERATION | {"X-Hafa-Account-ID": "other"}, json=payload)).status_code == 409
    assert (await api.client.post(path, json=payload)).status_code == 422
    assert (await api.client.get(read, headers=GENERATION)).status_code == 200
    assert not api.provider.sent
    assert (await api.client.get("/api/v1/workouts/capabilities")).json()["coach_images"] is False
    # Storage is not photo coaching: the old strict message contract stays closed.
    rejected = await api.client.post("/api/v1/workouts/coach/messages", headers=GENERATION,
        json={"request_id": str(uuid4()), "message": "Inspect this", "attachment_id": response.json()["id"]})
    assert rejected.status_code == 422 and not api.provider.sent
    monkeypatch.setattr(routes, "get_settings", lambda: settings(workouts_ai_enabled=False))
    async with api.sessions.begin() as db:
        from app.domains.workouts.models import WorkoutsConsent

        (await db.get(WorkoutsConsent, "owner")).accepted_at = None
    assert (await api.client.post(path, headers=GENERATION, json=payload)).status_code == 503
    assert (await api.client.delete(read, headers=GENERATION)).status_code == 204
    assert (await api.client.delete(read, headers=GENERATION)).status_code == 204
    assert (await api.client.get(read, headers=GENERATION)).status_code == 410
    assert (await api.client.delete(path, headers=GENERATION)).status_code == 204
    assert (await api.client.delete(f"/api/v1/workouts/coach/image-uploads/{uuid4()}", headers=GENERATION)).status_code == 204


@pytest.mark.parametrize("bad", [
    {"content_type": "image/jpeg", "base64_data": "PRIVATE_INVALID_PHOTO"},
    {"content_type": "image/jpeg", "base64_data": 123},
    {"content_type": "image/svg+xml", "base64_data": "PRIVATE_INVALID_PHOTO"},
    {"content_type": "image/jpeg", "base64_data": "x" * 2_796_205},
    {"content_type": "image/jpeg", "base64_data": "eA==", "url": "https://private.test/photo"},
])
async def test_private_image_transport_rejects_input_without_echoing_photo_or_writing(coach_api, monkeypatch, bad):
    from app.domains.workouts.coach_attachment_models import CoachAttachment

    api = coach_api
    _, _, writes = await private_image_transport_fixture(api, monkeypatch)
    response = await api.client.post(f"/api/v1/workouts/coach/image-uploads/{uuid4()}", headers=GENERATION, json=bad)
    assert response.status_code == 422 and len(response.content) < 200
    assert "PRIVATE_INVALID_PHOTO" not in response.text and "private.test" not in response.text
    assert not writes
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(CoachAttachment)) == 0


async def test_private_image_transport_bounds_chunked_body_and_decoded_bytes_before_admission(coach_api, monkeypatch):
    import base64

    from app.domains.workouts.coach_attachment_models import CoachAttachment

    api = coach_api
    _, _, writes = await private_image_transport_fixture(api, monkeypatch)
    path = f"/api/v1/workouts/coach/image-uploads/{uuid4()}"
    payload = {"content_type": "image/jpeg", "base64_data": base64.b64encode(b"x" * (2 * 1024 * 1024 + 1)).decode()}
    assert (await api.client.post(path, headers=GENERATION, json=payload)).status_code == 422
    async def oversized():
        yield b'{"base64_data":"'
        yield b"x" * (3 * 1024 * 1024)
        yield b'","content_type":"image/jpeg"}'
    response = await api.client.post(path, headers=GENERATION | {"Content-Type": "application/json"}, content=oversized())
    assert response.status_code == 413 and not writes
    malformed = await api.client.post(path, headers=GENERATION | {"Content-Type": "application/json"}, content=b'{"PRIVATE_PHOTO":')
    assert malformed.status_code == 422 and "PRIVATE_PHOTO" not in malformed.text
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(CoachAttachment)) == 0


async def test_private_image_transport_discard_original_uuid_prevents_late_upload(coach_api, monkeypatch):
    api = coach_api
    _, _, writes = await private_image_transport_fixture(api, monkeypatch)
    path = f"/api/v1/workouts/coach/image-uploads/{uuid4()}"
    assert (await api.client.delete(path, headers=GENERATION)).status_code == 204
    response = await api.client.post(path, headers=GENERATION, json=private_image_upload_payload())
    assert response.status_code == 410 and not writes


async def test_private_image_transport_clear_during_normalization_blocks_late_http_upload(coach_api, monkeypatch):
    import threading

    from app.domains.workouts.coach_attachment_models import CoachAttachment

    api = coach_api
    _, images, writes = await private_image_transport_fixture(api, monkeypatch)
    started, release = threading.Event(), threading.Event()
    normalize = images.normalized_image
    def blocked(*args):
        started.set()
        if not release.wait(10):
            raise RuntimeError("Test did not release normalization")
        return normalize(*args)
    monkeypatch.setattr(images, "normalized_image", blocked)
    upload_id = uuid4()
    pending = asyncio.create_task(api.client.post(f"/api/v1/workouts/coach/image-uploads/{upload_id}",
        headers=GENERATION, json=private_image_upload_payload()))
    try:
        assert await asyncio.wait_for(asyncio.to_thread(started.wait, 5), 6)
        cleared = await api.client.delete("/api/v1/workouts/coach/messages", headers=GENERATION)
        assert cleared.status_code == 204, cleared.text
    finally:
        release.set()
        outcome, = await asyncio.wait_for(asyncio.gather(pending, return_exceptions=True), 6)
    assert not isinstance(outcome, BaseException) and outcome.status_code == 410 and not writes
    identifier = images.attachment_id("owner", 1, upload_id)
    assert (await api.client.get(f"/api/v1/workouts/coach/images/{identifier}", headers=GENERATION)).status_code == 410
    async with api.sessions() as db:
        assert (await db.get(CoachAttachment, identifier)).state == "deleted"


async def test_private_image_transport_denies_missing_consent_and_optional_schema(coach_api, monkeypatch):
    from app.domains.workouts.models import WorkoutsConsent

    api = coach_api
    routes, images, writes = await private_image_transport_fixture(api, monkeypatch)
    path = f"/api/v1/workouts/coach/image-uploads/{uuid4()}"
    async with api.sessions.begin() as db:
        consent_row = await db.get(WorkoutsConsent, "owner")
        accepted_at = consent_row.accepted_at
        consent_row.accepted_at = None
    assert (await api.client.post(path, headers=GENERATION, json=private_image_upload_payload())).status_code == 403
    async with api.sessions.begin() as db:
        (await db.get(WorkoutsConsent, "owner")).accepted_at = accepted_at
    async def unavailable(_db):
        return False
    monkeypatch.setattr(images, "attachments_ready", unavailable)
    assert (await api.client.post(path, headers=GENERATION, json=private_image_upload_payload())).status_code == 503
    monkeypatch.setattr(routes, "get_settings", lambda: settings().model_copy(update={"workouts_api_enabled": False}))
    assert (await api.client.post(path, headers=GENERATION, content=b"not-json")).status_code == 404
    assert not writes and not api.provider.sent

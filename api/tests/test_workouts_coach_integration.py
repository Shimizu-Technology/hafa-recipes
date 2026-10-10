"""Own disposable PostgreSQL only: consent races, receipts, actuals, privacy."""

import asyncio
import importlib
import json
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.domains.workouts import automation_router, coach, coach_actions, coach_router
from app.domains.workouts.automation_models import WorkoutCoachMessage, WorkoutProposal
from app.domains.workouts.coach_actions import prepare_action
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsProfile,
    WorkoutsProgram,
    WorkoutsSession,
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
    monkeypatch.setattr(automation_router, "get_settings", lambda: configured)
    data_api.provider = FakeProvider()
    data_api.coach = coach.WorkoutCoach(data_api.provider)
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
    identifier = response.json()["actions"][0]["proposal_id"]
    inspected = await api.client.get(f"/api/v1/workouts/coach/actions/{identifier}")
    assert inspected.json()["proposal"]["evaluation"]["action"] == expected
    if expected == "increase_load":
        accepted, _ = await action(api, proposal_id=identifier)
        assert accepted.status_code == 200, accepted.text
        async with api.sessions() as db:
            saved = await db.get(WorkoutRecord, UUID(accepted.json()["record_id"]))
            assert saved.content["blocks"][0]["exercises"][0]["load"] == 21
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

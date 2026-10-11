"""Real PG receipts/versions for continuous coaching; no real model or device calls."""

# ruff: noqa: F811 -- pytest registers imported shared fixture names

from copy import deepcopy
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import select

from app.domains.workouts.automation_models import WorkoutProposal
from app.domains.workouts.coach_actions import recorded_program_ids
from app.domains.workouts.coach_continuity import expected_cells
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import WorkoutsProfile, WorkoutsProgram, WorkoutsSession
from app.domains.workouts.router import content_digest
from app.domains.workouts.schemas import WorkoutContent
from tests.test_workouts_coach_integration import (  # noqa: F401
    action,
    coach_api,
    create_workout,
    plan_action,
    send,
)
from tests.test_workouts_data_integration import GENERATION, data_api  # noqa: F401


async def program(api, *, running=False):
    if running:
        async with api.sessions() as db:
            profile = await db.get(WorkoutsProfile, "owner")
            profile.content = dict(
                profile.content,
                primary_goal="running",
                running_baseline={
                    "novice_start_confirmed": True,
                    "comfortable_walk_minutes": 20,
                    "accepted_stage": 0,
                },
                session_minutes=90,
            )
            profile.revision += 1
            profile.updated_at = now()
            await db.commit()
    name, args = plan_action()
    args["weeks"] = 4
    api.provider.action = name, args
    accepted, _ = await action(api)
    assert accepted.status_code == 200, accepted.text
    identifier = accepted.json()["record_id"]
    async with api.sessions() as db:
        row = await db.get(WorkoutsProgram, UUID(identifier))
        return identifier, deepcopy(row.content)


async def reviewed(api, name, arguments):
    api.provider.action = name, arguments
    response = await send(api)
    assert response.status_code == 200, response.text
    identifier = response.json()["actions"][0]["proposal_id"]
    preview = await api.client.get(f"/api/v1/workouts/coach/actions/{identifier}")
    assert preview.status_code == 200
    return identifier, preview.json()["proposal"]


async def record_session(api, identifier, session, *, days=1, mutate=None):
    content = WorkoutContent.model_validate(session["workout"])
    actuals = []
    for block in content.blocks:
        for index, exercise in enumerate(block.exercises):
            for round_index, set_index, side in sorted(expected_cells(block, index)):
                actuals.append(
                    {
                        "block_id": block.id,
                        "exercise_index": index,
                        "round_index": round_index,
                        "set_index": set_index,
                        "side": side,
                        "reps": exercise.reps_max,
                        "duration_seconds": exercise.duration_seconds,
                        "load": exercise.load,
                        "load_unit": exercise.load_unit,
                        "load_convention": exercise.load_convention,
                        "completed": True,
                        "difficulty": "manageable",
                        "pain_reported": False,
                    }
                )
    if mutate:
        mutate(actuals)
    started = now() - timedelta(days=days)
    seconds = sum(item.get("duration_seconds") or 0 for item in actuals)
    response = await api.client.post(
        "/api/v1/workouts/sessions",
        headers=GENERATION,
        json={
            "client_session_id": str(uuid4()),
            "program_id": identifier,
            "program_revision": 1,
            "program_session_id": session["id"],
            "started_at": started.isoformat(),
            "finished_at": (started + timedelta(seconds=max(seconds, 60))).isoformat(),
            "status": "completed",
            "actuals": actuals,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_pause_and_return_requires_fresh_readiness_and_direct_confirmation(coach_api):
    api = coach_api
    identifier, original = await program(api)
    pause_id, preview = await reviewed(
        api,
        "adjust_program_calendar",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "operation": "pause",
            "shift_days": None,
            "start_date": None,
        },
    )
    assert preview["program"]["schedule_state"]["status"] == "paused"
    accepted, _ = await action(api, proposal_id=pause_id)
    assert accepted.status_code == 200, accepted.text
    async with api.sessions() as db:
        row = await db.get(WorkoutsProgram, UUID(identifier))
        assert row.revision == 2 and row.content["proposal"]["sessions"] == []
        assert len(row.content["schedule_state"]["paused_sessions"]) == len(
            original["proposal"]["sessions"]
        )
    api.provider.action = (
        "adjust_program_calendar",
        {
            "program_id": identifier,
            "expected_revision": 2,
            "operation": "return",
            "shift_days": None,
            "start_date": (now() + timedelta(days=7)).date().isoformat(),
        },
    )
    assert (await send(api)).status_code == 409
    assert (
        await api.client.put(
            "/api/v1/workouts/readiness", headers=GENERATION, json={"state": "ready"}
        )
    ).status_code == 200
    return_id, preview = await reviewed(api, *api.provider.action)
    assert preview["confirmation_required"] is True
    assert (await action(api, proposal_id=return_id))[0].status_code == 422
    response = await api.client.post(
        f"/api/v1/workouts/coach/actions/{return_id}/accept",
        headers=GENERATION,
        json={"confirm_return_baseline": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 3
    undone, _ = await action(api, "undo", return_id)
    assert undone.status_code == 200, undone.text
    async with api.sessions() as db:
        row = await db.get(WorkoutsProgram, UUID(identifier))
        assert row.revision == 4 and row.content["schedule_state"]["status"] == "paused"


async def test_bulk_shift_accept_undo_versions_and_actuals_stale_it(coach_api):
    api = coach_api
    identifier, original = await program(api)
    proposal_id, preview = await reviewed(
        api,
        "adjust_program_calendar",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "operation": "shift",
            "shift_days": 7,
            "start_date": None,
        },
    )
    assert len(preview["session_ids"]) == len(original["proposal"]["sessions"])
    accepted, _ = await action(api, proposal_id=proposal_id)
    assert accepted.status_code == 200, accepted.text
    assert (await action(api, "undo", proposal_id))[0].status_code == 200
    async with api.sessions() as db:
        assert (await db.get(WorkoutsProgram, UUID(identifier))).content == original
    proposal_id, _ = await reviewed(
        api,
        "adjust_program_calendar",
        {
            "program_id": identifier,
            "expected_revision": 3,
            "operation": "shift",
            "shift_days": 7,
            "start_date": None,
        },
    )
    await record_session(api, identifier, original["proposal"]["sessions"][0])
    assert (await action(api, proposal_id=proposal_id))[0].status_code == 409


async def test_running_stage_accept_updates_profile_and_future_only_with_undo(coach_api):
    api = coach_api
    identifier, original = await program(api, running=True)
    for session, days in zip(original["proposal"]["sessions"][:3], [1, 3, 5]):
        await record_session(api, identifier, session, days=days)
    async with api.sessions() as db:
        before_actuals = [
            deepcopy(row.content)
            for row in (
                await db.scalars(select(WorkoutsSession).order_by(WorkoutsSession.id))
            ).all()
        ]
    proposal_id, preview = await reviewed(
        api, "review_running_stage", {"program_id": identifier, "expected_revision": 1}
    )
    assert preview["status"] == "ready" and preview["evaluation"]["action"] == "advance_stage"
    assert preview["operation"] == "running_stage"
    assert not set(preview["session_ids"]) & {
        item["id"] for item in original["proposal"]["sessions"][:3]
    }
    accepted, _ = await action(api, proposal_id=proposal_id)
    assert accepted.status_code == 200, accepted.text
    async with api.sessions() as db:
        profile = await db.get(WorkoutsProfile, "owner")
        row = await db.get(WorkoutsProgram, UUID(identifier))
        assert profile.content["running_baseline"]["accepted_stage"] == 1 and profile.revision == 3
        assert (
            row.revision == 2
            and row.content["proposal"]["sessions"][:3] == original["proposal"]["sessions"][:3]
        )
        assert [
            row.content
            for row in (
                await db.scalars(select(WorkoutsSession).order_by(WorkoutsSession.id))
            ).all()
        ] == before_actuals
    undone, _ = await action(api, "undo", proposal_id)
    assert undone.status_code == 200, undone.text
    async with api.sessions() as db:
        assert (await db.get(WorkoutsProfile, "owner")).content["running_baseline"][
            "accepted_stage"
        ] == 0
        assert (await db.get(WorkoutsProgram, UUID(identifier))).content == original


async def test_missing_running_feedback_repeats_and_never_changes_profile(coach_api):
    api = coach_api
    identifier, original = await program(api, running=True)
    for session, days in zip(original["proposal"]["sessions"][:3], [1, 3, 5]):
        await record_session(
            api,
            identifier,
            session,
            days=days,
            mutate=lambda values: values[0].update(pain_reported=None),
        )
    proposal_id, preview = await reviewed(
        api, "review_running_stage", {"program_id": identifier, "expected_revision": 1}
    )
    assert (
        preview["status"] == "needs_information"
        and preview["evaluation"]["action"] == "repeat_stage"
    )
    assert (await action(api, proposal_id=proposal_id))[0].status_code == 409
    async with api.sessions() as db:
        assert (await db.get(WorkoutsProfile, "owner")).content["running_baseline"][
            "accepted_stage"
        ] == 0


async def test_program_bodyweight_progression_modifies_matching_future_targets_only(coach_api):
    api = coach_api
    identifier, original = await program(api)
    strength = [
        item
        for item in original["proposal"]["sessions"]
        if item["workout"]["blocks"][0]["id"] == "strength"
    ]
    for session, days in zip(strength[:2], [1, 3]):
        await record_session(api, identifier, session, days=days)
    target = strength[2]
    proposal_id, preview = await reviewed(
        api,
        "review_program_exercise",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "session_id": target["id"],
            "block_id": "strength",
            "exercise_index": 0,
        },
    )
    assert preview["status"] == "ready" and preview["evaluation"]["action"] == "increase_reps"
    accepted, _ = await action(api, proposal_id=proposal_id)
    assert accepted.status_code == 200, accepted.text
    async with api.sessions() as db:
        saved = await db.get(WorkoutsProgram, UUID(identifier))
        changed = next(
            item for item in saved.content["proposal"]["sessions"] if item["id"] == target["id"]
        )
        before = target["workout"]["blocks"][0]["exercises"][0]
        assert changed["workout"]["blocks"][0]["exercises"][0]["reps_max"] == before["reps_max"] + 1
        assert all(
            next(item for item in saved.content["proposal"]["sessions"] if item["id"] == old["id"])
            == old
            for old in strength[:2]
        )
    assert (await action(api, "undo", proposal_id))[0].status_code == 200


async def test_recorded_freeze_has_no_latest_thirty_gap(coach_api):
    api = coach_api
    identifier, original = await program(api)
    protected = original["proposal"]["sessions"][0]["id"]
    async with api.sessions() as db:
        for index in range(35):
            content = {
                "program_session_id": protected if index == 0 else f"other-{index}",
                "started_at": now().isoformat(),
            }
            db.add(
                WorkoutsSession(
                    id=uuid4(),
                    app_user_id="owner",
                    generation=1,
                    client_session_id=uuid4(),
                    request_hash=content_digest(content),
                    source_program_id=UUID(identifier),
                    content=content,
                )
            )
        await db.commit()
        assert protected in await recorded_program_ids(db, "owner", 1, UUID(identifier))
    api.provider.action = (
        "edit_future_schedule",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "session_id": protected,
            "operation": "skip",
            "target_date": None,
        },
    )
    assert (await send(api)).status_code == 409


async def test_pause_is_available_when_readiness_unknown(coach_api):
    api = coach_api
    identifier, _ = await program(api)
    assert (
        await api.client.put(
            "/api/v1/workouts/readiness", headers=GENERATION, json={"state": "unknown"}
        )
    ).status_code == 200
    proposal_id, preview = await reviewed(
        api,
        "adjust_program_calendar",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "operation": "pause",
            "shift_days": None,
            "start_date": None,
        },
    )
    assert preview["status"] == "ready"
    accepted, _ = await action(api, proposal_id=proposal_id)
    assert accepted.status_code == 200, accepted.text


async def test_return_confirmation_is_strict_and_not_a_model_tool_argument(coach_api):
    api = coach_api
    identifier, _ = await program(api)
    proposal_id, _ = await reviewed(
        api,
        "adjust_program_calendar",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "operation": "return",
            "shift_days": None,
            "start_date": (now() + timedelta(days=7)).date().isoformat(),
        },
    )
    response = await api.client.post(
        f"/api/v1/workouts/coach/actions/{proposal_id}/accept",
        headers=GENERATION,
        json={"confirm_return_baseline": "true"},
    )
    assert response.status_code == 422
    async with api.sessions() as db:
        proposal = await db.get(WorkoutProposal, UUID(proposal_id))
        assert proposal.accepted_at is None


async def test_context_focus_retrieves_older_owned_workout_and_stales_revision(coach_api):
    api = coach_api
    selected = await create_workout(api)
    for _ in range(11):
        await create_workout(api)
    response = await api.client.post(
        "/api/v1/workouts/coach/messages",
        headers=GENERATION,
        json={
            "request_id": str(uuid4()),
            "message": "Explain this workout",
            "context_workout_id": selected["id"],
            "context_revision": 1,
        },
    )
    assert response.status_code == 200, response.text
    import json

    context = json.loads(api.provider.sent[-1][1]["content"].split("\n", 1)[1])
    assert any(item["id"] == selected["id"] for item in context["library"])
    assert response.json()["focus"]["context_workout_id"] == selected["id"]
    before = len(api.provider.sent)
    response = await api.client.post(
        "/api/v1/workouts/coach/messages",
        headers=GENERATION,
        json={
            "request_id": str(uuid4()),
            "message": "Explain this workout",
            "context_workout_id": selected["id"],
            "context_revision": 99,
        },
    )
    assert response.status_code == 409 and len(api.provider.sent) == before


async def test_unknown_or_unowned_focus_never_sends_and_mutual_focus_rejected(coach_api):
    api = coach_api
    response = await api.client.post(
        "/api/v1/workouts/coach/messages",
        headers=GENERATION,
        json={"request_id": str(uuid4()), "message": "Explain", "context_workout_id": str(uuid4())},
    )
    assert response.status_code == 404 and not api.provider.sent
    response = await api.client.post(
        "/api/v1/workouts/coach/messages",
        headers=GENERATION,
        json={
            "request_id": str(uuid4()),
            "message": "Explain",
            "context_workout_id": str(uuid4()),
            "context_program_id": str(uuid4()),
        },
    )
    assert response.status_code == 422 and not api.provider.sent


async def test_shorter_running_alternative_preserves_preparation_and_can_undo(coach_api):
    api = coach_api
    identifier, original = await program(api, running=True)
    selected = original["proposal"]["sessions"][0]
    proposal_id, preview = await reviewed(
        api,
        "prepare_session_alternative",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "session_id": selected["id"],
            "operation": "shorten",
            "other_session_id": None,
            "minutes": 18,
        },
    )
    assert preview["status"] == "ready"
    altered = next(
        item for item in preview["program"]["proposal"]["sessions"] if item["id"] == selected["id"]
    )["workout"]
    assert altered["blocks"][0]["exercises"][0]["duration_seconds"] == 300
    assert altered["blocks"][-1]["exercises"][0]["duration_seconds"] == 300
    assert altered["blocks"][1]["rounds"] < selected["workout"]["blocks"][1]["rounds"]
    assert (await action(api, proposal_id=proposal_id))[0].status_code == 200
    assert (await action(api, "undo", proposal_id))[0].status_code == 200


async def test_swap_is_previewed_then_versioned_and_undoable(coach_api):
    api = coach_api
    identifier, original = await program(api, running=True)
    one, two = original["proposal"]["sessions"][:2]
    proposal_id, preview = await reviewed(
        api,
        "prepare_session_alternative",
        {
            "program_id": identifier,
            "expected_revision": 1,
            "session_id": one["id"],
            "operation": "swap",
            "other_session_id": two["id"],
            "minutes": None,
        },
    )
    changed = {item["id"]: item for item in preview["program"]["proposal"]["sessions"]}
    assert changed[one["id"]]["date"] == two["date"] and changed[two["id"]]["date"] == one["date"]
    assert (await action(api, proposal_id=proposal_id))[0].status_code == 200
    assert (await action(api, "undo", proposal_id))[0].status_code == 200

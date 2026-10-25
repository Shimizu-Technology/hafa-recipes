"""Coach proposes and accepts a shorter imported copy with fake model responses."""

# ruff: noqa: F811 -- pytest registers imported shared fixture names

from uuid import UUID

import pytest
from sqlalchemy import select

from app.domains.workouts.automation_models import WorkoutProposal
from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
from app.domains.workouts.schemas import WorkoutContent
from tests.test_workouts_coach_integration import action, coach_api, send  # noqa: F401
from tests.test_workouts_data_integration import GENERATION, data_api  # noqa: F401
from tests.test_workouts_imported_adaptation import (
    near_saved_limit_case,
    original_directions,
    shortening_case,
)


@pytest.mark.parametrize("kind", ["rounds", "sets", "timed", "timed_sequential", "amrap", "long_cues"])
async def test_coach_shortens_imported_workout_and_accepts_separate_copy(coach_api, kind):
    api = coach_api
    source = shortening_case("sets" if kind == "long_cues" else kind)
    if kind == "long_cues":
        for index, item in enumerate(source.blocks[0].exercises):
            item.instructions = f"Cue {index}: " + "x" * 693
    payload = source.model_dump(mode="json", exclude={"id", "version", "parent_version_id"})
    payload["capture_kind"] = "text"
    created = await api.client.post("/api/v1/workouts/library", headers=GENERATION, json=payload)
    assert created.status_code == 201, created.text
    original = created.json()
    api.provider.action = "adapt_saved_workout", {
        "workout_id": original["id"], "expected_revision": 1, "minutes": 10,
    }
    response = await send(api, "Shorten to 10 minutes; keep the first 8 moves at 45 seconds work and 15 rest, leaving out the final 8."
                          if kind == "timed_sequential" else "Make my imported circuit shorter")
    assert response.status_code == 200, response.text
    receipt = response.json()["actions"][0]
    assert receipt["status"] == "ready"
    async with api.sessions() as db:
        proposal = await db.get(WorkoutProposal, UUID(receipt["proposal_id"]))
        suggested = proposal.content["workout"]
        originals = original_directions(WorkoutContent.model_validate(suggested))
        assert suggested["instructions"][0] == "Shortened by Coach: " + " ".join(proposal.content["changes"])
        assert payload["instructions"][0] in suggested["instructions"][1]
        assert suggested["blocks"][0]["label"] == "Shortened by Coach"
        for index, item in enumerate(suggested["blocks"][0]["exercises"]):
            source_item = payload["blocks"][0]["exercises"][index]
            assert f"Original exercise directions for {source_item['name']}:\n{source_item['instructions']}" in originals
            assert item["instructions"].startswith("Shortened by Coach:")
            assert "listed for this exercise" in item["instructions"]
            assert source_item["instructions"] not in item["instructions"]
            if kind == "sets":
                assert item["sets"] == 2 and item["reps_min"] == 8
        expected_count = 8 if kind in {"timed", "timed_sequential"} else len(payload["blocks"][0]["exercises"])
        assert [item["name"] for item in suggested["blocks"][0]["exercises"]] == [
            item["name"] for item in payload["blocks"][0]["exercises"][:expected_count]]
        assert suggested["parent_version_id"] == original["content"]["id"] and suggested["provenance"] == "suggestion"
        assert (await db.get(WorkoutRecord, UUID(original["id"]))).content == original["content"]
        assert len((await db.scalars(select(WorkoutRecord))).all()) == 1
        parent_version = await db.scalar(select(WorkoutVersion.id).where(
            WorkoutVersion.workout_id == UUID(original["id"]), WorkoutVersion.revision == 1))
    accepted, _ = await action(api, proposal_id=receipt["proposal_id"])
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["record_id"] != original["id"]
    replay, _ = await action(api, proposal_id=receipt["proposal_id"])
    assert replay.json() == accepted.json()
    saved = await api.client.get(f"/api/v1/workouts/library/{accepted.json()['record_id']}")
    assert saved.status_code == 200
    saved_content = saved.json()["content"]
    originals = original_directions(WorkoutContent.model_validate(saved_content))
    for item in payload["blocks"][0]["exercises"]:
        assert f"Original exercise directions for {item['name']}:\n{item['instructions']}" in originals
    for field in ("blocks", "title", "provenance", "instructions", "notes", "estimated_minutes"):
        assert saved_content[field] == suggested[field]
    assert saved_content["parent_version_id"] == str(parent_version)
    assert saved_content["version"] == 1 and saved_content["id"] == accepted.json()["record_id"]
    if kind == "timed_sequential":
        assert saved_content["estimated_minutes"] == 10
        block = saved_content["blocks"][0]
        assert block["grouping"] == "sequential" and block["rounds"] is None
        for item, source_item in zip(block["exercises"], payload["blocks"][0]["exercises"][:8], strict=True):
            for field in ("name", "sets", "reps_min", "reps_max", "duration_seconds", "rest_seconds", "per_side", "exercise_id"):
                assert item[field] == source_item[field]
        async with api.sessions() as db:
            assert len((await db.scalars(select(WorkoutRecord))).all()) == 2
    unchanged = await api.client.get(f"/api/v1/workouts/library/{original['id']}")
    assert unchanged.json() == original


@pytest.mark.parametrize("fits", [True, False])
async def test_adaptation_saved_limits_preserve_source_and_gate_acceptance(coach_api, fits):
    api = coach_api
    source = shortening_case("sets") if fits else near_saved_limit_case("😀")
    if fits:
        source.capture_kind = "text"
        for index, item in enumerate(source.blocks[0].exercises):
            item.instructions = f"Cue {index}: " + "x" * 1993
    payload = source.model_dump(mode="json", exclude={"id", "version", "parent_version_id"})
    created = await api.client.post("/api/v1/workouts/library", headers=GENERATION, json=payload)
    assert created.status_code == 201, created.text
    original = created.json()
    response = await api.client.post("/api/v1/workouts/adaptation-proposals", headers=GENERATION, json={
        "workout_id": original["id"], "workout_revision": 1, "profile_revision": 1, "minutes": 10,
    })
    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal["proposal"]["status"] == ("ready" if fits else "needs_information")
    accepted = await api.client.post(
        f"/api/v1/workouts/adaptation-proposals/{proposal['id']}/accept", headers=GENERATION)
    if fits:
        assert accepted.status_code == 200, accepted.text
        saved = await api.client.get(f"/api/v1/workouts/library/{accepted.json()['id']}")
        assert saved.status_code == 200
        originals = original_directions(WorkoutContent.model_validate(saved.json()["content"]))
        assert all(f"Original exercise directions for {item.name}:\n{item.instructions}" in originals
                   for item in source.blocks[0].exercises)
    else:
        assert proposal["proposal"]["workout"] is None
        assert "all original directions" in proposal["proposal"]["questions"][0]
        assert accepted.status_code == 409, accepted.text
    async with api.sessions() as db:
        assert len((await db.scalars(select(WorkoutRecord))).all()) == (2 if fits else 1)
    unchanged = await api.client.get(f"/api/v1/workouts/library/{original['id']}")
    assert unchanged.json() == original

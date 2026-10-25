"""Coach proposes and accepts a shorter imported copy with fake model responses."""

# ruff: noqa: F811 -- pytest registers imported shared fixture names

from uuid import UUID

from sqlalchemy import select

from app.domains.workouts.automation_models import WorkoutProposal
from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
from tests.test_workouts_coach_integration import action, coach_api, send  # noqa: F401
from tests.test_workouts_data_integration import GENERATION, data_api  # noqa: F401
from tests.test_workouts_imported_adaptation import NAMES, imported


async def test_coach_shortens_imported_circuit_and_accepts_separate_copy(coach_api):
    api = coach_api
    payload = imported().model_dump(mode="json", exclude={"id", "version", "parent_version_id"})
    payload["capture_kind"] = "text"
    created = await api.client.post("/api/v1/workouts/library", headers=GENERATION, json=payload)
    assert created.status_code == 201, created.text
    original = created.json()
    api.provider.action = "adapt_saved_workout", {
        "workout_id": original["id"], "expected_revision": 1, "minutes": 10,
    }
    response = await send(api, "Make my imported circuit shorter")
    assert response.status_code == 200, response.text
    receipt = response.json()["actions"][0]
    assert receipt["status"] == "ready"
    async with api.sessions() as db:
        proposal = await db.get(WorkoutProposal, UUID(receipt["proposal_id"]))
        suggested = proposal.content["workout"]
        assert suggested["blocks"][0]["rounds"] == 1
        assert [item["name"] for item in suggested["blocks"][0]["exercises"]] == NAMES
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
    for field in ("blocks", "title", "provenance", "instructions", "notes", "estimated_minutes"):
        assert saved_content[field] == suggested[field]
    assert saved_content["parent_version_id"] == str(parent_version)
    assert saved_content["version"] == 1 and saved_content["id"] == accepted.json()["record_id"]
    unchanged = await api.client.get(f"/api/v1/workouts/library/{original['id']}")
    assert unchanged.json() == original

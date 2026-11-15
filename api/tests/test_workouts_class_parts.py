"""Class prescriptions: exact source fixture, legacy compatibility and privacy."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domains.workouts.discover import public_workout
from app.domains.workouts.schemas import ExercisePrescription, WorkoutContent
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    GENERATION,
    data_api,
    enroll,
)
from tests.test_workouts_discover import accept_disclosure, discover_api  # noqa: F401

SAMPLE = json.loads((Path(__file__).parent / "fixtures/workouts_nov17_class.json").read_text())


def test_exact_sample_roundtrip():
    result = WorkoutContent.model_validate(SAMPLE)
    assert result.model_dump(mode="json", exclude_unset=True) == SAMPLE
    assert WorkoutContent.model_validate_json(result.model_dump_json()) == result


def test_legacy_shape_omits_all_class_keys():
    result = WorkoutContent(title="Legacy", blocks=[{"id": "a", "label": "A", "exercises": [{"name": "Run"}]}]).model_dump()
    assert not {"programming", "benchmark"} & result.keys()
    assert not {"role", "rest_after_seconds", "score_kind", "instructions"} & result["blocks"][0].keys()
    assert not {"segment", "distance_meters_min", "duration_seconds_max", "relative_load", "load_options"} & result["blocks"][0]["exercises"][0].keys()


@pytest.mark.parametrize("changes", [
    {"distance_meters_min": 500},
    {"distance_meters_min": 500, "distance_meters": 400},
    {"duration_seconds_max": 40},
    {"duration_seconds": 50, "duration_seconds_max": 40},
    {"load": 10, "load_unit": "kg", "load_convention": "total", "relative_load": {"basis": "bodyweight", "percent": 75}},
    {"relative_load": {"basis": "bodyweight", "percent": 75}, "load_options": [{"load": 20, "load_unit": "lb"}] * 2},
    {"load_options": [{"load": 20, "load_unit": "lb"}]},
    {"relative_load": {"basis": "bodyweight", "percent": 0}},
])
def test_invalid_exercise_fields(changes):
    with pytest.raises(ValidationError):
        ExercisePrescription(name="Run", **changes)


@pytest.mark.parametrize("change", ["last_rest", "unknown_benchmark", "stage", "buy_in_order", "cash_out_order", "untimed_segment"])
def test_invalid_class_rules(change):
    sample = deepcopy(SAMPLE)
    block = sample["blocks"][0]
    if change == "last_rest":
        sample["blocks"][-1]["rest_after_seconds"] = 0
    elif change == "unknown_benchmark":
        sample["benchmark"]["block_ids"] = ["missing"]
    elif change == "stage":
        sample["benchmark"]["stage"] = 4
    elif change == "buy_in_order":
        block["exercises"].reverse()
    elif change == "cash_out_order":
        block["exercises"][1]["segment"] = "cash_out"
    else:
        del block["execution"]
    with pytest.raises(ValidationError):
        WorkoutContent.model_validate(sample)


def test_public_projection_preserves_class_structure_without_private_tags():
    projected, incomplete = public_workout(SAMPLE)
    assert not incomplete
    assert "programming" not in projected and "benchmark" not in projected
    first = projected["blocks"][0]
    assert first["rest_after_seconds"] == 180 and first["role"] == "main"
    assert first["exercises"][0]["segment"] == "buy_in"
    assert first["exercises"][1]["relative_load"]["percent"] == 75
    assert projected["blocks"][1]["exercises"][1]["load_options"][0]["load"] == 20
    assert projected["blocks"][2]["instructions"] == ["Active recovery."]


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_class_save_edit_and_gym_publish_guard(discover_api):  # noqa: F811
    api = discover_api
    await enroll(api)
    await accept_disclosure(api, "owner")
    created = await api.client.post("/api/v1/workouts/library", json=SAMPLE, headers=GENERATION)
    assert created.status_code == 201, created.text
    saved = created.json()
    path = f'/api/v1/workouts/library/{saved["id"]}'
    publish = await api.client.post(path + "/publish", headers=GENERATION)
    assert publish.status_code == 422 and publish.json()["detail"] == "Gym programming stays private."
    # Older clients can drop unfamiliar class fields, but cannot drop gym privacy.
    legacy = {"title": "Legacy edit", "blocks": [{"id": "a", "label": "A", "exercises": [{"name": "Run", "distance_meters": 400}]}]}
    edited = await api.client.put(path, json=legacy, headers=GENERATION, params={"expected_revision": saved["revision"]})
    assert edited.status_code == 200, edited.text
    assert edited.json()["content"]["programming"] == saved["content"]["programming"]
    assert (await api.client.post(path + "/publish", headers=GENERATION)).status_code == 422

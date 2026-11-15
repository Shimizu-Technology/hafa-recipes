"""Class text, several screenshots and Safari PDFs use one mocked AI pipeline."""

import base64
import io
import json
import re
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.domains.workouts import extraction
from app.domains.workouts.extraction import ExtractionRequest, SourcePart, WorkoutExtractor
from app.domains.workouts.schemas import WorkoutContent
from tests.test_workout_extraction import FakeAcquirer, FakeProvider, evidence, image_data, text_pdf
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    GENERATION,
    data_api,
    enroll,
    settings,
)

SAMPLE = json.loads((Path(__file__).parent / "fixtures/workouts_nov17_class.json").read_text())

TEXT = '''Progression 2/3 for benchmark "Everest".
Hold a pace you can repeat in B.
Deadlifts unbroken at 75% bodyweight.
1000 m buy-in under 6:30.
A. AMRAP 15 min
Run buy-in 800-1000m Under 6:30
15 Deadlift 75% bodyweight Unbroken
20 Burpee
Run 300-400m
REST 3 MINS
B. AMRAP 15 min
Run buy-in 800-1000m
30 Wall Ball 20/14 lb
20 Burpee
Run 300-400m
C. Active recovery.
Bike Erg 10 minutes Easy Low damper. Nasal breathing only.
D. Accessories 2 alternating sets
GHD side-lying Pallof hold 30-40s rest 30 seconds
Cable Cuban press 10-12 reps tempo 3010 RIR 2-3 rest 30 seconds
Incline side-lying DB Powell raise 10-12 reps rest 30 seconds'''


def response():
    raw = deepcopy(SAMPLE)
    lines = TEXT.splitlines()
    for block in raw["blocks"]:
        heading = next(line for line in lines if line.startswith(block["label"] + "."))
        block["evidence"] = [evidence("execution.time_cap_seconds", heading), evidence("execution.mode", heading),
                             evidence("role", heading), evidence("rest_after_seconds", "REST 3 MINS"),
                             evidence("rounds", heading), evidence("benchmark", lines[0])]
        block["evidence"] += [evidence("instructions", v) for v in block.get("instructions", [])]
        block["evidence"] += [evidence("workout_instructions", v) for v in raw["instructions"]]
        for item in block["exercises"]:
            line = next(line for line in lines if re.search(rf"\b{re.escape(item['name'])}\b", line) and
                        (item["name"] != "Run" or ("buy-in" in line) == (item.get("segment") == "buy_in")))
            item["evidence"] = [evidence(k, line) for k in item if k not in {"evidence", "name"}] + [evidence("name", item["name"])]
    return raw


@pytest.mark.parametrize("kind", ["text", "images", "document"])
async def test_class_capture_uses_provider_without_fetching_wodup(kind, monkeypatch):
    raw = response()
    if kind == "images":
        for block in raw["blocks"]:
            for entry in block["evidence"] + [e for item in block["exercises"] for e in item["evidence"]]:
                entry["location"] = "image:0"
    provider, acquirer = FakeProvider(raw), FakeAcquirer()
    # PDF text parsing has independent bounded-process tests in test_workout_extraction.
    async def pdf(data):
        assert data.startswith(b"%PDF")
        return [SourcePart("provided_text", TEXT)]
    monkeypatch.setattr(extraction, "_pdf_parts", pdf)
    payload = {"text": TEXT} if kind == "text" else {"images": [extraction.ExtractionImage(base64_data=image_data(), mime_type="image/png")] * 2} if kind == "images" else {"document_base64": text_pdf(TEXT), "document_mime": "application/pdf"}
    result = await WorkoutExtractor(provider, acquirer).extract(ExtractionRequest(kind=kind, class_parts=True, ai_consent=True,
        source_url="https://wodup.com/program?token=never-store#private", programming=SAMPLE["programming"], **payload))
    from app.domains.workouts.automation_router import ImportRequest
    assert not ImportRequest(request_id=uuid4(), source={"kind": "text", "text": TEXT, "class_parts": True}, is_public=True).is_public
    assert not acquirer.calls and len(provider.calls) == 1
    assert provider.calls[0].class_parts
    assert result.workout is not None, result
    assert result.workout.source_url == "https://wodup.com/program"
    # Strip acquisition/evidence/server defaults; the design fixture remains exact.
    actual = result.workout.model_dump(mode="json")
    def subset(expected, value):
        if isinstance(expected, dict):
            return {k: subset(v, value[k]) for k, v in expected.items()}
        if isinstance(expected, list):
            assert len(expected) == len(value)
            return [subset(a, b) for a, b in zip(expected, value)]
        return value
    expected = {**SAMPLE, "capture_kind": kind}
    assert subset(expected, actual) == expected


async def test_old_import_shape_and_invented_benchmark():
    raw = response()
    raw["benchmark"]["name"] = "Invented"
    raw["instructions"].append("Invented coach cue")
    provider = FakeProvider(raw)
    result = await WorkoutExtractor(provider).extract(ExtractionRequest(kind="text", text=TEXT, ai_consent=True, class_parts=True))
    assert result.workout.benchmark is None and "Invented coach cue" not in result.workout.instructions
    legacy = await WorkoutExtractor(FakeProvider(response())).extract(ExtractionRequest(kind="text", text=TEXT, ai_consent=True))
    content = legacy.workout.model_dump()
    assert "benchmark" not in content and "programming" not in content
    assert "segment" not in content["blocks"][0]["exercises"][0]
    with pytest.raises(ValidationError):
        ExtractionRequest(kind="url", source_url="https://wodup.com/program", text=TEXT, ai_consent=True)


@pytest.mark.parametrize("change", ["clock", "order", "duration_unit"])
def test_grounding_keeps_a_serializable_class(change):
    raw = response()
    if change == "clock":
        raw["blocks"][0]["evidence"] = []
    elif change == "order":
        raw["blocks"][0]["exercises"].insert(0, deepcopy(raw["blocks"][0]["exercises"][0]))
        raw["blocks"][0]["exercises"][0]["evidence"] = [evidence("name", "Run")]
    else:
        item = raw["blocks"][3]["exercises"][0]
        item.update(duration_seconds=1800, duration_seconds_max=2400)
        item["evidence"].append(evidence("duration_seconds_max", "30-40 meters"))
    source = extraction.SourceBundle(extraction.SourceMetadata(), [SourcePart("provided_text", TEXT + "\n30-40 meters")])
    workout, warnings, _ = extraction.ground_workout(raw, source, class_parts=True)
    WorkoutContent.model_validate(workout.model_dump())
    assert warnings
    if change == "duration_unit":
        assert workout.blocks[3].exercises[0].duration_seconds_max is None


def test_better_fallback_cannot_erase_class_fields():
    original = WorkoutContent.model_validate(response())
    candidate = original.model_copy(deep=True)
    candidate.blocks[0].exercises.append(candidate.blocks[0].exercises[-1].model_copy())
    assert extraction._prescription_quality(candidate) > extraction._prescription_quality(original)
    for field in ("segment", "relative_load", "load_options", "distance_meters_min", "duration_seconds_max"):
        changed = candidate.model_copy(deep=True)
        for block in changed.blocks:
            for item in block.exercises:
                setattr(item, field, None)
        assert not extraction._prescription_preserves(changed, original)


@pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("marker", [True, False])
async def test_accept_edited_class_cannot_drop_gym_privacy(data_api, marker):  # noqa: F811
    import importlib

    from app.domains.workouts.automation_models import WorkoutImport
    from app.domains.workouts.automation_router import router
    from app.domains.workouts.lifecycle import now

    await enroll(data_api)
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(configured=settings(), migration_engine=data_api.engine)
    data_api.app.include_router(router)
    identifier = uuid4()
    result = deepcopy(SAMPLE)
    if not marker:
        result.pop("programming")
    async with data_api.sessions.begin() as db:
        db.add(WorkoutImport(id=identifier, app_user_id="owner", generation=1, request_id=uuid4(), request_hash="a" * 64,
            payload={"class_parts": True, "programming": SAMPLE["programming"]}, status="ready", result={"workout": result, "warnings": []}, ai_accepted_at=now(), expires_at=now() + timedelta(days=1)))
    edited = deepcopy(SAMPLE)
    edited.pop("programming")
    path = f"/api/v1/workouts/imports/{identifier}/accept"
    public = await data_api.client.post(path, json={"workout": edited, "is_public": True}, headers=GENERATION)
    assert public.status_code == 422 and public.json()["detail"] == "Gym programming stays private."
    accepted = await data_api.client.post(path, json={"workout": edited}, headers=GENERATION)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["content"]["programming"]["source_kind"] == "gym"
    assert (await data_api.client.post(path, json={"workout": edited}, headers=GENERATION)).json() == accepted.json()


@pytest.mark.parametrize("kind", ["text", "document"])
async def test_class_privacy_trims_members_before_provider_and_drops_context(kind, monkeypatch):
    private = "PRIVATE_MEMBER_A 12:43\nPRIVATE_MEMBER_B 4 rounds"
    page = "PRIVATE_NAV_NAME\nWorkout\nCoach notes\n" + TEXT + "\nLog Result\nLeaderboard\n" + private + "\nComments\nPRIVATE_COMMENT"
    raw = response()
    if kind == "document":
        for block in raw["blocks"]:
            for entry in block["evidence"] + [e for item in block["exercises"] for e in item["evidence"]]:
                entry["location"] = "document_page:1"
    provider = FakeProvider(raw)
    if kind == "document":
        async def pdf(data):
            # A leaderboard spanning pages must stay suppressed on the next page.
            return [SourcePart("document_page:1", page), SourcePart("document_page:2", private)]
        monkeypatch.setattr(extraction, "_pdf_parts", pdf)
        payload = {"document_base64": text_pdf(TEXT), "document_mime": "application/pdf"}
    else:
        payload = {"text": page}
    result = await WorkoutExtractor(provider).extract(ExtractionRequest(kind=kind, class_parts=True, ai_consent=True, **payload))
    assert len(provider.calls) == 1
    sent = "\n".join(part.text for part in provider.calls[0].parts)
    assert "PRIVATE_" not in sent and "Deadlifts unbroken" in sent
    assert result.workout is not None and result.workout.source_context is None
    assert "PRIVATE_" not in result.model_dump_json()
    assert result.workout.blocks[0].exercises[0].segment == "buy_in"


def test_class_privacy_resumes_at_next_part_after_member_results():
    from app.domains.workouts.class_extraction import class_text

    assert class_text("A. AMRAP 15 min\n15 Squat\nLeaderboard\nAlice 3 rounds\nComments\nBob: hi\nB. For time\nRun 400m") == "A. AMRAP 15 min\n15 Squat\nB. For time\nRun 400m"


async def test_class_failure_does_not_retain_source_context():
    result = await WorkoutExtractor(FakeProvider({})).extract(ExtractionRequest(
        kind="text", text=TEXT + "\nComments\nPRIVATE_MEMBER", class_parts=True, ai_consent=True))
    assert result.workout is not None and result.workout.source_context is None
    assert "PRIVATE_MEMBER" not in result.model_dump_json()


async def test_large_class_pdf_is_parsed_and_remains_bounded():
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter(PdfReader(io.BytesIO(base64.b64decode(text_pdf(TEXT)))))
    writer.add_metadata({"/CapturePadding": "x" * (2 * 1024 * 1024)})
    buffer = io.BytesIO()
    writer.write(buffer)
    data = buffer.getvalue()
    assert 2 * 1024 * 1024 < len(data) < 10 * 1024 * 1024
    # Exercise the actual isolated PDF subprocess, not a parser mock.
    result = await WorkoutExtractor(FakeProvider(response())).extract(ExtractionRequest(
        kind="document", document_base64=base64.b64encode(data).decode(), document_mime="application/pdf", class_parts=True, ai_consent=True))
    assert result.error_code is None and result.workout.blocks, result
    too_large = ExtractionRequest(kind="document", document_base64=base64.b64encode(b"x" * (10 * 1024 * 1024 + 1)).decode(), document_mime="application/pdf", class_parts=True, ai_consent=True)
    rejected = await WorkoutExtractor(FakeProvider(response())).extract(too_large)
    assert rejected.error_code == "document_size_limit"

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


def fixture_subset(expected, value):
    if isinstance(expected, dict):
        return {key: fixture_subset(item, value[key]) for key, item in expected.items()}
    if isinstance(expected, list):
        assert len(expected) == len(value)
        return [fixture_subset(a, b) for a, b in zip(expected, value)]
    return value


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
    expected = {**SAMPLE, "capture_kind": kind}
    assert fixture_subset(expected, actual) == expected


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
        assert workout.blocks[3].exercises[0].duration_seconds is None


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
    page = "PRIVATE_NAV_NAME\nWorkout\nCoach notes\n" + TEXT + "\nLog Result\nLeaderboard\n" + private + "\nComments\nPRIVATE_COMMENT: PRIVATE_MESSAGE"
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

    assert class_text("A. AMRAP 15 min\n15 Squat\nLeaderboard\nAlice 3 rounds\nA. MEMBER_NAME 12:43\nComments\nBob: hi\nB. For time\nRun 400m") == "A. AMRAP 15 min\n15 Squat\nB. For time\nRun 400m"


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


async def test_all_nov17_parts_survive_private_sections_between_parts():
    from app.domains.workouts.class_extraction import TRIM_WARNING, class_text

    programming = TEXT.replace("C. Active recovery.", "C. Accessories")
    page = re.sub(r"(?m)^([BCD]\.)", lambda match: "Log Result\nLeaderboard\nPRIVATE_MEMBER 12:43\nComments (2):\nPRIVATE_COMMENT: PRIVATE_MESSAGE\n" + match[1], programming)
    page += "\nLog a Result:\nLeaderboard\nPRIVATE_LAST_MEMBER 4 rounds"
    cleaned = class_text(page)
    assert all(line in cleaned for line in programming.splitlines())
    assert "PRIVATE_" not in cleaned
    provider = FakeProvider(response())
    result = await WorkoutExtractor(provider).extract(ExtractionRequest(
        kind="text", text=page, class_parts=True, ai_consent=True))
    assert [block.label for block in result.workout.blocks] == ["A", "B", "C", "D"]
    assert TRIM_WARNING in result.warnings
    assert all("PRIVATE_" not in part.text for part in provider.calls[0].parts)


def test_coach_sentences_are_not_private_section_headings():
    from app.domains.workouts.class_extraction import class_text

    text = "A. Metcon\nAthletes should aim for 4+ rounds.\nResults improve with practice.\n10 Squat\nB. Technique\n5 Press"
    assert class_text(text) == text


def test_nav_members_and_arbitrary_part_titles_and_numbered_parts():
    from app.domains.workouts.class_extraction import class_text

    text = "Athletes\nPRIVATE_NAV_MEMBER 12:43\nA. AMRAP 15 min\n10 Squat\nLog Result\nLeaderboard\nA. PRIVATE_INITIAL 12:43\nB. Strength\n5 Press\nLog Result\nC. Mobility\nHold 30s\nLog Result\nD1 Pallof hold\nD2 Cuban press\nD3 Powell raise"
    cleaned = class_text(text)
    assert "PRIVATE_" not in cleaned
    assert all(heading in cleaned for heading in ["A. AMRAP", "B. Strength", "C. Mobility", "D1 Pallof", "D2 Cuban", "D3 Powell"])


async def test_no_workout_section_gives_clear_recovery_without_provider_call():
    from app.domains.workouts.class_extraction import ClassTextUnavailable, class_text

    with pytest.raises(ClassTextUnavailable, match="Paste the workout section"):
        class_text("Athletes\nPRIVATE_MEMBER 12:43")
    provider = FakeProvider({})
    result = await WorkoutExtractor(provider).extract(ExtractionRequest(
        kind="text", text="Athletes\nPRIVATE_MEMBER 12:43", class_parts=True, ai_consent=True))
    assert result.error_code == "class_workout_section_missing" and not provider.calls
    assert any("Paste the workout section" in warning for warning in result.warnings)


@pytest.mark.parametrize("class_parts", [False, True])
def test_non_class_document_encoded_admission_limit(class_parts):
    encoded = "A" * (4 * ((extraction.MAX_DOCUMENT_BYTES + 2) // 3) + 4)
    if class_parts:
        assert ExtractionRequest(kind="document", document_base64=encoded, class_parts=True)
    else:
        with pytest.raises(ValidationError, match="Non-class documents"):
            ExtractionRequest(kind="document", document_base64=encoded)


async def test_realistic_wodup_header_keeps_all_coach_notes_and_parts():
    from app.domains.workouts.class_extraction import TRIM_WARNING, trim_class_parts

    page = (Path(__file__).parent / "fixtures/wodup_nov17_page.txt").read_text()
    warnings = []
    cleaned = trim_class_parts([("provided_text", page)], warnings)[0][1]
    required = [line for line in page.split("\nShow less\n")[0].splitlines() if line.startswith((
        "Phase 5,", "Workout Specific Movement Prep", "- This is progression",
        "- The goal today", "- Perform your deadlift", "- The final tester",
        "- Your initial", "A.", "B.", "C.", "2 alternating sets of:", "D1.", "D2.", "D3."))]
    assert len(required) == 14
    assert all(line in cleaned for line in required)
    assert all(name not in cleaned for name in ("Jane Doe", "C. Smith", "Bob Lee", "Mike R", "great one today"))
    assert "View Workout Specific Movement Prep" not in cleaned
    assert "Log Result" not in cleaned and "Leaderboard" not in cleaned
    assert warnings == [TRIM_WARNING]
    provider = FakeProvider({})
    result = await WorkoutExtractor(provider).extract(ExtractionRequest(
        kind="text", text=page, class_parts=True, ai_consent=True))
    assert len(provider.calls) == 1
    assert provider.calls[0].parts[0].text == cleaned
    assert TRIM_WARNING in result.warnings


@pytest.mark.parametrize("button", ["Log Result", "Log a result", "View Leaderboard", "View Workout Specific Movement Prep"])
def test_header_button_never_suppresses_following_programming(button):
    from app.domains.workouts.class_extraction import class_text

    assert class_text(button + "\nPhase 5, Week 4, Tue\n- Hold a pace\nA. Metcon") == "Phase 5, Week 4, Tue\n- Hold a pace\nA. Metcon"


def test_private_sections_only_end_at_class_heading_across_pages():
    from app.domains.workouts.class_extraction import trim_class_parts

    parts = trim_class_parts([
        ("document_page:1", "D3. Powell raises\nLeaderboard\nJane Doe 6+12"),
        ("document_page:2", "C. Smith 05:30\nBob Lee 5+2\nComments (2)\nMike R: great one today\nPhase 5, Week 4, Tue\nWorkout Specific Movement Prep\nCoach notes\n- Hold a pace"),
    ])
    assert parts == [("document_page:1", "D3. Powell raises"),
                     ("document_page:2", "Coach notes\n- Hold a pace")]


@pytest.mark.parametrize("row", ["B. MEMBER_NAME 12:43", "B. MEMBER_NAME 4 rounds", "B. MEMBER_NAME: PRIVATE_COMMENT", "B. Jane Doe\n12:43", "Jane Doe\n12:43", "B. Jane Powell\n12:43", "B. Deadlift Dan\n5:01", "B. Jane Rounds\n12:43", "B. Amrap Smith\n5+3", "B. Sam For\n4:10"])
async def test_expected_athlete_initial_does_not_reopen_member_section(row):
    from app.domains.workouts.class_extraction import class_text

    page = "A. Metcon\n10 Squat\nLeaderboard\n" + row + "\nPRIVATE_RESULT"
    assert class_text(page) == "A. Metcon\n10 Squat"
    provider = FakeProvider({})
    await WorkoutExtractor(provider).extract(ExtractionRequest(kind="text", text=page, class_parts=True, ai_consent=True))
    assert [part.text for part in provider.calls[0].parts] == ["A. Metcon\n10 Squat"]


async def test_split_member_rows_stay_private_until_real_workout_boundary():
    page = "A. Metcon\n10 Squat\nLeaderboard\nB. Jane Doe\n12:43\nB. For time\n10 Press"
    provider = FakeProvider({})
    await WorkoutExtractor(provider).extract(ExtractionRequest(kind="text", text=page, class_parts=True, ai_consent=True))
    assert [part.text for part in provider.calls[0].parts] == ["A. Metcon\n10 Squat\nB. For time\n10 Press"]


@pytest.mark.parametrize("heading", ["C. For time", "D1. EMOM"])
async def test_private_sections_resume_at_later_format_part_after_skipped_letter(heading):
    provider = FakeProvider({})
    page = "A. Metcon\n10 Squat\nResults\nB. Deadlift Dan\n5:01\n" + heading + "\n400m run"
    await WorkoutExtractor(provider).extract(ExtractionRequest(kind="text", text=page, class_parts=True, ai_consent=True))
    assert [part.text for part in provider.calls[0].parts] == ["A. Metcon\n10 Squat\n" + heading + "\n400m run"]


@pytest.mark.parametrize("heading", [
    "B. AMRAP", "B. EMOM", "B. E3MOM", "B. For time", "B. As many rounds", "B. Rest between",
    "B. Training (15 minutes)", "B. Training (15 min)", "B. Training (15 mins)", "B. 2 alternating sets",
    "B. Every minute", "B. Strength", "B. Conditioning", "B. Accessories", "B. Warm-up", "B. Cool-down",
    "B. AMRAP 12", "B. 15:00", "B. 3x10", "B: 21-15-9",
    "Workout", "WOD", "Coach notes", "Warm-up", "Cool-down", "Accessories",
])
async def test_private_sections_resume_only_at_explicit_programming_boundaries(heading):
    provider = FakeProvider({})
    page = "A. Metcon\n10 Squat\nLeaderboard\nB. Jane Powell\n12:43\n" + heading + "\n10 Press"
    await WorkoutExtractor(provider).extract(ExtractionRequest(kind="text", text=page, class_parts=True, ai_consent=True))
    assert [part.text for part in provider.calls[0].parts] == ["A. Metcon\n10 Squat\n" + heading + "\n10 Press"]


@pytest.mark.parametrize("heading", ["B. Powell Raises", "B. Deadlift", "B. Squat", "B. Technique", "B. Mobility", "B. Rounds", "B. Amrap Smith"])
def test_movement_only_headings_cannot_end_private_sections(heading):
    from app.domains.workouts.class_extraction import class_text

    programming = "A. Metcon\n10 Squat"
    assert class_text(programming + "\nLeaderboard\n" + heading + "\n10 Press") == programming
    assert class_text(programming + "\n" + heading + "\n10 Press") == programming + "\n" + heading + "\n10 Press"


@pytest.mark.parametrize("score", ["12:43", "12:43.5", "5+3", "5", "5 reps", "5 rounds", "5 cal", "5m", "Rx", "Scaled", "DNF"])
async def test_even_structural_part_heading_cannot_reopen_before_bare_member_score(score):
    provider = FakeProvider({})
    page = "A. Metcon\n10 Squat\nLeaderboard\nB. AMRAP Smith\n\n" + score + "\nC. For time\n400m run"
    await WorkoutExtractor(provider).extract(ExtractionRequest(kind="text", text=page, class_parts=True, ai_consent=True))
    assert [part.text for part in provider.calls[0].parts] == ["A. Metcon\n10 Squat\nC. For time\n400m run"]


def test_bare_member_score_lookahead_crosses_page_boundary():
    from app.domains.workouts.class_extraction import trim_class_parts

    parts = trim_class_parts([
        ("document_page:1", "A. Metcon\n10 Squat\nLeaderboard\nB. AMRAP Smith\n"),
        ("document_page:2", "\n12:43\nC. For time\n400m run"),
    ])
    assert parts == [("document_page:1", "A. Metcon\n10 Squat"), ("document_page:2", "C. For time\n400m run")]


@pytest.mark.parametrize("units,options,accepted", [
    ("20 kg/14 lb", [(20, "kg"), (14, "kg")], False),
    ("20 kg/14 lb", [(20, "kg"), (14, "lb")], True),
    ("20/14 lb", [(20, "lb"), (14, "lb")], True),
    ("20/14/10 lb", [(20, "lb"), (14, "lb"), (10, "lb")], True),
])
def test_load_option_value_unit_pairs(units, options, accepted):
    raw = response()
    item = raw["blocks"][1]["exercises"][1]
    old = "30 Wall Ball 20/14 lb"
    source_line = "30 Wall Ball " + units
    for entry in item["evidence"]:
        if entry["wording"] == old:
            entry["wording"] = source_line
    item["load_options"] = [{"load": load, "load_unit": unit} for load, unit in options]
    source = extraction.SourceBundle(extraction.SourceMetadata(), [SourcePart("provided_text", TEXT.replace(old, source_line))])
    workout, _, _ = extraction.ground_workout(raw, source, class_parts=True)
    result = workout.blocks[1].exercises[1].load_options
    assert (result is not None) is accepted
    if accepted:
        assert [(option.load, option.load_unit) for option in result] == options


def test_unsupported_clock_clears_buy_in_and_preserves_source_evidence():
    raw = response()
    raw["blocks"][0]["evidence"] = []
    source = extraction.SourceBundle(extraction.SourceMetadata(), [SourcePart("provided_text", TEXT)])
    workout, warnings, _ = extraction.ground_workout(raw, source, class_parts=True)
    assert workout.blocks[0].execution is None
    assert all(item.segment is None for item in workout.blocks[0].exercises)
    assert any("buy-in" in entry.wording.lower() for item in workout.blocks[0].exercises for entry in item.evidence)
    assert any("Buy-in/cash-out structure" in warning for warning in warnings)
    WorkoutContent.model_validate_json(workout.model_dump_json())


@pytest.mark.parametrize("extra", ["block", "exercise"])
def test_exact_fixture_comparison_rejects_extra_list_items(extra):
    actual = deepcopy(SAMPLE)
    actual["server_field"] = "allowed"
    assert fixture_subset(SAMPLE, actual) == SAMPLE
    if extra == "block":
        actual["blocks"].append(deepcopy(actual["blocks"][-1]))
    else:
        actual["blocks"][0]["exercises"].append(deepcopy(actual["blocks"][0]["exercises"][-1]))
    with pytest.raises(AssertionError):
        fixture_subset(SAMPLE, actual)

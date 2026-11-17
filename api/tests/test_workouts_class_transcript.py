"""Class screenshots are copied to text first, then grounded like a pasted class.

The class, its transcript and the model answers are synthetic: invented movements,
numbers and coach notes in the layout a class page prints (a movement-prep link,
"N alternating sets" groups, an EMOM with a rest minute, an ACCESSORIES section).
"""

import copy
import json
from types import SimpleNamespace

import httpx
import pytest

from app.domains.workouts.class_extraction import (
    SCREENSHOT_NOTICE,
    TRANSCRIPT_FAILED,
    TRANSCRIPT_LOCATION,
    prompt_echo,
    transcript_text,
)
from app.domains.workouts.execution import has_dose
from app.domains.workouts.extraction import (
    OUTPUT_TOKENS,
    ExtractionFailure,
    ExtractionImage,
    ExtractionRequest,
    ProductionExtractionProvider,
    SourceBundle,
    SourceImage,
    SourceMetadata,
    WorkoutExtractor,
    _numeric_supported,
    ground_workout,
)
from app.domains.workouts.schemas import ExercisePrescription, WorkoutBlock
from tests.workouts_provider_fakes import FakeBudget

# What the copy call returns, icons included; transcript_text removes them.
LINES = [
    "FORGE | TEST", "Phase 2, Week 3, Tue", "↗ Workout Specific Movement Prep",
    "- 10 Minutes", "- Hip + trunk control work to open the session!",
    "- Perform the lunge reach as 5-7 on one side + 5-7 on the other",
    "⟳ 3 alternating sets, with no rest between sets of:",
    "A1. 5-7 Half Kneeling Lunge Reaches", "A2. 14 Alternating Seated Medicine Ball Twists", "A3. 18 Dumbbell Bird Dogs",
    "- Steady mixed conditioning", "- Find calories / reps / distance you can hold for all 4 rounds",
    "⏱ B. Every minute for 20 minutes (4 rounds):",
    "Minute 1", "▪ Rower 12-15 calories", "Minute 2", "▪ 14-18 Dumbbell Step-Ups 20/16 inches",
    "Minute 3", "▪ Sandbag Carry Max Distance", "Minute 4", "▪ Max Plank Hold", "Minute 5", "▪ Rest for 1 minute",
    "- Hold a conversational pace", "ACCESSORIES", "⟳ 2 alternating sets, with no rest between sets of:",
    "C1. Bike for 7 minutes", "C2. Row for 6 minutes", "C3. Ski for 5 minutes",
]
TRANSCRIPT = transcript_text({"lines": LINES}, 30_000)
ECHO = "Workout Specific Movement Prep is a link, not a block."


def ev(field, wording):
    return {"field": field, "wording": wording, "location": TRANSCRIPT_LOCATION}


def move(name, *quotes, **dose):
    evidence = [ev("name", quotes[0] if quotes else name)]
    evidence += [ev(key, quotes[-1] if quotes else name) for key in dose]
    return {"name": name, **dose, "evidence": evidence}


def answer(rest_station=True, rotation="alternating"):
    """Shaped like a recorded live answer: short quotes, a prep-headed warm-up,
    zero rests from "no rest between sets" and a prompt rule echoed as a note."""
    emom = [move("Rower", "Rower 12-15 calories", reps_min=12, reps_max=15),
            move("Dumbbell Step-Ups", "14-18 Dumbbell Step-Ups", reps_min=14, reps_max=18),
            move("Sandbag Carry", "Sandbag Carry Max Distance", effort="Max Distance"),
            move("Plank Hold", "Max Plank Hold", effort="Max")]
    if rest_station:
        emom.append(move("Rest", "Rest for 1 minute", duration_seconds=60))
    bird_dogs = move("Dumbbell Bird Dogs", "18 Dumbbell Bird Dogs", reps_min=18, reps_max=18)
    bird_dogs["rest_seconds"] = 0
    bird_dogs["evidence"].append(ev("rest_seconds", "no rest between sets"))
    return {
        "title": "Tuesday class", "kind": "session", "instructions": ["10 Minutes", ECHO],
        "blocks": [
            {"id": "a", "label": "A — Workout Specific Movement Prep", "role": "warm_up", "score_kind": "none",
             "grouping": "superset", "rounds": 3, "rest_between_rounds_seconds": 0,
             "evidence": [ev("rounds", "3 alternating sets"), ev("role", "Workout Specific Movement Prep"),
                          ev("rest_between_rounds_seconds", "no rest between sets")],
             "exercises": [
                 {**move("Half Kneeling Lunge Reaches", "5-7 on one side + 5-7 on the other",
                         reps_min=5, reps_max=7, per_side=True),
                  "instructions": "Perform the lunge reach as 5-7 on one side + 5-7 on the other"},
                 move("Alternating Seated Medicine Ball Twists", "14 Alternating Seated Medicine Ball Twists",
                      reps_min=14, reps_max=14),
                 bird_dogs]},
            {"id": "b", "label": "B — Every minute for 20 minutes", "role": "main", "grouping": "interval",
             "execution": {"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": rotation},
             "evidence": [ev("execution.mode", "Every minute for 20 minutes"),
                          ev("execution.intervals", "Every minute for 20 minutes")],
             "exercises": emom},
            {"id": "c", "label": "C — Accessories", "role": "accessory", "score_kind": "none", "grouping": "superset",
             "rounds": 2, "instructions": [ECHO],
             "evidence": [ev("label", "ACCESSORIES"), ev("rounds", "2 alternating sets")],
             "exercises": [move("Bike", "Bike for 7 minutes", duration_seconds=420),
                           move("Row", "Row for 6 minutes", duration_seconds=360),
                           move("Ski", "Ski for 5 minutes", duration_seconds=300)]},
        ]}


class Provider:
    enabled = True

    def __init__(self, transcript=TRANSCRIPT, raw=None, failure=None):
        self.transcript, self.raw, self.failure = transcript, raw or answer(), failure
        self.calls, self.seen = [], None

    async def transcribe_class(self, source):
        self.calls.append("transcribe")
        if self.failure:
            raise self.failure
        return self.transcript

    async def extract(self, source):
        self.calls.append("extract")
        self.seen = SimpleNamespace(parts=list(source.parts), images=list(source.images))
        return copy.deepcopy(self.raw)


def screenshots(**values):
    image = ExtractionImage(base64_data="iVBORw0KGgo=", mime_type="image/png")
    return ExtractionRequest(**({"kind": "images", "images": [image, image], "class_parts": True, "class_rows": True,
                                 "ai_consent": True} | values))


@pytest.fixture(autouse=True)
def images(monkeypatch):
    import app.domains.workouts.extraction as module

    monkeypatch.setattr(module, "_validated_images", lambda values: [
        SourceImage(f"image:{index}", "data:image/png;base64,AAAA") for index, _ in enumerate(values)])


async def run(provider, **values):
    return await WorkoutExtractor(provider).extract(screenshots(**values))


def test_the_copy_drops_icons_and_keeps_notes_and_rows():
    lines = TRANSCRIPT.splitlines()
    assert "Workout Specific Movement Prep" in lines and "3 alternating sets, with no rest between sets of:" in lines
    assert "B. Every minute for 20 minutes (4 rounds):" in lines and "Rower 12-15 calories" in lines
    assert "- 10 Minutes" in lines and not any(line[0] in "↗⟳⏱▪" for line in lines)


@pytest.mark.asyncio
async def test_screenshots_are_copied_once_then_read_as_text_and_the_class_is_ready():
    provider = Provider()
    result = await run(provider)
    # Two model calls: the copy, then a text-only extraction that never sees the images.
    assert provider.calls == ["transcribe", "extract"]
    assert [part.location for part in provider.seen.parts] == [TRANSCRIPT_LOCATION] and provider.seen.images == []
    assert result.status == "ready" and result.warnings == []
    assert result.source.coverage_notes == [SCREENSHOT_NOTICE]
    a, b, c = result.workout.blocks
    # Part A: the prep heading keeps the warm-up, the group its 3 rounds, and ranges/per-side survive.
    assert (a.role, a.score_kind, a.grouping, a.rounds, a.rest_between_rounds_seconds) == ("warm_up", "none", "superset", 3, 0)
    lunge, twists, bird_dogs = a.exercises
    assert (lunge.reps_min, lunge.reps_max, lunge.per_side) == (5, 7, True)
    assert (twists.reps_min, twists.reps_max, bird_dogs.reps_min, bird_dogs.rest_seconds) == (14, 14, 18, 0)
    # Part B: one move per minute, five stations including the rest minute, 20 minutes = 4 rounds.
    assert b.execution.model_dump() == {"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": "alternating"}
    assert [item.name for item in b.exercises] == ["Rower", "Dumbbell Step-Ups", "Sandbag Carry", "Plank Hold", "Rest"]
    rower, step_ups = b.exercises[:2]
    assert (rower.calories_min, rower.calories, step_ups.reps_min, step_ups.reps_max) == (12, 15, 14, 18)
    assert b.exercises[-1].duration_seconds == 60
    # Part C: ACCESSORIES keeps its role and "2 alternating sets" its rounds.
    assert (c.label, c.role, c.grouping, c.rounds) == ("C — Accessories", "accessory", "superset", 2)
    # Prompt rules never reach the saved notes.
    notes = [*result.workout.instructions, *(note for block in result.workout.blocks for note in block.instructions or [])]
    assert "10 Minutes" in result.workout.instructions and not any("link" in note for note in notes)


@pytest.mark.asyncio
@pytest.mark.parametrize("rest_station,rotation", [(False, "alternating"), (True, None), (False, None)])
async def test_the_minute_rows_restore_a_missing_rotation_or_rest_station(rest_station, rotation):
    result = await run(Provider(raw=answer(rest_station, rotation)))
    b = result.workout.blocks[1]
    assert b.execution.model_dump() == {"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": "alternating"}
    assert [item.name for item in b.exercises][-1] == "Rest" and b.exercises[-1].duration_seconds == 60
    assert result.status == "ready" and result.warnings == []


@pytest.mark.asyncio
async def test_a_failed_copy_falls_back_to_reading_the_images():
    provider = Provider(failure=ExtractionFailure("provider_invalid_response"))
    result = await run(provider)
    assert provider.calls == ["transcribe", "extract"]
    assert provider.seen.parts == [] and len(provider.seen.images) == 2
    assert TRANSCRIPT_FAILED in result.source.coverage_notes and result.status == "incomplete"


@pytest.mark.asyncio
async def test_a_budget_stop_on_the_copy_makes_no_second_call():
    provider = Provider(failure=ExtractionFailure("workouts_ai_budget_exceeded"))
    result = await run(provider)
    assert provider.calls == ["transcribe"]
    assert (result.status, result.error_code) == ("incomplete", "workouts_ai_budget_exceeded")


@pytest.mark.asyncio
async def test_screenshots_without_programming_end_before_the_extraction():
    provider = Provider(transcript="")
    result = await run(provider)
    assert provider.calls == ["transcribe"] and result.error_code == "class_workout_section_missing"


@pytest.mark.asyncio
async def test_only_image_only_class_imports_are_copied():
    provider = Provider()
    await run(provider, text="A. 10 Burpees")
    await run(provider, class_parts=False, class_rows=False)
    assert "transcribe" not in provider.calls


def test_prompt_echoes_are_dropped_without_a_warning_and_printed_lines_stay():
    assert prompt_echo(ECHO, TRANSCRIPT)
    assert prompt_echo("Ignore leaderboards, athlete names and results and comments in images.", "")
    assert prompt_echo("Leave out leaderboards, results, member names, comments and reactions.", "")
    assert not prompt_echo("Perform the lunge reach as 5-7 on one side + 5-7 on the other", "")
    assert not prompt_echo("Rest 2 minutes between parts", "")
    # The prompts quote class phrases as examples; a coach note saying them is still the class.
    assert not prompt_echo("Use the remaining time to recover before starting the next exercise", "")
    assert not prompt_echo("As Many Rounds and Reps as possible in 15 minutes", "")
    page = "Workout Specific Movement Prep is a link, never a block.\nA. 10 Burpees"
    assert not prompt_echo("Workout Specific Movement Prep is a link, never a block.", page)


def test_screenshot_notes_read_from_images_still_drop_prompt_echoes():
    raw = {"title": "Class", "kind": "session", "instructions": [ECHO, "Hold one pace"], "blocks": [{
        "id": "a", "label": "A", "evidence": [], "instructions": [ECHO],
        "exercises": [{"name": "Box Jumps", "evidence": [{"field": "name", "wording": "15 Box Jumps", "location": "image:0"}]}]}]}
    source = SourceBundle(SourceMetadata(), [], [SourceImage("image:0", "data:image/png;base64,AAAA")], class_parts=True)
    workout, warnings, _ = ground_workout(raw, source, class_parts=True)
    assert workout.instructions == ["Hold one pace"] and workout.blocks[0].instructions is None
    assert not any("Unquoted" in warning for warning in warnings)


def test_no_rest_grounds_zero_rest_only():
    assert _numeric_supported("rest_between_rounds_seconds", 0, "with no rest between sets of:")
    assert _numeric_supported("rest_seconds", 0, "without rest")
    assert not _numeric_supported("rest_seconds", 0, "Rest 60 seconds")
    assert not _numeric_supported("rest_seconds", 30, "no rest")


def test_calories_and_an_emom_max_effort_are_doses():
    emom = WorkoutBlock(id="b", label="B", execution={"mode": "emom", "interval_seconds": 60, "intervals": 20})
    plain = WorkoutBlock(id="c", label="C")
    assert has_dose(plain, ExercisePrescription(name="Rower", calories=15, calories_min=12))
    assert has_dose(emom, ExercisePrescription(name="Plank Hold", effort="Max"))
    assert not has_dose(plain, ExercisePrescription(name="Plank Hold", effort="Max"))
    open_ended = WorkoutBlock(id="d", label="D", execution={"mode": "emom", "interval_seconds": 60})
    assert not has_dose(open_ended, ExercisePrescription(name="Plank Hold", effort="Max"))


@pytest.mark.asyncio
async def test_the_copy_is_one_primary_model_call_with_its_own_budget_reservation(monkeypatch):
    import app.ai_governance
    import app.config
    import app.domains.workouts.extraction as module

    settings = SimpleNamespace(
        environment="development", allow_paid_ai_in_development=True, workouts_api_enabled=True,
        workouts_imports_enabled=True, workouts_ai_enabled=True, openai_api_key="unused",
        is_ai_capability_enabled=lambda _: True, workout_extraction_model="primary-test",
        workout_extraction_fallback_model="fallback-test", openai_reasoning_effort="none")
    monkeypatch.setattr(app.config, "get_settings", lambda: settings)

    class Tracker:
        def __init__(self, **values):
            self.model, self.prompt = values["primary_model"], values["prompt_version"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def fail(self, *args, **kwargs):
            pass

        def succeed(self, *args, **kwargs):
            pass

    monkeypatch.setattr(app.ai_governance, "AIInvocationTracker", Tracker)
    payloads, replies = [], []

    def respond(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"finish_reason": replies.pop(0), "message": {
            "content": json.dumps({"lines": LINES})}}]})

    actual = httpx.AsyncClient
    monkeypatch.setattr(module.httpx, "AsyncClient",
                        lambda **kwargs: actual(**(kwargs | {"transport": httpx.MockTransport(respond)})))
    source = SourceBundle(SourceMetadata(), [], [SourceImage("image:0", "data:image/png;base64,AAAA")], class_parts=True)
    budget = FakeBudget()
    replies.append("stop")
    text = await ProductionExtractionProvider(budget_guard=budget, development_api_key="k").transcribe_class(source)
    assert text == TRANSCRIPT
    assert [payload["model"] for payload in payloads] == ["primary-test"]
    assert payloads[0]["max_completion_tokens"] == OUTPUT_TOKENS
    assert payloads[0]["response_format"]["json_schema"]["name"] == "class_transcript"
    (capability, model, envelope), = budget.reservations
    assert (capability, model, envelope.includes_images, envelope.max_output_tokens) == (
        "workout_extraction", "primary-test", True, OUTPUT_TOKENS)
    replies.append("length")  # A cut-off copy is never used as the class.
    with pytest.raises(ExtractionFailure, match="provider_incomplete_response"):
        await ProductionExtractionProvider(budget_guard=budget, development_api_key="k").transcribe_class(source)
    assert len(payloads) == 2 and budget.outcomes == ["success", "failed"]

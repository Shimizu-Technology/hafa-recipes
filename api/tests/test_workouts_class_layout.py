"""A pasted class page's own layout decides its parts, notes and prep link.

The page below is synthetic. It copies the layout of a WodUp class (lettered
parts, an "N alternating sets of:" group, "- " coach notes, a movement-prep
link), not any real gym's programming.
"""

from app.domains.workouts import class_extraction
from app.domains.workouts.class_outline import read_outline
from app.domains.workouts.extraction import SourceBundle, SourceMetadata, SourcePart, ground_workout

PAGE = """BUILD | TEST
PERFORM
Phase 1, Week 2, Mon
Workout Specific Movement Prep
- This is progression 1/4 for our benchmark workout, "Summit"
- Hold one pace for the whole session
A. Front Squat (30X1 tempo)
Within 10 minutes:
Set 1 – 5 reps
Set 2 – 3 reps
Set 3 – Max reps
Rest as needed
- Front squat strength
- Perform set 1 at ~60-65% of your 1RM
- Perform set 2 at ~75% 1RM
- Perform set 3 as an AMRAP-2 at ~85%
B. Every 3 minutes for 9 minutes (3 rounds):
12 Toes to Bars
Echo Bike for 8/10 seconds
- REP RANGES
8-12 toes to bar
- Sprint 8 (men) and 10 (women) seconds on the echo bike

- GUIDELINES: keep one accessory programme for the cycle
ACCESSORIES
2 alternating sets of:
C1. 10-12 Cable Face Pulls (3010 tempo)
- Rear delt work
Rest 30 seconds
C2. Side Plank for 30-40 seconds
Rest 30 seconds"""


def ev(field, wording):
    return {"field": field, "wording": wording, "location": "provided_text"}


def move(name, row, **dose):
    return {"name": name, **dose, "evidence": [ev("name", name)] + [ev(key, row) for key in dose]}


def model_output():
    """Typical model slips: a prep block, a part named after its notes, notes at
    the wrong level, one exercise per listed set, and a skipped last part."""
    return {
        "title": "Monday class", "kind": "session",
        "instructions": ["Front squat strength", "GUIDELINES: keep one accessory programme for the cycle"],
        "blocks": [
            {"id": "prep", "label": "Workout Specific Movement Prep", "exercises": [], "evidence": []},
            {"id": "a", "label": "A. Front Squat", "grouping": "sequential", "evidence": [], "exercises": [
                move("Front Squat", "Set 1 – 5 reps", reps_min=5, reps_max=5),
                move("Front Squat", "Set 2 – 3 reps", reps_min=3, reps_max=3)]},
            {"id": "b", "label": "Anaerobic intervals", "grouping": "interval",
             "execution": {"mode": "emom", "interval_seconds": 180, "intervals": 3, "rotation": "together"},
             "evidence": [ev("execution.mode", "Every 3 minutes for 9 minutes (3 rounds):"),
                          ev("execution.interval_seconds", "Every 3 minutes"),
                          ev("execution.intervals", "for 9 minutes (3 rounds)")],
             "exercises": [move("Toes to Bars", "12 Toes to Bars", reps_min=12, reps_max=12),
                           move("Echo Bike", "Echo Bike for 8/10 seconds")]},
        ],
    }


def ground(page=PAGE, raw=None):
    source = SourceBundle(SourceMetadata(), [SourcePart("provided_text", page)], class_parts=True)
    return ground_workout(raw or model_output(), source, class_parts=True)


def test_layout_reads_parts_groups_prep_and_notes_in_source_order():
    outline = read_outline(PAGE)
    assert outline.prep is True
    assert [part.key for part in outline.parts] == ["A", "B", "C"]
    assert outline.intro == ['This is progression 1/4 for our benchmark workout, "Summit"', "Hold one pace for the whole session"]
    a, b, c = outline.parts
    assert a.notes[0] == "Front squat strength" and len(a.notes) == 4
    # A note naming the next part's accessory section moves on; its own range stays.
    assert b.notes == ["REP RANGES\n8-12 toes to bar", "Sprint 8 (men) and 10 (women) seconds on the echo bike"]
    assert c.section == "ACCESSORIES" and c.notes == ["GUIDELINES: keep one accessory programme for the cycle"]
    assert [item.key for item in c.items] == ["C1", "C2"] and c.items[0].notes == ["Rear delt work"]


def test_a_part_introduced_by_notes_passes_later_notes_to_the_next_part():
    page = """- Core work to start
2 alternating sets of:
A1. 6 Woodchops
A2. 8 Dead Bugs
- Mixed conditioning today; the rower can be swapped for the echo bike
B. Every minute for 10 minutes (5 rounds):
Minute 1
Row 12 calories
Minute 2
Echo Bike 10 calories
- Build an aerobic base
ACCESSORIES
2 alternating sets of:
C1. SkiErg for 4 minutes
C2. BikeErg for 4 minutes"""
    a, b, c = read_outline(page).parts
    assert a.notes == [] and b.notes[0].startswith("Mixed conditioning")
    assert c.notes == ["Build an aerobic base"]


def test_page_layout_fixes_labels_notes_and_restores_a_skipped_part():
    workout, warnings, _ = ground()
    labels = [block.label for block in workout.blocks]
    assert labels == ["A. Front Squat", "B. Every 3 minutes for 9 minutes (3 rounds)", "C. ACCESSORIES"]
    assert workout.instructions == ['This is progression 1/4 for our benchmark workout, "Summit"',
                                    "Hold one pace for the whole session"]
    a, b, c = workout.blocks
    assert a.instructions[0] == "Front squat strength" and len(a.instructions) == 4
    assert "GUIDELINES: keep one accessory programme for the cycle" in c.instructions
    assert c.role == "accessory" and c.grouping == "superset" and c.rounds == 2
    assert [item.name for item in c.exercises] == ["Cable Face Pulls", "Side Plank"]
    assert c.exercises[0].instructions == "Rear delt work"
    assert any("C. ACCESSORIES was read from the page layout" in warning for warning in warnings)
    assert (workout.benchmark.name, workout.benchmark.stage, workout.benchmark.stages) == ("Summit", 1, 4)


def test_a_movement_listed_only_in_another_part_moves_there():
    raw = model_output()
    raw["blocks"][1]["exercises"].append(move("Toes to Bars", "12 Toes to Bars", reps_min=12, reps_max=12))
    del raw["blocks"][2]
    workout, warnings, _ = ground(raw=raw)
    assert "Toes to Bars" not in [item.name for item in workout.blocks[0].exercises]
    assert workout.blocks[1].label.startswith("B.") and [item.name for item in workout.blocks[1].exercises] == [
        "Toes to Bars", "Echo Bike"]
    assert any("was read from the page layout" in warning for warning in warnings)


def test_minutes_holding_two_movements_never_rotate_one_per_minute():
    page = """C. Every minute for 10 minutes (5 rounds):
Minute 1
10 Dumbbell Cleans
Max Push-Ups
Minute 2
Rest for 1 minute"""
    raw = {"title": "EMOM", "kind": "session", "blocks": [{
        "id": "c", "label": "C. EMOM", "grouping": "interval",
        "execution": {"mode": "emom", "interval_seconds": 60, "intervals": 10, "rotation": "alternating"},
        "evidence": [ev("execution.mode", "Every minute for 10 minutes (5 rounds):"),
                     ev("execution.intervals", "Every minute for 10 minutes (5 rounds):")],
        "exercises": [move("Dumbbell Cleans", "10 Dumbbell Cleans", reps_min=10, reps_max=10),
                      move("Push-Ups", "Max Push-Ups")]}]}
    workout, warnings, _ = ground(page, raw)
    assert workout.blocks[0].execution.rotation is None
    assert any("each minute lists a different group" in warning for warning in warnings)


def test_a_layout_the_reader_cannot_follow_keeps_the_model_parts(monkeypatch):
    import app.domains.workouts.class_outline as outline

    def broken(*args):
        raise ValueError("layout")

    monkeypatch.setattr(outline, "apply_outline", broken)
    workout, warnings, _ = ground()
    assert [block.label for block in workout.blocks] == ["Workout Specific Movement Prep", "A. Front Squat",
                                                         "Anaerobic intervals"]
    assert class_extraction.LAYOUT_WARNING in warnings


def test_plain_text_without_a_class_layout_is_unchanged():
    page = "Warm up well.\n3 rounds:\n10 Push-Ups\n15 Squats"
    raw = {"title": "Rounds", "kind": "session", "instructions": ["Warm up well."], "blocks": [{
        "id": "main", "label": "Main", "rounds": 3, "evidence": [ev("rounds", "3 rounds:")],
        "exercises": [move("Push-Ups", "10 Push-Ups", reps_min=10, reps_max=10),
                      move("Squats", "15 Squats", reps_min=15, reps_max=15)]}]}
    raw["blocks"][0]["evidence"].append(ev("workout_instructions", "Warm up well."))
    workout, _, _ = ground(page, raw)
    assert [block.label for block in workout.blocks] == ["Main"]
    assert workout.instructions == ["Warm up well."]

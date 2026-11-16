"""A pasted class page's own layout decides its parts, notes and prep link.

Every page here is synthetic: invented movements, numbers and coach notes in
the layout WodUp prints (lettered parts, "N alternating sets of:" groups, "- "
coach notes and its movement-prep link).
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


def dump(workout, warnings):
    return workout.model_dump_json() + "\n".join(warnings)


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
B. Every minute for 8 minutes (4 rounds):
Minute 1
Row 12 calories
Minute 2
Echo Bike 10 calories
- Build an aerobic base
ACCESSORIES
2 alternating sets of:
C1. SkiErg for 3 minutes
C2. Rower for 3 minutes"""
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
    assert a.instructions[-4] == "Front squat strength"  # the part's four coach notes
    assert "GUIDELINES: keep one accessory programme for the cycle" in c.instructions
    assert c.role == "accessory" and c.grouping == "superset" and c.rounds == 2
    assert [item.name for item in c.exercises] == ["Cable Face Pulls", "Side Plank"]
    assert c.exercises[0].instructions == "Rear delt work"
    assert "Part C was read from the page layout because the import left it out; review it." in warnings
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


def test_member_rows_from_a_selection_without_its_leaderboard_never_become_parts():
    # The selection ends inside the results: no "Leaderboard" heading, so the trim keeps these rows.
    page = """A. 12 Kettlebell Swings
B. Every minute for 6 minutes:
10 Wall Balls
C. Smith 225 lb
J. Smith 225 lb
Jane Doe 12:43 Rx
K. Jones: nice work today"""
    raw = {"title": "Class", "kind": "session", "blocks": [
        {"id": "a", "label": "A. Swings", "evidence": [], "exercises": [move("Kettlebell Swings", "12 Kettlebell Swings")]}]}
    workout, warnings, _ = ground(page, raw)
    assert [block.label[:2] for block in workout.blocks] == ["A.", "B."]
    text = dump(workout, warnings)
    assert not any(name in text for name in ("Smith", "Jane Doe", "Jones", "nice work", "225"))
    assert [part.key for part in read_outline(page).parts] == ["A", "B"]


def test_a_heading_alone_is_never_rebuilt():
    page = "A. 12 Kettlebell Swings\nB. Strength focus\n- Move well today"
    raw = {"title": "Class", "kind": "session", "blocks": [
        {"id": "a", "label": "A", "evidence": [], "exercises": [move("Kettlebell Swings", "12 Kettlebell Swings")]}]}
    workout, warnings, _ = ground(page, raw)
    assert [block.label for block in workout.blocks] == ["A"]
    assert "Part B from the source was not imported; review the source." in warnings


def test_an_unlettered_warm_up_keeps_its_place_and_a_rebuilt_part_sits_by_its_neighbours():
    page = """Warm-up
2 rounds of 15 Jumping Jacks
A. 12 Kettlebell Swings
B. 3 Rounds for Time:
10 Burpees
200m Row
C. 8 Push-Ups"""
    raw = {"title": "Class", "kind": "session", "blocks": [
        {"id": "w", "label": "Warm-up", "evidence": [], "exercises": [move("Jumping Jacks", "15 Jumping Jacks")]},
        {"id": "a", "label": "A", "evidence": [], "exercises": [move("Kettlebell Swings", "12 Kettlebell Swings")]},
        {"id": "c", "label": "C", "evidence": [], "exercises": [move("Push-Ups", "8 Push-Ups")]}]}
    workout, _, _ = ground(page, raw)
    assert [block.label[:2] for block in workout.blocks] == ["Wa", "A", "B.", "C"]


def test_dash_style_movements_are_rows_not_coach_notes():
    page = "A. For Time:\n- 10 Burpees\n- 15 Air Squats\n- 8 Minutes cap, move steadily"
    raw = {"title": "Class", "kind": "session", "blocks": [{"id": "a", "label": "A", "evidence": [], "exercises": [
        move("Burpees", "10 Burpees"), move("Air Squats", "15 Air Squats")]}]}
    workout, _, _ = ground(page, raw)
    assert workout.blocks[0].instructions == ["8 Minutes cap, move steadily"]
    assert [part.rows for part in read_outline(page).parts] == [["10 Burpees", "15 Air Squats"]]


def test_a_renamed_part_keeps_its_review_warnings_under_the_new_label():
    raw = model_output()
    raw["blocks"][2]["role"] = "warm_up"  # no source support: grounding warns about "Anaerobic intervals"
    workout, warnings, _ = ground(raw=raw)
    assert "Unsupported role for B. Every 3 minutes for 9 minutes (3 rounds) removed." in warnings
    assert not any("Anaerobic intervals" in warning for warning in warnings)


def test_minutes_holding_two_movements_never_rotate_one_per_minute():
    page = """C. Every minute for 8 minutes (4 rounds):
Minute 1
8 Dumbbell Snatches
Max Sit-Ups
Minute 2
Rest for 1 minute"""
    raw = {"title": "EMOM", "kind": "session", "blocks": [{
        "id": "c", "label": "C. EMOM", "grouping": "interval",
        "execution": {"mode": "emom", "interval_seconds": 60, "intervals": 8, "rotation": "alternating"},
        "evidence": [ev("execution.mode", "Every minute for 8 minutes (4 rounds):"),
                     ev("execution.intervals", "Every minute for 8 minutes (4 rounds):")],
        "exercises": [move("Dumbbell Snatches", "8 Dumbbell Snatches", reps_min=8, reps_max=8),
                      move("Sit-Ups", "Max Sit-Ups")]}]}
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


def test_notes_need_more_than_one_shared_word_to_move_to_the_next_part():
    page = """D. ACCESSORIES
Single Arm Cable Row (2011 tempo)
3 sets of 10 reps
- Upper back pull volume
- Add a little load each week

- Keep your ribs down on the bear crawl pull
- Lift with thumbs pointed up
3 alternating sets of:
E1. Bear Crawl Pull-Throughs for 15 seconds
E2. 10-12 Incline Thumbs-Up Raises"""
    d, e = read_outline(page).parts
    assert d.notes == ["Upper back pull volume", "Add a little load each week"]
    assert e.notes == ["Keep your ribs down on the bear crawl pull", "Lift with thumbs pointed up"]


def test_a_skipped_rounds_for_time_part_keeps_its_rounds_and_cap():
    page = """D. 4 Rounds for Time:
5 Wall Climbs
16 Walking Lunges
Time Cap: 12 minutes"""
    workout, warnings, _ = ground(page, {"title": "Class", "kind": "session", "blocks": []})
    block = workout.blocks[0]
    assert block.execution.model_dump(exclude_none=True) == {"mode": "for_time", "time_cap_seconds": 720}
    assert (block.rounds, [item.name for item in block.exercises]) == (4, ["Wall Climbs", "Walking Lunges"])
    assert any("read from the page layout" in warning for warning in warnings)


def test_a_printed_group_sets_its_rounds_and_active_recovery_is_not_scored():
    page = """3 alternating sets of:
A1. 8 Woodchops
A2. 6-8 Side Plank Rotations
C. ACCESSORIES
Active Recovery Rower for 8 minutes
- Easy pace"""
    raw = {"title": "Class", "kind": "session", "blocks": [
        {"id": "a", "label": "A. Core", "grouping": "sequential", "evidence": [],
         "exercises": [move("Woodchops", "8 Woodchops", reps_min=8, reps_max=8),
                       move("Side Plank Rotations", "6-8 Side Plank Rotations", reps_min=6, reps_max=8)]},
        {"id": "c", "label": "C. ACCESSORIES", "evidence": [], "exercises": [move("Rower", "Active Recovery Rower")]}]}
    workout, _, _ = ground(page, raw)
    a, c = workout.blocks
    assert (a.grouping, a.rounds) == ("superset", 3)
    assert (c.role, c.score_kind) == ("cool_down", "none")


def test_a_group_the_model_split_into_two_blocks_is_one_part_again():
    page = """2 alternating sets of:
E1. 12-15 Banded Lateral Raises
Rest 45 seconds
E2. Hollow Rock for 20-30 seconds
Rest 45 seconds"""
    raw = {"title": "Class", "kind": "session", "blocks": [
        {"id": "e1", "label": "D. E1. Banded Lateral Raises", "evidence": [], "exercises": [move("Banded Lateral Raises", "12-15 Banded Lateral Raises")]},
        {"id": "e2", "label": "D. E2. Hollow Rock", "evidence": [], "exercises": [move("Hollow Rock", "Hollow Rock")]}]}
    workout, _, _ = ground(page, raw)
    assert len(workout.blocks) == 1
    block = workout.blocks[0]
    assert block.label.startswith("E.") and (block.grouping, block.rounds) == ("superset", 2)
    assert [item.name for item in block.exercises] == ["Banded Lateral Raises", "Hollow Rock"]


def test_a_part_made_from_a_coach_note_is_removed():
    raw = model_output()
    raw["blocks"].append({"id": "z", "label": "Zone 2 Aerobic Conditioning", "evidence": [],
                          "exercises": [move("Aerobic conditioning", "Aerobic conditioning")]})
    workout, warnings, _ = ground(PAGE + "\n- Zone 2 aerobic conditioning builds your base", raw)
    assert all(block.label != "Zone 2 Aerobic Conditioning" for block in workout.blocks)
    assert "A part that is not on the page was removed." in warnings

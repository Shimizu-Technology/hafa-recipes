"""Ground opt-in class structure without exposing new shapes to older imports."""

import logging
import re
from copy import deepcopy
from functools import cache

logger = logging.getLogger(__name__)
LAYOUT_WARNING = "The page layout could not be read; review every part against the source."
WORKOUT_KEYS = ("benchmark", "programming")
BLOCK_KEYS = ("role", "rest_after_seconds", "score_kind", "instructions", "time_window_seconds")
EXERCISE_KEYS = ("segment", "distance_meters_min", "duration_seconds_max", "load_options", "relative_load",
                 "set_prescriptions", "value_options", "calories", "calories_min")
CLASS_PROMPT = """
Class mode: preserve a spelled-out "As Many Rounds and Reps as possible in
15 minutes" as execution.mode=amrap,time_cap_seconds=900, never an untimed circuit.
Keep "12 or 15 reps" as discrete alternatives in effort, with reps_min/reps_max
null; never convert "or" to an inclusive range or "up to". "800 to 1000m" is
 distance_meters_min=800,distance_meters=1000. Keep a "30-40 seconds" hold typed
as duration_seconds=30,duration_seconds_max=40, not just instructions.
Class mode: A./B./Part A/A) headings are ordered parts; A1/A2 or D1/D2/D3
under one heading form one superset. REST N MINS between parts is the previous
part's rest_after_seconds; never put it on the last part. Buy-in/then before
repeating moves is segment=buy_in, and Cash-out is cash_out (AMRAP/for-time).
800-1000m is distance_meters_min=800,distance_meters=1000; 30-40s is
 duration_seconds=30,duration_seconds_max=40. Per-sex 20/14 lb becomes
load_options, with no invented sex labels. %BW/bodyweight and %1RM become
relative_load; RPE/RIR stay effort. These class rules override the legacy null-load rules.
Warm-up/Cooldown/Active recovery set role and score_kind=none; accessories set
role=accessory. Timed main parts use role=main. Quote coach notes exactly:
paragraphs before the first heading go in workout instructions, notes below a
heading in that part's instructions. A benchmark requires an explicit source
quote naming it; preserve progression 2/3 as stage/stages. Supply evidence for
each class field, including segment, ranges, load options, rest, role and notes.
Ignore leaderboards, athlete names/results and comments in images; extract only
the programming and coach instructions. Never copy other members into output.
Return one block per lettered part (A., B., or an A1/A2 group) in source order,
however long the class: never merge, split or skip parts. "Workout Specific
Movement Prep" is a link, never a block. One exercise per movement, even when
"Set 1 - 5 reps ... Set 4 - Max reps" lists its sets. Quote the shortest exact
phrase as evidence.
"""
# Screenshots are copied to text first, so the class is grounded like a paste.
TRANSCRIPT_LOCATION = "screenshot_text"
TRANSCRIPT_PROMPT = """Copy the workout programming printed in these class screenshots, one printed line per entry.
The screenshots are in scrolling order and may overlap: write each printed line once.
Copy words, numbers, ranges, slashes and punctuation exactly. Join a line the screen wrapped; never fix,
reword, summarize, explain or add anything.
Keep the class title and day heading, part letters (A., B., C1.), group lines ("3 alternating sets ... of:"),
format lines, "Minute 1" lines, section headings such as ACCESSORIES, every movement row and every coach note.
Start each coach-note bullet with "- ". Keep a linked heading such as "Workout Specific Movement Prep" once,
without its "View ..." link.
Leave out the phone status bar, icons, buttons and links (Log Result, Leaderboard, View, Show more/less), app
menus, and anything after the programming. Leave out leaderboards, results, member names, comments and reactions.
Return no lines when the screenshots show no workout programming."""
SCREENSHOT_NOTICE = "This class was read from screenshots; check it against the class."
TRANSCRIPT_FAILED = "The screenshots could not be copied as text first; check every part against the class."


def transcript_messages(source):
    """Untrusted screenshots sit inside one user message, never a role."""
    content = [{"type": "text", "text": "Class screenshots, in scrolling order:"}]
    for image in source.images:
        content.append({"type": "text", "text": f"Source location {image.location}"})
        content.append({"type": "image_url", "image_url": {"url": image.data_url, "detail": "high"}})
    return [{"role": "system", "content": TRANSCRIPT_PROMPT}, {"role": "user", "content": content}]


def transcript_response_format():
    schema = {"type": "object", "additionalProperties": False, "required": ["lines"],
              "properties": {"lines": {"type": "array", "items": {"type": "string"}}}}
    return {"type": "json_schema", "json_schema": {"name": "class_transcript", "schema": schema, "strict": True}}


def transcript_text(raw, limit):
    lines = raw["lines"]
    if not isinstance(lines, list) or not all(isinstance(line, str) for line in lines):
        raise ValueError("transcript lines")
    # "⟳ 3 alternating sets", "⏱ B. Every minute" and "▪ Rower" lose their icons so the layout reads them.
    lines = [re.sub(r"^[^\w\s\-–(\"'“‘]+\s*", "", line.strip()) for line in lines]
    return "\n".join(line for line in lines if line)[:limit]


@cache
def _prompt_clauses():
    from app.domains.workouts.extraction import SYSTEM_PROMPT

    prompts = " ".join([SYSTEM_PROMPT, CLASS_PROMPT, TRANSCRIPT_PROMPT])
    return [set(re.findall(r"[a-z0-9]+", clause.lower())) for clause in re.split(r"[.;!?]\s|\n\s*\n", prompts)]


def prompt_echo(note, text):
    """A note that restates an instruction ("Movement Prep is a link, not a block")
    rather than the class. Wording the class itself prints always stays."""
    if note in text:
        return False
    said = set(re.findall(r"[a-z0-9]+", note.lower()))
    return len(said) >= 4 and any(len(said & clause) >= 0.8 * len(said) for clause in _prompt_clauses())


def apply_layout(workout, text, warnings, rows=False):
    """Read the page layout on a copy; a layout the reader cannot follow keeps the model's parts."""
    from app.domains.workouts.class_outline import apply_outline, stale_warnings

    draft, notes, renames = workout.model_copy(deep=True), [], {}
    try:
        apply_outline(draft, text, notes, renames, rows)
    except Exception:  # noqa: BLE001 - a heuristic reader must never fail the import
        logger.exception("workouts_class_layout_failed")
        warnings.append(LAYOUT_WARNING)
        return
    for name in type(workout).model_fields:
        setattr(workout, name, getattr(draft, name))
    for old_label, new_label in renames.items():
        # "Unsupported rounds removed from Intervals." follows its part's printed label.
        pattern = rf"\b(from|for) {re.escape(old_label)}(?=[ .:]| removed)"
        warnings[:] = [re.sub(pattern, lambda match: f"{match[1]} {new_label}", warning) for warning in warnings]
    placed = any(block.instructions for block in workout.blocks) or bool(workout.instructions)
    warnings[:] = stale_warnings(workout, warnings, placed) + notes


def screenshot_notes_without_members(workout, warnings):
    """Screenshot notes have no text to check against, so drop any that read
    as a member's result or comment ("Jane Doe 12:43 Rx", "Mike R: great job")."""
    from app.domains.workouts.class_outline import member_comment, member_line

    def member(note):
        return member_line(note) or member_comment(note)

    removed = False
    for holder in [workout, *workout.blocks]:
        notes = holder.instructions or []
        kept = [note for note in notes if not member(note)]
        removed |= len(kept) < len(notes)
        holder.instructions = kept if holder is workout else (kept or None)
    if removed:
        warnings.append("Lines that read like member results or comments were left out of the coach notes.")


NOTE_ROW = re.compile(r"^(.+?)\s+(?:distances?|ranges?)$", re.I)


def review_screenshot_rows(workout, warnings):
    """A screenshot's "RUN DISTANCE 800-1000m" note is a range, not a movement,
    and a run read as 100 m beside an 800-1000 m range needs a second look."""
    for block in workout.blocks:
        ranges, rows = {}, []
        for item in block.exercises:
            note = NOTE_ROW.match(item.name)
            if note and item.distance_meters_min is not None:
                ranges.setdefault(note[1].casefold(), []).append((item.distance_meters_min, item.distance_meters))
            else:
                rows.append(item)
        if len(rows) == len(block.exercises):
            continue
        block.exercises = rows
        seen = {}
        for item in rows:
            listed = ranges.get(item.name.casefold(), [])
            index = seen[item.name.casefold()] = seen.get(item.name.casefold(), -1) + 1
            if index >= len(listed) or item.distance_meters is None:
                continue
            low, high = listed[index]
            if item.distance_meters_min is not None:
                # The row already has its own range: both ends must agree, or keep it and ask for review.
                if (item.distance_meters_min, item.distance_meters) != (low, high):
                    warnings.append(f"{item.name} reads {item.distance_meters_min:g}-{item.distance_meters:g} m but "
                                    f"{block.label} lists {low:g}-{high:g} m; check the screenshot.")
            elif low <= item.distance_meters <= high:
                item.distance_meters, item.distance_meters_min = high, low
            else:
                warnings.append(f"{item.name} reads {item.distance_meters:g} m but {block.label} lists "
                                f"{low:g}-{high:g} m; check the screenshot.")


def load_pairs(wording):
    pairs = set()
    number = r"\d+(?:\.\d+)?"
    unit = r"kg|lbs?"
    chain = rf"(?<![\d.])(?:{number}\s*(?:{unit})?\s*/\s*(?:[♀♂]\s*)?){{1,3}}{number}\s*(?:{unit})\b"
    for match in re.finditer(chain, wording, re.I):
        trailing = None
        for value, own_unit in reversed(re.findall(rf"({number})\s*({unit})?", match[0], re.I)):
            trailing = (own_unit or trailing).lower().rstrip("s")
            pairs.add((float(value), trailing))
    return pairs


def legacy_shape(raw):
    raw = deepcopy(raw)
    for key in WORKOUT_KEYS:
        raw.pop(key, None)
    for block in raw.get("blocks", []):
        for key in BLOCK_KEYS:
            block.pop(key, None)
        for exercise in block.get("exercises", []):
            for key in EXERCISE_KEYS:
                exercise.pop(key, None)
    return raw


def ground_class(workout, raw, source, warnings):
    from app.domains.workouts.extraction import _numeric_supported, _quote_is_supported

    text = "\n".join(p.text for p in source.parts)
    # Screenshots have no text to quote; their notes are the model's reading of
    # the page and stay under the visual-review warning.
    image_only = not text.strip() and bool(source.images)
    def quotes(item, field):
        return [e.wording for e in item.evidence if e.field == field and _quote_is_supported(e, source)]
    def quoted(value, item, field):
        return image_only or value in text or value in quotes(item, field)
    printed_notes = {re.sub(r"^-\s+", "", line.strip()) for line in text.splitlines() if line.strip()}
    # An echoed instruction is not the class; it goes without a review warning.
    raw_notes = [v for v in raw.get("instructions", []) if not prompt_echo(v, text)]
    workout.instructions = [v for v in raw_notes if quoted(v, workout.blocks[0], "workout_instructions")] if workout.blocks else []
    if len(workout.instructions) < len(raw_notes):
        warnings.append("Unquoted coach notes removed; review the source.")
    benchmark = workout.benchmark
    if benchmark:
        evidence_text = text + "\n" + "\n".join(q for b in workout.blocks for q in quotes(b, "benchmark"))
        # 'benchmark "Summit"' or WodUp's 'benchmark workout, "Summit"'.
        named = rf"\bbenchmark(?:\s+(?:workout|wod|test))?(?:\s*[,:–—-]\s*|\s+)['\"‘’“”]?{re.escape(benchmark.name)}(?:['\"‘’“”]|\b)"
        if not re.search(named, evidence_text, re.I):
            workout.benchmark = None
            warnings.append("Unsupported benchmark removed; review the source.")
        elif benchmark.stage is not None and not re.search(rf"\bprogression\s+{benchmark.stage}\s*/\s*{benchmark.stages}\b", evidence_text, re.I):
            benchmark.stage = benchmark.stages = None
            warnings.append("Unsupported benchmark progression removed.")
    if workout.benchmark:
        workout.benchmark.key = re.sub(r"[^a-z0-9]+", "-", workout.benchmark.name.lower()).strip("-")[:60] or workout.benchmark.key
    for block, original in zip(workout.blocks, raw.get("blocks", [])):
        notes = [v for v in original.get("instructions") or [] if not prompt_echo(v, text)]
        block.instructions = [v for v in notes if quoted(v, block, "instructions")] or None
        if len(block.instructions or []) < len(notes):
            warnings.append(f"Unquoted coach notes removed from {block.label}.")
        count = original.get("rounds")
        if count and block.rounds is None and any(re.search(rf"\b{count}\s+alternating sets\b", q, re.I) for q in quotes(block, "rounds")):
            block.rounds = count
            warnings[:] = [w for w in warnings if w != f"Unsupported rounds removed from {block.label}."]
        if block.rest_after_seconds is not None and not any(_numeric_supported("rest_seconds", block.rest_after_seconds, q) for q in quotes(block, "rest_after_seconds")):
            block.rest_after_seconds = None
            warnings.append(f"Unsupported rest after {block.label} removed.")
        # "Workout Specific Movement Prep" heads the part that opens the class.
        role_words = {"warm_up": r"warm[ -]?up|movement prep", "cool_down": r"cool[ -]?down|active recovery", "accessory": r"accessor"}
        # A part heading copied verbatim ("D. ACCESSORIES") is its own role evidence.
        heading = [block.label] if block.label and re.search(rf"^\s*{re.escape(block.label)}\s*:?\s*$", text, re.I | re.M) else []
        if block.role and block.role != "main" and not any(re.search(role_words[block.role], q, re.I) for q in quotes(block, "role") + quotes(block, "label") + heading):
            block.role = block.score_kind = None
            warnings.append(f"Unsupported role for {block.label} removed.")
        if block.score_kind == "none" and block.role not in {"warm_up", "cool_down", "accessory"}:
            block.score_kind = None
        for item, old in zip(block.exercises, original["exercises"]):
            if item.instructions and prompt_echo(item.instructions, text):
                item.instructions = None
            note = old.get("instructions")
            if item.instructions is None and note in printed_notes:
                # A coach note the class prints is its own quote; the page layout places it.
                item.instructions = note
                warnings[:] = [w for w in warnings if w != f"Unsupported notes removed from {item.name}."]
            rest = old.get("duration_seconds")
            if re.fullmatch(r"rest", item.name.strip(), re.I) and item.duration_seconds is None and rest and any(
                    _numeric_supported("duration_seconds", rest, re.sub(r"^\W*rest\s+(?:for\s+)?", "", q, flags=re.I))
                    for q in quotes(item, "duration_seconds")):
                # A "Rest for 1 minute" station is the rest itself, not a rest after a movement.
                item.duration_seconds = rest
                warnings[:] = [w for w in warnings if w != f"Unsupported duration_seconds removed from {item.name}."]
            if item.per_side is None and re.search(r"\bside[ -]lying|\bunilateral\b", item.name, re.I):
                warnings.append(f"Per-side details for {item.name} are unspecified; review the source.")
            for field, base, unit in (("distance_meters_min", "distance_meters", "distance"), ("duration_seconds_max", "duration_seconds", "duration")):
                if getattr(item, field) is None:
                    continue
                valid = False
                for q in quotes(item, field):
                    for a, b, suffix in re.findall(r"(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(km|meters?|metres?|m|seconds?|secs?|s|minutes?|mins?)\b", q, re.I):
                        suffix = suffix.lower()
                        units = {"km", "m", "meter", "meters", "metre", "metres"} if unit == "distance" else {"s", "sec", "secs", "second", "seconds", "m", "min", "mins", "minute", "minutes"}
                        if suffix not in units:
                            continue
                        factor = 1000 if suffix == "km" else 60 if unit == "duration" and suffix in {"m", "min", "mins", "minute", "minutes"} else 1
                        expected = (old[field], old[base]) if unit == "distance" else (old[base], old[field])
                        valid |= (float(a) * factor, float(b) * factor) == expected
                if valid:
                    setattr(item, base, old[base])
                    warnings[:] = [w for w in warnings if w != f"Unsupported {base} removed from {item.name}."]
                else:
                    setattr(item, field, None)
                    warnings.append(f"Unsupported {field} removed from {item.name}.")
            if item.segment and not any(re.search(rf"\b{item.segment.replace('_', '[ -]?')}\b", q, re.I) for q in quotes(item, "segment")):
                item.segment = None
                warnings.append(f"Unsupported segment removed from {item.name}.")
            if item.relative_load:
                load = item.relative_load
                basis = r"(?:BW|body\s*weight)" if load.basis == "bodyweight" else r"1\s*RM"
                if not any(re.search(rf"(?<![\d.]){load.percent:g}\s*%\s*(?:of\s+)?{basis}\b", q, re.I) for q in quotes(item, "relative_load")):
                    item.relative_load = None
                    warnings.append(f"Unsupported relative load removed from {item.name}.")
            if item.load_options:
                q = "\n".join(quotes(item, "load_options"))
                if not all((option.load, option.load_unit) in load_pairs(q) for option in item.load_options):
                    item.load_options = None
                    warnings.append(f"Unsupported load options removed from {item.name}.")
                else:
                    for option in item.load_options:
                        if option.label and option.label not in q:
                            option.label = None
        phases = [{"buy_in": 0, None: 1, "cash_out": 2}[item.segment] for item in block.exercises]
        if any(item.segment for item in block.exercises) and (block.execution is None or block.execution.mode not in {"amrap", "for_time"} or phases != sorted(phases)):
            for item in block.exercises:
                item.segment = None
            warnings.append(f"Buy-in/cash-out structure for {block.label} needs review; source quotes were retained.")
    if image_only:
        review_screenshot_rows(workout, warnings)
        screenshot_notes_without_members(workout, warnings)
        if workout.instructions or any(block.instructions for block in workout.blocks):
            warnings.append("Coach notes were read from screenshots; check them against the class.")
    workout.programming = None  # Only explicit request hints can supply this private metadata.
    if text.strip():
        apply_layout(workout, text, warnings, rows=source.class_rows)


# Resume at programming, not at athlete initials inside a leaderboard.
PART_HEADING = re.compile(r"^(?:part\s+)?([a-z])(\d{1,2})?(?:[.):]\s*|\s+|$)", re.I)
CLASS_SECTION = re.compile(r"^(?:workout(?:\s+of\s+the\s+day)?|wod|coach(?:'s)? notes?|warm[- ]?up|cool[- ]?down|accessories)\s*[:—-]?$", re.I)
BUTTON_LABEL = re.compile(r"^(?:log (?:a )?result|view(?:\s+.*)?|show (?:more|less))\s*:?$", re.I)
PRIVATE_SECTION = re.compile(r"^(?:leaderboard|results?|comments?(?:\s*\(\d+\))?|athletes?|members?)\s*:?$", re.I)
MEMBER_NAME = r"[^\W\d][\w.'’\-]*(?:[ \t]+[^\W\d][\w.'’\-]*){0,5}"
MEMBER_SCORE = re.compile(
    rf"^{MEMBER_NAME}[ \t]+(?:\d+\s*\+\s*\d+|\d{{1,3}}:\d{{2}}(?::\d{{2}})?|"
    r"\d+(?:\.\d+)?(?:\s*(?:rounds?|reps?|kg|lbs?|calories|meters?|m|seconds?|s|minutes?|min))?)"
    r"(?:\s+(?:rx|scaled|custom))?$", re.I)
MEMBER_COMMENT = re.compile(rf"^{MEMBER_NAME}:\s*\S.*$")
CAPS_FORMAT = re.compile(r"\b(?:AMRAP|EMOM|E\d+MOM)\b")
FORMAT_PHRASE = re.compile(r"\b(?:for time|as many rounds|every minute|rest between)\b", re.I)
PART_SECTION = re.compile(r"(?:accessories|warm[- ]up|cool[- ]down|strength|conditioning)", re.I)
RESULT_SCORE_TOKEN = re.compile(r"(?:\d+:\d{2}(?::\d{2})?(?:\.\d+)?|\d+\+\d+|\d+(?:\.\d+)?(?:reps|rounds|cal|lbs?|kg|m)?)", re.I)
RESULT_VOCABULARY = {"rx", "rx+", "rx'd", "scaled", "sc", "fitness", "foundations", "masters", "pr", "cap", "dnf", "tc",
                     "reps", "rounds", "cal", "lb", "lbs", "kg", "m", "*", "★", "✓"}
PREAMBLE_BOUNDARY = re.compile(r"^(?:phase\s+\d|week\s+\d|workout specific|coach(?:'s)? notes?)\b", re.I)


def member_score_line(value):
    # Keep notes together and require every other token to be result vocabulary
    # or a score component. This also handles TC prefixes and rounds + reps.
    tokens = re.findall(r"\([^()\r\n]*\)|\S+", value.replace("’", "'"))
    return bool(tokens) and any(token != "+" for token in tokens) and all(
        RESULT_SCORE_TOKEN.fullmatch(token) or token.casefold() in RESULT_VOCABULARY
        or token == "+" or re.fullmatch(r"\([^()\r\n]*\)", token)
        for token in tokens)


def workout_part(value, part, following):
    body = value[part.end():] if part else ""
    if member_score_line(following):
        return False
    prefix_signal = re.match(r"^\d", body) or CAPS_FORMAT.match(body) or FORMAT_PHRASE.match(body) or PART_SECTION.fullmatch(body)
    if (MEMBER_SCORE.fullmatch(value) or MEMBER_COMMENT.fullmatch(value)) and not prefix_signal:
        return False
    return bool(re.search(r"\d", body) or CAPS_FORMAT.search(body) or FORMAT_PHRASE.search(body) or PART_SECTION.fullmatch(body))


TRIM_WARNING = "Navigation, results or member sections were removed. Review all workout parts against the source."
MISSING_CLASS_TEXT = "No workout section was found. Paste the workout section or add cropped screenshots."


class ClassTextUnavailable(ValueError):
    pass


def class_text(text):
    return trim_class_parts([("text", text)])[0][1]


def trim_class_parts(parts, warnings=None):
    """Remove member rows, preserving programming below WodUp header buttons."""
    lines = [(location, text.splitlines()) for location, text in parts]
    # Look ahead across page boundaries without letting blank lines hide scores.
    following_lines, following = [], ""
    for _, page in reversed(lines):
        for line in reversed(page):
            following_lines.append(following)
            if line.strip():
                following = line.strip()
    following_lines = iter(reversed(following_lines))
    has_heading = any(re.fullmatch(r"(?:workout(?: of the day)?|wod|coach(?:'s)? notes?)\s*[:—-]?", line.strip(), re.I)
                      for _, page in lines for line in page)
    started, suppressed, current, removed = not has_heading, False, None, False
    result = []
    for location, page in lines:
        clean = []
        for index, line in enumerate(page):
            value = line.strip()
            following = next(following_lines)
            part = PART_HEADING.match(value)
            expected = chr(ord(current) + 1) if current else "a"
            next_part = part and (part[1].lower() == expected or (current is None and not suppressed)
                                  or (part[1].lower() == current and part[2]))
            if BUTTON_LABEL.fullmatch(value):
                removed = True
                continue
            if PRIVATE_SECTION.fullmatch(value):
                # WodUp's header has adjacent action buttons before its phase
                # heading. This is navigation, not a member-results section.
                header_navigation = (current is None and not suppressed and value.lower().rstrip(":") == "leaderboard"
                                     and index > 0 and BUTTON_LABEL.fullmatch(page[index - 1].strip())
                                     and index + 1 < len(page) and PREAMBLE_BOUNDARY.search(page[index + 1].strip()))
                suppressed, removed = not header_navigation, True
                continue
            if suppressed:
                later_part = part and (current is None or part[1].lower() > current)
                next_part = (next_part or later_part) and workout_part(value, part, following)
                boundary = next_part or CLASS_SECTION.fullmatch(value)
                if not boundary:
                    removed = True
                    continue
                # Member names and scores may occupy separate lines. Only a
                # recognized programming boundary can end a private section.
                suppressed = False
            if next_part:
                current = part[1].lower()
                started, suppressed = True, False
            elif CLASS_SECTION.fullmatch(value) and not suppressed:
                started = True
            if started and not suppressed:
                clean.append(line)
            else:
                removed = True
        result.append((location, "\n".join(clean)))
    if removed and warnings is not None and TRIM_WARNING not in warnings:
        warnings.append(TRIM_WARNING)
    if any(text.strip() for _, text in parts) and not any(text.strip() for _, text in result):
        raise ClassTextUnavailable(MISSING_CLASS_TEXT)
    return result

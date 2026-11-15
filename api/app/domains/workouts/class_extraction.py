"""Ground opt-in class structure without exposing new shapes to older imports."""

import re
from copy import deepcopy

WORKOUT_KEYS = ("benchmark", "programming")
BLOCK_KEYS = ("role", "rest_after_seconds", "score_kind", "instructions")
EXERCISE_KEYS = ("segment", "distance_meters_min", "duration_seconds_max", "load_options", "relative_load")
CLASS_PROMPT = """
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
"""


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
    def quotes(item, field):
        return [e.wording for e in item.evidence if e.field == field and _quote_is_supported(e, source)]
    def quoted(value, item, field):
        return value in text or value in quotes(item, field)
    workout.instructions = [v for v in raw.get("instructions", []) if quoted(v, workout.blocks[0], "workout_instructions")] if workout.blocks else []
    if len(workout.instructions) < len(raw.get("instructions", [])):
        warnings.append("Unquoted coach notes removed; review the source.")
    benchmark = workout.benchmark
    if benchmark:
        evidence_text = text + "\n" + "\n".join(q for b in workout.blocks for q in quotes(b, "benchmark"))
        if not re.search(rf"\bbenchmark\s+['\"‘’“”]?{re.escape(benchmark.name)}(?:['\"‘’“”]|\b)", evidence_text, re.I):
            workout.benchmark = None
            warnings.append("Unsupported benchmark removed; review the source.")
        elif benchmark.stage is not None and not re.search(rf"\bprogression\s+{benchmark.stage}\s*/\s*{benchmark.stages}\b", evidence_text, re.I):
            benchmark.stage = benchmark.stages = None
            warnings.append("Unsupported benchmark progression removed.")
    if workout.benchmark:
        workout.benchmark.key = re.sub(r"[^a-z0-9]+", "-", workout.benchmark.name.lower()).strip("-")[:60] or workout.benchmark.key
    for block, original in zip(workout.blocks, raw.get("blocks", [])):
        block.instructions = [v for v in original.get("instructions") or [] if quoted(v, block, "instructions")] or None
        if len(block.instructions or []) < len(original.get("instructions") or []):
            warnings.append(f"Unquoted coach notes removed from {block.label}.")
        count = original.get("rounds")
        if count and block.rounds is None and any(re.search(rf"\b{count}\s+alternating sets\b", q, re.I) for q in quotes(block, "rounds")):
            block.rounds = count
            warnings[:] = [w for w in warnings if w != f"Unsupported rounds removed from {block.label}."]
        if block.rest_after_seconds is not None and not any(_numeric_supported("rest_seconds", block.rest_after_seconds, q) for q in quotes(block, "rest_after_seconds")):
            block.rest_after_seconds = None
            warnings.append(f"Unsupported rest after {block.label} removed.")
        role_words = {"warm_up": r"warm[ -]?up", "cool_down": r"cool[ -]?down|active recovery", "accessory": r"accessor"}
        if block.role and block.role != "main" and not any(re.search(role_words[block.role], q, re.I) for q in quotes(block, "role")):
            block.role = block.score_kind = None
            warnings.append(f"Unsupported role for {block.label} removed.")
        if block.score_kind == "none" and block.role not in {"warm_up", "cool_down", "accessory"}:
            block.score_kind = None
        for item, old in zip(block.exercises, original["exercises"]):
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
                        factor = 1000 if suffix == "km" else 60 if unit == "duration" and suffix in {"m", "min", "mins", "minute", "minutes"} else 1
                        expected = (old[field], old[base]) if unit == "distance" else (old[base], old[field])
                        valid |= (float(a) * factor, float(b) * factor) == expected and suffix in units
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
                if not re.search(r"\d\s*(?:kg|lb)?\s*/\s*(?:[♀♂]\s*)?\d", q, re.I) or not all(re.search(rf"(?<![\d.]){o.load:g}(?![\d.])", q) and re.search(rf"\b{o.load_unit}\b", q, re.I) for o in item.load_options):
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
    workout.programming = None  # Only explicit request hints can supply this private metadata.


# Conservative section boundaries for visible WodUp/page text. Never use an AI
# call to identify the private rows we are trying to keep out of that call.
CLASS_SECTION = re.compile(r"^(?:part\s+)?[a-z](?:[.)]|\s*:)(?:\s*(?:amrap|emom|for time|warm[- ]?up|cool[- ]?down|active recovery|accessories|strength|conditioning|\d+\s+(?:sets|rounds))\b.*|\s*)$|^(?:workout(?:\s+of\s+the\s+day)?|wod|coach(?:'s)? notes?|warm[- ]?up|cool[- ]?down|accessories)\s*[:—-]?$", re.I)
PRIVATE_SECTION = re.compile(r"^(?:log (?:a )?result|leaderboard|(?:view |show |all )?(?:results?|comments?|athletes?|members?))(?:\b|$)", re.I)


def class_text(text):
    return trim_class_parts([("text", text)])[0][1]


def trim_class_parts(parts):
    """Keep programming; private sections stay suppressed across PDF pages."""
    lines = [(location, text.splitlines()) for location, text in parts]
    has_heading = any(re.fullmatch(r"(?:workout(?: of the day)?|wod|coach(?:'s)? notes?)\s*[:—-]?", line.strip(), re.I)
                      for _, page in lines for line in page)
    started, suppressed = not has_heading, False
    result = []
    for location, page in lines:
        clean = []
        for line in page:
            value = line.strip()
            if CLASS_SECTION.search(value):
                started, suppressed = True, False
            elif PRIVATE_SECTION.search(value):
                suppressed = True
                continue
            if started and not suppressed:
                clean.append(line)
        result.append((location, "\n".join(clean)))
    return result

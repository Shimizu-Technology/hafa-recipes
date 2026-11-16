"""Read each class movement's own source row: listed sets, ranges and per-athlete values.

"Set 1 – 5 reps", "8-10 Incline Presses (2011 tempo)", "Echo Bike for 8/10
seconds", "Step-Ups 20/16 inches" and "Men: 12-16kg" are printed facts.
The server reads them from the row instead of asking the model again.
"""

import re

from app.domains.workouts.class_outline import words
from app.domains.workouts.schemas import LoadOption, RelativeLoad, SetPrescription, ValueOption

SET_ROW = re.compile(r"^set\s+(\d+)\s*[–-]\s*(?:(\d+)(?:\s*[–-]\s*(\d+))?|(max))\s*reps?$", re.I)
WINDOW_ROW = re.compile(r"^within\s+(\d+)\s*(?:minutes?|mins?)\s*:?$", re.I)
SETS_ROW = re.compile(r"^(\d+)\s+sets\s+of(?:\s+(\d+)\s+(reps?|minutes?|seconds?))?(.*)$", re.I)
# "Rest 75 seconds between sets" is a set rest only when that is all the line says.
REST_BETWEEN = re.compile(r"^rest\s+(\d+)\s*(seconds?|secs?|minutes?|mins?)(?:\s+between\s+(?:sets|rounds|sides))?\s*\.?$", re.I)
# "REST 2 MINS BEFORE THE NEXT PART" or "Rest 4 minutes, then go to C" is a rest between parts.
REST_AFTER = re.compile(r"\brest\s+(\d+)\s*(?:minutes?|mins?)\b.*\b(?:before|then|next part|go to|move to)\b", re.I)
SET_PERCENT = re.compile(r"\bset\s+(\d+)\b[^%\n]*?~?\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*%", re.I)
SEX_LOAD = re.compile(r"\b(men|women)\s*:\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*(kg|lbs?)\b", re.I)
SEX_VALUE = re.compile(r"\b(\d+)\s*\((men|women)\)", re.I)
UNIT_WORD = re.compile(r"^(?:cal|calories|cals|seconds?|secs?|meters?|m|minutes?|mins?|degrees?|kg|lbs?)\b", re.I)
LOADED = re.compile(r"\b(?:dumbbell|db|kettlebell|kb|barbell|sandbag|wall ?ball|clean|snatch|press|deadlift|squat)", re.I)


def _seconds(amount, unit):
    return int(float(amount) * (60 if unit.lower().startswith("m") else 1))


def _rows_for(block, part):
    """Each exercise's own source row, in order; repeated names take later rows."""
    units = [part, *part.items]
    rows = [re.sub(r"^[A-Z]\d*\.\s+", "", line) for unit in units for line in [unit.heading, *unit.rows]]
    used, found = set(), []
    for item in block.exercises:
        name = words(item.name)
        match = next((i for i, row in enumerate(rows) if i not in used and name and name <= words(row)), None)
        if match is not None:
            used.add(match)
        found.append(rows[match] if match is not None else None)
    return found


def _enrich_from_row(item, row, part_notes, warnings):
    lead = re.match(r"^(\d+)\s*[-–]\s*(\d+)\s+(?=[A-Za-z]|\d+\s+[A-Za-z])", row)
    single = re.match(r"^(\d+)\s+(?=[A-Za-z])", row)
    if lead and not UNIT_WORD.match(row[lead.end():]):
        item.reps_min, item.reps_max = int(lead[1]), int(lead[2])
    elif single and not UNIT_WORD.match(row[single.end():]):
        n = int(single[1])
        if item.reps_min is None and item.reps_max is None or (item.reps_min == n and item.reps_max is None):
            item.reps_min = item.reps_max = n
    calories = re.search(r"(\d+)\s*(?:[-–]\s*(\d+)\s*)?cal(?:orie)?s?\b", row, re.I)
    if calories:
        low, high = int(calories[1]), int(calories[2] or calories[1])
        item.calories, item.calories_min = high, (low if calories[2] else None)
        if (item.reps_min, item.reps_max) in {(low, high), (low, None), (high, high)}:
            item.reps_min = item.reps_max = None
    timed = re.search(r"\bfor\s+(\d+)\s*/\s*(\d+)\s*(seconds?|secs?|minutes?|mins?)\b", row, re.I)
    if timed:
        labels = {int(value): sex.capitalize() for value, sex in SEX_VALUE.findall("\n".join(part_notes))}
        values = [_seconds(timed[1], timed[3]), _seconds(timed[2], timed[3])]
        item.value_options = [ValueOption(quantity="duration_seconds", value=value, unit="s", label=labels.get(int(raw)))
                              for value, raw in zip(values, (timed[1], timed[2]))]
        item.duration_seconds = item.duration_seconds_max = None
    height = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*(inches|inch|in|cm)\b", row, re.I)
    if height:
        unit = "cm" if height[3].lower() == "cm" else "in"
        item.value_options = [ValueOption(quantity="height", value=float(value), unit=unit) for value in height.group(1, 2)]
        heights = {float(value) for value in height.group(1, 2)}
        if item.load_options and {option.load for option in item.load_options} == heights:
            item.load_options = None  # "24/20 inches" read as a load
            warnings.append(f"Box heights on the {item.name} row were read as a load; the load was removed.")
    duration = re.search(r"\bfor\s+(\d+)\s*(?:[-–]\s*(\d+)\s*)?(seconds?|secs?|minutes?|mins?)\b", row, re.I)
    if duration and not timed:
        item.duration_seconds = _seconds(duration[1], duration[3])
        item.duration_seconds_max = _seconds(duration[2], duration[3]) if duration[2] else None
    tempo = re.search(r"\(\s*([0-9xX]{4})\s+tempo\s*\)", row, re.I)
    if tempo:
        item.tempo = tempo[1].upper()
    elif item.tempo and re.fullmatch(r"\S+\s+tempo", item.tempo, re.I):
        item.tempo = item.tempo.split()[0]
    for note in part_notes:
        # "REP RANGES / 10-15 toes to bar" widens "15 Toes to Bars"; the row prints the top.
        printed = re.match(r"^(\d+)\s+(?=[A-Za-z])", row)
        for low, high, named in re.findall(r"(\d+)\s*[-–]\s*(\d+)\s+([a-z][a-z \-]+)", note, re.I):
            tops = {item.reps_min, item.reps_max} | ({int(printed[1])} if printed else set())
            if words(named) and words(named) <= words(item.name) | words(row) and int(high) in tops:
                item.reps_min, item.reps_max = int(low), int(high)
    pair = re.search(r"@\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*(kg|lbs?)\b", row, re.I)
    if pair:
        unit = pair[3].lower().rstrip("s")
        item.load = item.load_unit = item.load_convention = item.relative_load = None
        item.load_options = [LoadOption(load=float(value), load_unit=unit) for value in pair.group(1, 2)]
    meters = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:meters?|m)\b", row, re.I)
    if not meters and item.distance_meters is not None and not re.search(r"\d\s*(?:km|mi|miles?|yards?|yd)\b", row, re.I):
        # "12 Kettlebell Swings @ 24/16 kg" prints no distance; a quoted "Row 250 meters" belongs to the row.
        item.distance_meters = item.distance_meters_min = None
        warnings.append(f"A distance from another row was removed from {item.name}.")
    if meters:
        # "RUN DISTANCE 800-1000m" in the part's notes is the range for "Run 1000 meters".
        top = float(meters[1])
        for low, high in re.findall(r"(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*m\b", "\n".join(part_notes)):
            if float(high) == top and float(low) < top:
                item.distance_meters, item.distance_meters_min = top, float(low)
        if item.distance_meters is None:
            item.distance_meters = top
    for note in part_notes:
        if words(item.name) & words(note) and re.search(r"\b(?:each|per|one)\s+side\b", note, re.I) and item.reps_min:
            if re.search(rf"\b{item.reps_min}\b", note):
                item.per_side = True
    most = re.search(r"\bmax\b(?:\s+(calories|cals|distance|reps))?", row, re.I)
    if most and ("max" not in (item.effort or "").lower() or (most[1] and most[1].lower() not in item.effort.lower())):
        item.effort = f"Max {most[1].lower()}" if most[1] else "Max"  # "Max Distance" is more than "Max"
    if item.load_options and not re.search(r"@|\d\s*/\s*\d", row) and not LOADED.search(item.name):
        item.load_options = None
        warnings.append(f"A load that is not on the {item.name} row was removed; review the source.")


def _sets_from_rows(block, part):
    listed = [match for match in map(SET_ROW.match, part.rows) if match]
    names = {frozenset(words(item.name)) for item in block.exercises}
    if listed and len(block.exercises) > 1 and len(names) == 1:
        block.exercises = block.exercises[:1]  # One exercise per listed set is still one exercise.
    single = block.exercises[0] if len(block.exercises) == 1 else None
    for line in part.rows:
        window = WINDOW_ROW.match(line)
        if window:
            block.time_window_seconds = int(window[1]) * 60
        if single is None:
            continue
        many = SETS_ROW.match(line)
        if many:
            single.sets = int(many[1])
            if many[2] and many[3].lower().startswith("rep"):
                single.reps_min = single.reps_max = int(many[2])
            elif many[2]:
                single.duration_seconds = _seconds(many[2], many[3])
            if "calorie" in many[4].lower() and "calorie" not in (single.effort or "").lower():
                single.effort = "For calories"
        between = REST_BETWEEN.match(line)
        if between and not line.lower().startswith("rest for"):
            single.rest_seconds = _seconds(between[1], between[2])
    if single is None or not listed:
        return
    percents = {}
    notes = "\n".join(part.notes)
    if re.search(r"\b1\s*RM\b", notes, re.I):
        for match in SET_PERCENT.finditer(notes):
            percents[int(match[1])] = RelativeLoad(basis="one_rep_max", percent=float(match[2]),
                                                   percent_max=float(match[3]) if match[3] else None)
    single.set_prescriptions = [SetPrescription(
        reps_min=int(m[2]) if m[2] else None,
        reps_max=int(m[3] or m[2]) if m[2] else None,
        max_reps=True if m[4] else None,
        relative_load=percents.get(int(m[1])),
    ) for m in listed]
    single.sets = len(listed)
    single.reps_min = single.reps_max = None
    single.rep_scheme = None


def _sex_loads(block, part, warnings):
    for run in part.runs + [run for item in part.items for run in item.runs]:
        text = "\n".join(run)
        found = SEX_LOAD.findall(text)
        if len(found) < 2:
            continue
        said = words(text)
        targets = [item for item in block.exercises if words(item.name) & said and LOADED.search(item.name)]
        targets = targets or [item for item in block.exercises if LOADED.search(item.name)]
        if len(targets) != 1:
            warnings.append(f"Load recommendations in {block.label} need a movement; review the source.")
            continue
        values = {float(number) for _, low, high, _ in found for number in (low, high) if number}
        for item in block.exercises:
            if item is not targets[0] and item.load_options and {option.load for option in item.load_options} <= values:
                item.load_options = None  # the recommendation, attached to the wrong movement
                warnings.append(f"Load recommendations were on {item.name}; they belong to {targets[0].name}.")
        targets[0].load = targets[0].load_unit = targets[0].load_convention = targets[0].relative_load = None
        targets[0].load_options = [LoadOption(load=float(low), load_max=float(high) if high else None,
                                              load_unit=unit.lower().rstrip("s"), label=sex.capitalize())
                                   for sex, low, high, unit in found[:4]]


def _summary(values):
    return ", ".join(values)


def legacy_fields(block, keep_new):
    """Older class clients read reps, durations and effort text. Always fill
    those from the listed rows, and drop the newer fields unless the client
    asked for them, so no build shows a fact it cannot read as something else."""
    for item in block.exercises:
        notes = []
        if item.set_prescriptions:
            fixed = [s for s in item.set_prescriptions if s.reps_min is not None]
            if fixed:
                item.reps_min = min(s.reps_min for s in fixed)
                item.reps_max = max(s.reps_max or s.reps_min for s in fixed)
            reps = [("max" if s.max_reps else f"{s.reps_min}" if s.reps_min == s.reps_max else f"{s.reps_min}-{s.reps_max}")
                    for s in item.set_prescriptions]
            notes.append(f"Sets: {_summary(reps)} reps")
            loads = [s.relative_load for s in item.set_prescriptions]
            if all(loads):
                notes.append("~" + _summary(f"{r.percent:g}" + (f"-{r.percent_max:g}" if r.percent_max else "") + "%"
                                            for r in loads) + " 1RM")
        for kind in ("duration_seconds", "height"):
            options = [o for o in item.value_options or [] if o.quantity == kind]
            if not options:
                continue
            unit = "s" if kind == "duration_seconds" else options[0].unit
            notes.append(("Box " if kind == "height" else "") + " / ".join(
                f"{o.value:g} {unit}" + (f" ({o.label})" if o.label else "") for o in options))
            if kind == "duration_seconds":
                low, high = min(o.value for o in options), max(o.value for o in options)
                item.duration_seconds, item.duration_seconds_max = int(low), (int(high) if high > low else None)
        if item.calories is not None:
            notes.append(f"{item.calories_min}-{item.calories} calories" if item.calories_min else f"{item.calories} calories")
        ranged = [o for o in item.load_options or [] if o.load_max is not None]
        if ranged:
            notes.append(" / ".join(f"{(o.label + ' ') if o.label else ''}{o.load:g}-{o.load_max:g} {o.load_unit}"
                                    for o in item.load_options))
        summary = "; ".join(note for note in notes if note.lower() not in (item.effort or "").lower())
        if summary:
            item.effort = "; ".join(filter(None, [item.effort, summary]))[:500]
        if not keep_new:
            item.set_prescriptions = item.value_options = item.calories = item.calories_min = None
            if ranged:
                item.load_options = None  # "Men 15 kg" would hide the range; the effort text keeps it
    if not keep_new and block.time_window_seconds:
        window = f"Within {block.time_window_seconds // 60} minutes"
        block.instructions = [window, *(block.instructions or [])][:20]
        block.time_window_seconds = None


BUY_IN = re.compile(r"^buy[ -]?in\s*:?$", re.I)
CASH_OUT = re.compile(r"^cash[ -]?out\s*:?$", re.I)
THEN = re.compile(r"^then\b.*:$", re.I)


def _segments(block, part, rows):
    """Rows between "Buy In:" and "Then AMRAP:" are the buy-in; rows after "Cash Out:" the cash-out."""
    if block.execution is None or block.execution.mode not in {"amrap", "for_time"}:
        return
    zone, zones = None, {}
    for line in part.rows:
        if BUY_IN.match(line):
            zone = "buy_in"
        elif CASH_OUT.match(line):
            zone = "cash_out"
        elif THEN.match(line):
            zone = None
        elif zone:
            zones.setdefault(line, zone)
    if not zones:
        return
    for item, row in zip(block.exercises, rows):
        item.segment = zones.get(row) if row else item.segment
    order = {"buy_in": 0, None: 1, "cash_out": 2}
    if [order[item.segment] for item in block.exercises] != sorted(order[item.segment] for item in block.exercises):
        for item in block.exercises:
            item.segment = None  # the import's order disagrees with the page; leave the structure for review


def enrich_part(block, part, context, warnings, keep_new=False):
    """Apply the part's printed rows to the block the import matched to it."""
    rows = _rows_for(block, part)
    _segments(block, part, rows)
    for item, row in zip(block.exercises, rows):
        if row:
            _enrich_from_row(item, row, context, warnings)
        unit = next((u for u in part.items if row and row in u.heading), None)
        if unit is not None:
            rest = next((REST_BETWEEN.match(line) for line in unit.rows if REST_BETWEEN.match(line)), None)
            if rest:
                item.rest_seconds = _seconds(rest[1], rest[2])
    _sets_from_rows(block, part)
    _sex_loads(block, part, warnings)
    after = next((REST_AFTER.search(line) for line in part.rows if REST_AFTER.search(line)), None)
    if after and block.rest_after_seconds is None:
        block.rest_after_seconds = int(after[1]) * 60
    legacy_fields(block, keep_new)

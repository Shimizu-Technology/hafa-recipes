"""Read a pasted class page's own layout: parts, listed sets and coach notes.

Class pages (WodUp and similar) print a fixed layout: lettered parts ("A.",
"C2."), "N alternating sets of:" groups, "Set 1 – 5 reps" rows and "- " coach
note lines. The model identifies movements; this layout decides where each
part starts, which notes belong to it and which rows it lists, so those facts
no longer change between model runs.
"""

import re
from dataclasses import dataclass, field

from app.domains.workouts.schemas import (
    Benchmark,
    EmomExecution,
    ExercisePrescription,
    ForTimeExecution,
    WorkoutBlock,
)

PART = re.compile(r"^([A-Z])\.\s+(\S.*)$")
ITEM = re.compile(r"^([A-Z])(\d{1,2})\.\s+(\S.*)$")
GROUP = re.compile(r"^\d+\s+alternating sets\b.*:$", re.I)
SECTION = re.compile(r"^(accessor(?:y|ies)|warm[- ]?up|cool[- ]?down)\s*:?$", re.I)
PREP = re.compile(r"^workout specific movement prep$", re.I)
NOTE = re.compile(r"^-\s+\S")
REST_ROW = re.compile(r"^-*\s*rest\b", re.I)
# Training words every part shares; they cannot tie a note to one part.
COMMON = set("""every minute minutes min mins for with sets set reps rep rounds round rest seconds secs the and
max between alternating within tempo calories cals meters distance perform your you this that part week
should each into from than more less after before then them their can are not all its our we per side sides
load loads time times hard easy pace effort rpe rir build""".split())


@dataclass
class Unit:
    key: str
    heading: str
    rows: list[str] = field(default_factory=list)
    runs: list[list[str]] = field(default_factory=list)  # coach-note runs after the rows

    @property
    def notes(self):
        return [note for run in self.runs for note in run]


@dataclass
class Part(Unit):
    section: str | None = None
    items: list[Unit] = field(default_factory=list)
    had_leading: bool = False

    def text(self):
        units = [self, *self.items]
        return "\n".join([self.section or "", *(line for unit in units for line in [unit.heading, *unit.rows])])

    def label(self, names=()):
        """The printed heading, or "C. ACCESSORIES" / "A. Woodchops / Side Plank" for a group."""
        if PART.match(self.heading):
            return self.heading.rstrip(":").strip()[:200]
        return f"{self.key}. {self.section or ' / '.join(names)}".strip()[:200]


@dataclass
class Outline:
    intro: list[str] = field(default_factory=list)
    parts: list[Part] = field(default_factory=list)
    prep: bool = False


def words(text):
    """Comparable name words: "Presses"/"Press" and "Bars"/"Bar" match."""
    return {word[:5] if len(word) >= 5 else word.rstrip("s")
            for word in re.findall(r"[a-z]{3,}", text.lower()) if word not in COMMON}


def note_text(line):
    return re.sub(r"^-\s+", "", line.strip())


def read_outline(text: str) -> Outline:
    outline = Outline()
    part = target = None
    group = section = None
    leading: list[list[str]] = []
    in_notes = new_run = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            new_run = True
            continue
        if PREP.match(line):
            outline.prep = True
            continue
        item, heading = ITEM.match(line), PART.match(line)
        if GROUP.match(line):
            group, in_notes = line, False
            continue
        if SECTION.match(line):
            section, in_notes = line, False
            continue
        if item or heading:
            key = (item or heading)[1]
            if heading or part is None or part.key != key:
                part = Part(key, line if heading else group or line, section=section)
                # Notes before the first part introduce the day.
                part.had_leading = bool(leading)
                outline.intro += [note for run in leading for note in run]
                outline.parts.append(part)
                group = section = None
                leading = []
            target = part
            if item:
                target = Unit(item[1] + item[2], line)
                part.items.append(target)
            in_notes = new_run = False
            continue
        if NOTE.match(line) or (in_notes and target is not None and not REST_ROW.match(line)):
            runs = leading if target is None else target.runs
            if NOTE.match(line) and (new_run or not in_notes or not runs):
                runs.append([note_text(line)])
            elif NOTE.match(line):
                runs[-1].append(note_text(line))
            else:
                runs[-1][-1] += "\n" + line  # "- REP RANGES" / "10-15 toes to bar"
            in_notes, new_run = True, False
            continue
        if target is not None:
            target.rows.append(line)
        in_notes = new_run = False
    _assign_trailing_notes(outline.parts)
    return outline


def _assign_trailing_notes(parts):
    """Notes printed between two parts describe the earlier part unless they
    name only the later one; a part introduced by notes passes later notes on."""
    for index, part in enumerate(parts[:-1]):
        last = part.items[-1] if part.items else part
        following = parts[index + 1]
        own, other = words(part.text()), words(following.text())
        heading = words(f"{following.section or ''} {following.heading}")
        for start, run in enumerate(last.runs):
            said = words(" ".join(run))
            mine, shared = said & own, said & other
            # One shared word ("pull") is too weak; two, or the next heading's name, is not.
            theirs = (len(shared) >= 2 or bool(shared & heading)) and len(shared) > len(mine)
            if theirs or (not mine and not shared and part.had_leading):
                moved, last.runs = last.runs[start:], last.runs[:start]
                following.runs = moved + following.runs
                following.had_leading = True
                break
    for part in parts:
        # Notes after a group's last item that name its other items describe the whole group.
        if len(part.items) > 1:
            last, others = part.items[-1], part.items[:-1]
            other_words = words(" ".join(line for unit in others for line in [unit.heading, *unit.rows]))
            keep = [run for run in last.runs if not words(" ".join(run)) & other_words]
            part.runs += [run for run in last.runs if run not in keep]
            last.runs = keep


def _same_note(a, b):
    a, b = " ".join(a.lower().split()), " ".join(b.lower().split())
    return a == b or (len(a) > 12 and a in b) or (len(b) > 12 and b in a)


def _merge_notes(placed, model, outline_notes):
    """Outline notes in source order, then any other quoted model notes."""
    kept = [note for note in model or [] if not any(_same_note(note, other) for other in outline_notes)]
    notes = list(placed) + kept
    if len(notes) > 20:
        notes = notes[:19] + ["\n".join(notes[19:])[:2000]]
    return notes or None


def _home(item, parts):
    """The one part whose rows name this movement, if exactly one does."""
    name = words(item.name)
    found = [part for part in parts if name and name <= words(part.text())]
    return found[0] if len(found) == 1 else None


def _part_for(block, parts):
    """A block's part, after moving out movements that only another part lists."""
    homes = [_home(item, parts) for item in block.exercises]
    counts = {id(part): sum(home is part for home in homes) for part in parts}
    lettered = next((part for part in parts if re.match(rf"\s*{part.key}(?:\d|\b)", block.label)
                     and not re.search(r"movement prep", block.label, re.I)), None)
    if lettered is not None and (counts[id(lettered)] or not any(counts.values())):
        part = lettered
    else:
        part = max(parts, key=lambda candidate: counts[id(candidate)])
        part = part if counts[id(part)] else None
    if part is not None:
        block.exercises = [item for item, home in zip(block.exercises, homes) if home is None or home is part]
    return part


FORMAT_ROW = re.compile(r"^(?:every\b|emom\b|amrap\b|as many rounds|for time\b|minutes?\s+\d|within\s+\d|set\s+\d|\d+\s+sets\s+of|"
                        r"rest\b|buy[ -]?in\b|then\s+amrap|cash[ -]?out\b|-+\s*rest\b|no rest\b|time\s*cap\b)", re.I)


def _movement_name(row):
    name = re.sub(r"^(?:\d+(?:\s*[-–]\s*\d+)?\s+|max\s+)", "", row, flags=re.I)
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name)
    name = re.split(r"\s+(?:for\s+\d|for\s+max|@|\d+(?:\.\d+)?\s*/\s*\d|\d+(?:\s*[-–]\s*\d+)?\s*(?:cal|calories|meters?|m)\b|max\s+\w+$)", name, flags=re.I)[0]
    return name.strip(" :-")[:200]


MINUTE_ROW = re.compile(r"^min(?:ute)?s?\s*\d+(?:\s*[-–]\s*\d+)?\s*:?$", re.I)


def _mixed_minutes(part):
    """Minute 1: two movements, Minute 2: rest cannot rotate one movement per minute."""
    counts, current = [], None
    for line in part.rows:
        if MINUTE_ROW.match(line):
            current = 0
            counts.append(current)
        elif counts and not REST_ROW.match(line):
            counts[-1] += 1
    return any(count > 1 for count in counts)


def _part_from_rows(part, text_location):
    """A part the import left out, read from its own source rows."""
    from app.domains.workouts.formats import read_format
    from app.domains.workouts.schemas import Evidence

    rows = [re.sub(r"^[A-Z]\d*\.\s+", "", unit.heading) for unit in part.items] if part.items else [
        line for line in ([part.heading[3:]] if PART.match(part.heading) else []) + part.rows]
    exercises = []
    for row in rows:
        if FORMAT_ROW.match(row) or SECTION.match(row) or not re.search(r"[A-Za-z]{3}", row):
            continue
        name = _movement_name(row)
        if not words(name):
            continue
        exercises.append(ExercisePrescription(name=name, provenance="source", evidence=[
            Evidence(field="name", wording=row, location=text_location)]))
    block = WorkoutBlock(id=f"part-{part.key.lower()}", label=part.label([item.name for item in exercises]), exercises=exercises,
                         grouping="superset" if part.items else "sequential")
    group = re.match(r"^(\d+)\s+alternating sets", part.heading, re.I)
    if group:
        block.rounds = int(group[1])
    timed = re.search(r"\b(\d+)\s+rounds?\s+for\s+time\b", part.heading, re.I)
    cap = next((re.search(r"time\s*cap\s*:?\s*(\d+)\s*(?:minutes?|mins?)", line, re.I) for line in part.rows
                if re.search(r"time\s*cap\s*:?\s*\d", line, re.I)), None)
    if timed and exercises:
        block.execution = ForTimeExecution(mode="for_time", time_cap_seconds=int(cap[1]) * 60 if cap else None)
        block.rounds, block.grouping = int(timed[1]), "circuit"
        block.evidence = [Evidence(field="execution.mode", wording=part.heading[3:], location=text_location)]
    format_line = next((line for line in [part.heading, *part.rows] if re.search(r"\bevery\b", line, re.I)), None)
    if format_line and exercises:
        facts, conflict = read_format("emom", [re.sub(r"^[A-Z]\.\s+", "", format_line)], part.rows, len(exercises))
        if facts and facts.get("intervals") and not conflict:
            block.execution = EmomExecution(mode="emom", interval_seconds=facts["interval_seconds"],
                                            intervals=facts["intervals"], rotation=facts.get("rotation"))
            block.grouping = "interval"
            block.evidence = [Evidence(field=field_name, wording=format_line, location=text_location)
                              for field_name in ("execution.mode", "execution.interval_seconds", "execution.intervals")]
    return WorkoutBlock.model_validate(block.model_dump())


def _unit_for(item, part):
    name = words(item.name)
    return next((unit for unit in part.items if name and name <= words(unit.heading)), None)


def apply_outline(workout, text, warnings):
    """Use the page layout for part boundaries, labels, notes and listed rows."""
    outline = read_outline(text)
    if not outline.parts:
        return
    outline_notes = outline.intro + [n for p in outline.parts for u in [p, *p.items] for n in u.notes]
    kept, matched = [], {}
    for block in workout.blocks:
        part = _part_for(block, outline.parts)
        if not block.exercises:
            continue  # "Workout Specific Movement Prep" is a link, never a part.
        printed = words("\n".join(p.text() for p in outline.parts))
        if part is None and not any(words(item.name) & printed for item in block.exercises):
            warnings.append(f"{block.label[:60]} is not a part of the page; it was removed.")
            continue  # e.g. "Zone 2 Aerobic Conditioning" made from a coach note
        if part is not None and id(part) in matched:
            matched[id(part)].exercises += block.exercises  # One printed part is one block (E1 and E2 split apart).
            continue
        kept.append(block)
        if part is not None:
            matched[id(part)] = block
    location = next(iter({entry.location for block in kept for item in block.exercises for entry in item.evidence
                          if entry.location and not entry.location.startswith("image:")}), "provided_text")
    for part in outline.parts:
        if id(part) not in matched:
            rebuilt = _part_from_rows(part, location)
            if rebuilt.exercises:
                matched[id(part)] = rebuilt
                kept.append(rebuilt)
                warnings.append(f"Part {rebuilt.label[:60]} was read from the page layout because the import left it out; review it.")
    order = {id(block): index for index, block in enumerate(kept)}
    position = {id(matched[id(p)]): i for i, p in enumerate(outline.parts) if id(p) in matched}
    kept.sort(key=lambda block: (position.get(id(block), len(outline.parts)), order[id(block)]))
    for part in outline.parts:
        block = matched.get(id(part))
        if block is None:
            warnings.append(f"Part {part.label()[:60]} from the source was not imported; review the source.")
            continue
        if not re.match(rf"\s*{part.key}(?:\d|\b)", block.label) or re.search(r"movement prep", block.label, re.I):
            block.label = part.label([item.name for item in block.exercises])
        if re.search(r"active recovery|cool[- ]?down", "\n".join([part.heading, *part.rows]), re.I):
            block.role, block.score_kind = "cool_down", "none"  # "Active Recovery Bike Erg", even under ACCESSORIES
        elif re.search(r"accessor", f"{part.section or ''} {part.heading}", re.I) and block.role in {None, "main"}:
            block.role = "accessory"
        group = re.match(r"^(\d+)\s+alternating sets\b", part.heading, re.I)
        if group and len(block.exercises) > 1 and block.execution is None:
            block.grouping, block.rounds = "superset", int(group[1])  # The page prints the round count.
        if outline_notes:
            block.instructions = _merge_notes(part.notes, block.instructions, outline_notes)
        for item in block.exercises:
            unit = _unit_for(item, part)
            if outline_notes and (unit is not None or item.instructions):
                notes = _merge_notes(unit.notes if unit else [], [item.instructions] if item.instructions else [], outline_notes)
                item.instructions = "\n".join(notes)[:2000] if notes else None
        if block.execution is not None and block.execution.mode == "emom" and _mixed_minutes(part):
            block.execution = block.execution.model_copy(update={"rotation": None})
            warnings.append(f"{block.label}: each minute lists a different group of movements; check the minute order.")
    if kept and kept[-1].rest_after_seconds is not None:
        kept[-1].rest_after_seconds = None
    if outline_notes:
        workout.instructions = _merge_notes(outline.intro, workout.instructions, outline_notes) or []
    workout.blocks = [WorkoutBlock.model_validate(block.model_dump()) for block in kept]
    for block in workout.blocks:
        block.exercises = [ExercisePrescription.model_validate(item.model_dump()) for item in block.exercises]
    _benchmark(workout, outline)
    if workout.benchmark:
        ids = {block.id for block in workout.blocks}
        workout.benchmark.block_ids = [value for value in workout.benchmark.block_ids if value in ids]


BENCHMARK_NOTE = re.compile(r"\bprogression\s+(\d+)\s*/\s*(\d+)\s+for\s+(?:our|the)\s+benchmark(?:\s+(?:workout|wod|test))?\s*,?\s*[\"“'‘]([^\"”'’\n]{1,80})[\"”'’]", re.I)


def _benchmark(workout, outline):
    """'This is progression 2/3 for our benchmark workout, "Everest"' names the benchmark."""
    if workout.benchmark is not None:
        return
    for note in outline.intro + [n for p in outline.parts for n in p.notes]:
        found = BENCHMARK_NOTE.search(note)
        if found and int(found[1]) <= int(found[2]):
            key = re.sub(r"[^a-z0-9]+", "-", found[3].lower()).strip("-")[:60] or "benchmark"
            workout.benchmark = Benchmark(key=key, name=found[3].strip(), stage=int(found[1]), stages=int(found[2]))
            return


STALE = (re.compile(r"^Unsupported (\w+|relative load) removed from (.+)\.$"), re.compile(r"^Unsupported role for (.+) removed\.$"),
         re.compile(r"^Unquoted coach notes removed from (.+)\.$"), re.compile(r"^(?:Exercise name|Per-side details for) (.+?) "))


def stale_warnings(workout, warnings, notes_placed):
    """Drop review warnings about values the layout restored or parts it removed."""
    blocks = {block.label: block for block in workout.blocks}
    items = {item.name: item for block in workout.blocks for item in block.exercises}
    kept = []
    for warning in warnings:
        field_match, role, notes, named = (pattern.match(warning) for pattern in STALE)
        if field_match and field_match[2] in items:
            item = items[field_match[2]]
            if getattr(item, field_match[1].replace("relative load", "relative_load"), None) not in (None, []):
                continue
            if getattr(item, "set_prescriptions", None) and field_match[1] in {"reps_min", "reps_max", "rep_scheme", "sets", "effort"}:
                continue  # The listed sets carry the reps and the AMRAP set.
            if getattr(item, "value_options", None) and field_match[1] in {"duration_seconds", "load_options"}:
                continue
        elif field_match and field_match[2] not in blocks:
            continue
        elif role and (role[1] not in blocks or blocks[role[1]].role is not None):
            continue
        elif notes and notes_placed:
            continue
        elif named and named[1] not in items:
            continue
        if warning not in kept:
            kept.append(warning)
    return kept

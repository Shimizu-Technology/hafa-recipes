"""Deterministic reading of quoted workout-format wording.

The extraction model proposes a typed format; these readers accept only what the
quoted source states. A value the source does not state stays None, except the
interval and work/rest lengths implied by the format name itself (EMOM/OTM is
every 60 seconds, E2MOM every 120 seconds, Tabata is 8 x 20 s on / 10 s off).
"""

import re

NEGATION = r"\b(?:not|never|no|without|instead\s+of|rather\s+than|isn['’]t|don['’]t)\b"
UNIT = r"(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s\b|minutes?|mins?|min\b|m\b)"
CLAUSE = r"[;,\n]|[.!?](?:\s|$)"
# A bare number after these tokens is minutes: AMRAP 15, EMOM 20, cap 20, TC 20.
BARE_MINUTES = r"amrap|emom|otm|e\d+mom|time\s*cap|cap|tc"
EMOM = (r"\be(\d+)mom\b|\b(?:emom|otm)\b|\bevery\s+minute(?:\s+on\s+the\s+minute)?\b"
        rf"|\bevery\s+{UNIT}|\bdeath\s+by\b")
FOR_TIME = r"\bfor\s+time\b|\brft\b|\bchipper\b"
FT = r"(?<!\d)(?<!\d\s)\bFT\b"  # Upper case only; "10 ft" is a distance.
WORK_REST = (r"\btabata\b|\d+\s*(?:s|secs?|seconds?)?\s*(?:on|work)\b"
             r"|(?<![\w.])\d+\s*[x×]\s*:?\d+\s*(?:s|secs?)?\s*/\s*:?\d+")
ALTERNATING = r"\balt(?:ernating|ernate)?\b|\bodd\b[^.;\n]{0,40}\beven\b|\bmin(?:ute)?\s*1\b|\bM1\b"
SCHEME = r"(?<![\d.:/])\d{1,4}(?:\s*[-–]\s*\d{1,4}){2,}(?![\d.:/])"


def affirmative(prefix: str) -> bool:
    """A negated mode or duration ("not an EMOM") never grounds a format."""
    local = re.split(CLAUSE, prefix)[-1]
    return not re.search(NEGATION, local, re.I)


def seconds(amount: str, unit: str) -> float:
    return float(amount) * (60 if unit.lower().startswith("m") else 1)


def clock_wording(text: str) -> str:
    """Read 15:00, 15' and a bare format number as explicit minutes."""
    text = re.sub(
        r"(?<![\d:])(\d{1,3}):([0-5]\d)(?![\d:])",
        lambda m: f"{int(m[1])} minutes" if m[2] == "00" else f"{int(m[1]) * 60 + int(m[2])} seconds",
        text,
    )
    text = re.sub(r"(?<![\d.])(\d+)\s*['’′](?![\w'’])", r"\1 minutes", text)
    return re.sub(
        rf"\b({BARE_MINUTES})(\s*(?:of|for|in|is|at|:|=|-)?\s*\(?\s*)(\d+)(?=\s*(?:$|[^\w\s%]|(?:alternating|alt)\b))",
        r"\1\2\3 minutes", text, flags=re.I,
    )


def _clauses(quotes, boundary=CLAUSE):
    for quote in quotes:
        yield from (clause for clause in re.split(boundary, clock_wording(quote)) if clause.strip())


def _affirmative_matches(pattern, clause, flags=re.I):
    return [match for match in re.finditer(pattern, clause, flags)
            if affirmative(clause[:match.start()])]


def _emom(clause):
    tokens = _affirmative_matches(EMOM, clause)
    if not tokens:
        return None
    token = tokens[0]
    facts = {"interval_seconds": 60, "death_by": bool(re.match(r"death", token[0], re.I))}
    if token[1]:
        facts["interval_seconds"] = int(token[1]) * 60
    elif token[2]:
        facts["interval_seconds"] = round(seconds(token[2], token[3]))
    after = clause[token.end():]
    count = re.search(r"^\s*(?:for\s+)?[x×]\s*(\d+)\b(?!\s*(?:reps?|/))"
                      r"|\b(?:for\s+)?(\d+)\s*(?:rounds?|sets?|intervals?)\b", after, re.I)
    total = None
    for match in re.finditer(UNIT, clause, re.I):
        before, following = clause[:match.start()], clause[match.end():]
        bound = (match.start() >= token.end() and re.fullmatch(
            r"\s*(?:for|of|in|:|-|–)?\s*\(?\s*", clause[token.end():match.start()], re.I)
            or re.match(r"\s*(?:long\s+)?(?:alternating\s+)?(?:e\d*mom|otm|every)\b", following, re.I)
            or re.search(r"\bfor\s*$", before, re.I))
        labelled = re.match(r"\s*\(?\s*(?:on|off|work|rest|hold)\b", following, re.I)
        if bound and not labelled and affirmative(before):
            total = round(seconds(match[1], match[2]))
            if total > facts["interval_seconds"]:
                break
            total = None
    if total:
        facts["total_seconds"] = total
        if total % facts["interval_seconds"] == 0:
            facts["intervals"] = total // facts["interval_seconds"]
    if count:
        # "E3MOM for 15 minutes (5 sets)" must agree with its own clock.
        if total and int(count[1] or count[2]) * facts["interval_seconds"] != total:
            facts["conflict"] = True
        facts["intervals"] = int(count[1] or count[2])
    return facts


def _for_time(clause):
    if not (_affirmative_matches(FOR_TIME, clause) or _affirmative_matches(FT, clause, 0)):
        return None
    facts = {}
    rounds = re.search(r"\b(\d+)\s*(?:rft\b|rounds?\s+for\s+time\b)", clause, re.I)
    if rounds:
        facts["rounds"] = int(rounds[1])
    if re.search(r"\bchipper\b", clause, re.I):
        facts["single_pass"] = True
    cap = re.search(rf"\b(?:time\s*cap|cap(?:ped)?(?:\s+at)?|tc)\s*(?:of|is|at|:|=|-)?\s*\(?\s*{UNIT}", clause, re.I)
    if cap and affirmative(clause[:cap.start()]):
        facts["time_cap_seconds"] = round(seconds(cap[1], cap[2]))
    return facts


def _cap(clause):
    cap = re.search(rf"\b(?:time\s*cap|cap(?:ped)?(?:\s+at)?|tc)\s*(?:of|is|at|:|=|-)?\s*\(?\s*{UNIT}", clause, re.I)
    return round(seconds(cap[1], cap[2])) if cap and affirmative(clause[:cap.start()]) else None


def _work_rest(clause):
    if not _affirmative_matches(WORK_REST, clause):
        return None
    facts = {}
    if re.search(r"\btabata\b", clause, re.I):
        facts.update(work_seconds=20, rest_seconds=10, intervals=8, tabata=True)
    dose = r"(\d+(?:\.\d+)?)\s*(seconds?|secs?|s\b|minutes?|mins?|min\b|m\b)?"
    pair = (re.search(rf"\b{dose}\s*(?:on|work)\b\s*[/,&]?\s*(?:and\s+)?{dose}\s*(?:off|rest)\b", clause, re.I)
            or re.search(rf"(?:\btabata\b|[x×])\s*:?{dose}\s*/\s*:?{dose}(?!\s*(?:reps?|kg|lbs?)\b)", clause, re.I))
    if pair:
        facts["work_seconds"] = round(seconds(pair[1], pair[2] or "s"))
        facts["rest_seconds"] = round(seconds(pair[3], pair[4] or "s"))
    count = (re.search(r"(?<![\w.])(\d+)\s*[x×]\s*:?\d", clause)
             or re.search(r"(?:[x×]|\bfor)\s*(\d+)\b(?!\s*(?:s\b|secs?|seconds?|minutes?|mins?|/))", clause, re.I)
             or re.search(r"\b(\d+)\s*(?:rounds?|intervals?|sets?)\b", clause, re.I))
    if count:
        facts["intervals"] = int(count[1])
    elif "work_seconds" in facts:
        total = re.search(rf"(?:\btabata\b|\bfor)\s*{UNIT}", clause, re.I)
        cycle = facts["work_seconds"] + facts["rest_seconds"]
        if total and cycle and round(seconds(total[1], total[2])) % cycle == 0:
            facts["intervals"] = round(seconds(total[1], total[2])) // cycle
    return facts if "work_seconds" in facts else None


READERS = {"emom": _emom, "for_time": _for_time, "work_rest": _work_rest}


def read_format(mode: str, quotes, rows=()) -> tuple[dict | None, bool]:
    """Merge one mode's facts across quotes; the flag reports conflicting values."""
    merged, conflict = None, False
    # "40s work, 20s rest" is one work/rest pair across a comma.
    clauses = list(_clauses(quotes, r"[;\n]|[.!?](?:\s|$)" if mode == "work_rest" else CLAUSE))
    for clause in clauses:
        facts = READERS[mode](clause)
        if facts is None:
            continue
        merged = merged or {}
        conflict |= facts.pop("conflict", False)
        for key, value in facts.items():
            if key in merged and merged[key] != value:
                conflict = True
            merged.setdefault(key, value)
    if merged is not None and mode == "for_time" and "time_cap_seconds" not in merged:
        # Captions often put the cap on its own line: "For time" / "Cap: 20".
        caps = {cap for cap in map(_cap, clauses) if cap}
        if len(caps) == 1:
            merged["time_cap_seconds"] = caps.pop()
        conflict |= len(caps) > 1
    if merged is not None and mode == "emom" and any(
            re.search(ALTERNATING, quote, re.I) for quote in [*quotes, *rows]):
        merged["rotation"] = "alternating"
    return merged, conflict


def rep_schemes(wording: str) -> list[list[int]]:
    """21-15-9 style reps per round; two numbers stay an ordinary rep range."""
    return [[int(number) for number in re.split(r"\s*[-–]\s*", match[0])]
            for match in re.finditer(SCHEME, wording)
            if not re.search(r"\btempo\s*[:=]?\s*\(?\s*$", wording[:match.start()], re.I)]


def ladders(wording: str) -> list[dict]:
    """Death by X is an open ladder from 1; 'ladder 1-10' or '10-1 ladder' is closed."""
    found = []
    for match in _affirmative_matches(r"\bdeath\s+by\b", wording):
        found.append({"start": 1, "step": 1, "end": None})
    for clause in re.split(CLAUSE, wording):
        if not any(affirmative(clause[:m.start()]) for m in re.finditer(r"\bladder\b", clause, re.I)):
            continue
        for match in re.finditer(r"(?<![\d.:/-])(\d{1,4})\s*[-–]\s*(\d{1,4})(?![\d.:/]|\s*[-–]\s*\d)", clause):
            start, end = int(match[1]), int(match[2])
            by = re.search(r"\bby\s+(\d+)s?\b|\b(?:add|adding|increase|increasing)\s+(\d+)\b", clause, re.I)
            step = int(by[1] or by[2]) if by else 1
            if start != end and abs(end - start) % step == 0:
                found.append({"start": start, "step": step if end > start else -step, "end": end})
    return found


def scheme_wording(wording: str) -> str:
    """Remove rep schemes and ladder ranges before reading an ordinary rep range."""
    wording = re.sub(SCHEME, " ", wording)
    return " ".join(clause for clause in re.split(CLAUSE, wording)
                    if not re.search(r"\bladder\b", clause, re.I))

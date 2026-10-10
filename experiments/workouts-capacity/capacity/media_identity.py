"""Phase-specific canonical identities for cold synthetic video acquisition."""

import re

PHASE_CODES = {"baseline": "B", "mixed": "M", "diagnostic": "D"}


def video_url(phase, index):
    if phase not in PHASE_CODES or type(index) is not int or not 0 <= index < 100:
        raise ValueError("Bounded explicit synthetic media identity required")
    # All eleven characters belong to the YouTube identity, not a tracking query.
    return f"https://www.youtube.com/watch?v=capacity{PHASE_CODES[phase]}{index:02d}"


def is_fixture_url(url):
    return bool(
        re.fullmatch(r"https://www\.youtube\.com/watch\?v=capacity[BMD]\d{2}", url)
    )

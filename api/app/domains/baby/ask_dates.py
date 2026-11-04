"""Date words in a question select dates in the parent's timezone; they are never searched for."""

import re
from datetime import UTC, date, datetime, time, timedelta
from typing import NamedTuple

NUMBERS = dict(zip("one two three four five six seven eight nine ten".split(), range(1, 11), strict=True))
WEEKDAYS = "monday tuesday wednesday thursday friday saturday sunday".split()
MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split()
COUNT = r"\d{1,3}|" + "|".join(NUMBERS)
DATE_PHRASE = re.compile(
    r"(?<![\w-])(?:"
    r"(?P<before>(?:the\s+)?day\s+before\s+yesterday)|(?P<yesterday>yesterday)|(?P<today>today)"
    r"|(?P<tonight>tonight)|(?P<last_night>last\s+night)"
    r"|this\s+(?P<part>morning|afternoon|evening)"
    r"|(?P<which>this|last)\s+(?P<period>week|month)"
    r"|(?:past|last|previous)\s+(?P<rolling>week|month|day)"
    rf"|(?:past|last|previous)\s+(?P<count>{COUNT})\s+(?P<unit>hour|day|week)s?"
    rf"|(?P<ago>{COUNT})\s+days?\s+ago"
    r"|(?:on|last|this\s+past)\s+(?P<weekday>" + "|".join(WEEKDAYS) + r")"
    r"|(?P<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?"
    # A bare 3/4 is more often a fraction of an ounce than March 4.
    r"|on\s+(?P<numeric_month>\d{1,2})/(?P<numeric_day>\d{1,2})"
    r"|(?P<iso>\d{4}-\d{2}-\d{2})"
    r")(?![\w-])",
    re.IGNORECASE,
)


# A title in quotes names a saved entry; its words are not dates ("Start tummy time today").
QUOTED = re.compile(r'"[^"]*"|“[^”]*”|‘[^’]*’')


class DateWindow(NamedTuple):
    """A half-open range: ``start`` is included and ``end`` is not."""

    label: str
    start: datetime
    end: datetime


def number(text):
    return NUMBERS.get(text.lower()) or int(text)


def past_date(month, day, today):
    """The most recent such date; a question about records looks backward."""
    try:
        moment = date(today.year, month, day)
        return moment if moment <= today else date(today.year - 1, month, day)
    except ValueError:
        return None


def elapsed_before(moment, delta):
    """Real elapsed time back from now, so a clock change cannot stretch a rolling window."""
    return (moment.astimezone(UTC) - delta).astimezone(moment.tzinfo)


def phrase_range(match, local_now):
    """The (start, end) a matched phrase means, or None for an impossible date like Feb 31."""
    zone, today = local_now.tzinfo, local_now.date()

    def at(day, hour=0):
        return datetime.combine(day, time(hour), tzinfo=zone)

    def whole(day, days=1):
        return at(day), at(day + timedelta(days=days))

    found = match.groupdict()
    if found["today"]:
        return whole(today)
    if found["yesterday"]:
        return whole(today - timedelta(days=1))
    if found["before"]:
        return whole(today - timedelta(days=2))
    if found["last_night"]:
        return at(today - timedelta(days=1), 18), at(today, 8)
    if found["tonight"]:
        # In the small hours "tonight" is the night already under way.
        evening = today - timedelta(days=1) if local_now.hour < 8 else today
        return at(evening, 18), at(evening + timedelta(days=1), 8)
    if found["part"]:
        start, end = {"morning": (0, 12), "afternoon": (12, 17), "evening": (17, 24)}[found["part"].lower()]
        return at(today, start), at(today, end) if end < 24 else at(today + timedelta(days=1))
    if found["period"]:
        back = found["which"].lower() == "last"
        if found["period"].lower() == "week":
            # Weeks start on Sunday, as the US calendars this family uses do.
            start = today - timedelta(days=(today.weekday() + 1) % 7 + (7 if back else 0))
            return whole(start, 7)
        first = today.replace(day=1)
        if back:
            first = (first - timedelta(days=1)).replace(day=1)
        return at(first), at((first + timedelta(days=32)).replace(day=1))
    if found["rolling"]:
        days = {"day": 1, "week": 7, "month": 30}[found["rolling"].lower()]
        return elapsed_before(local_now, timedelta(days=days)), local_now
    if found["count"]:
        hours = {"hour": 1, "day": 24, "week": 168}[found["unit"].lower()]
        return elapsed_before(local_now, timedelta(hours=number(found["count"]) * hours)), local_now
    if found["ago"]:
        return whole(today - timedelta(days=number(found["ago"])))
    if found["weekday"]:
        # "On Monday" asked on a Monday means the one before; today has its own word.
        back = (today.weekday() - WEEKDAYS.index(found["weekday"].lower())) % 7 or 7
        return whole(today - timedelta(days=back))
    if found["month"]:
        day = past_date(MONTHS.index(found["month"][:3].lower()) + 1, int(found["day"]), today)
    elif found["numeric_month"]:
        day = past_date(int(found["numeric_month"]), int(found["numeric_day"]), today)
    else:
        try:
            day = date.fromisoformat(found["iso"])
        except ValueError:
            day = None
    return whole(day) if day else None


def date_window(message, local_now):
    """The dates a question asks about, spanning all of them when it names several."""
    found = []
    for match in DATE_PHRASE.finditer(QUOTED.sub(" ", message)):
        span = phrase_range(match, local_now)
        if span:
            found.append((" ".join(match[0].lower().split()), *span))
    if not found:
        return None
    return DateWindow(
        " and ".join(dict.fromkeys(label for label, _, _ in found)),
        min(start for _, start, _ in found),
        max(end for _, _, end in found),
    )


def without_dates(message):
    """Search words, keeping quoted titles whole."""
    parts, last = [], 0
    for quoted in QUOTED.finditer(message):
        parts += [DATE_PHRASE.sub(" ", message[last : quoted.start()]), quoted[0].strip("\"“”‘’")]
        last = quoted.end()
    return " ".join([*parts, DATE_PHRASE.sub(" ", message[last:])])

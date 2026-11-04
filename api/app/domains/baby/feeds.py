"""One reducer for a feed's actions. No database or clock, so the app can mirror it exactly.

The result depends only on the set of actions, never on the order they arrived. Order is
``(at, id)``, with ``at`` compared as an instant and ``id`` as its lowercase UUID text.
"""

from datetime import UTC, datetime

MAX_DURATION_MINUTES = 1440  # FeedingData's bound; longer cannot be one feed.


def instant(value):
    return datetime.fromisoformat(value).astimezone(UTC)


def ordered(actions):
    return sorted(actions, key=lambda item: (instant(item["at"]), str(item["id"])))


def reduce_feed(actions):
    """What a feed's actions add up to: the earliest finish ends it, and later actions do nothing.

    A switch before the finish applies even if it arrived after it. The first action naming a
    side opens the first segment, so phones whose clocks differ still give one result.
    """
    actions = ordered(actions)
    finish = next((item for item in actions if item["action"] == "finish"), None)
    applied = actions[: actions.index(finish)] if finish else actions
    segments = []
    for item in applied:
        if segments and segments[-1]["side"] == item["side"]:
            continue
        if segments:
            segments[-1]["ended_at"] = item["at"]
        segments.append({"side": item["side"], "started_at": item["at"], "ended_at": None})
    if segments and finish:
        segments[-1]["ended_at"] = finish["at"]
    start = next((item for item in actions if item["action"] == "start"), None)
    first = segments[0] if segments else None
    sides = {segment["side"] for segment in segments}
    duration = None
    if finish and segments:
        seconds = (instant(finish["at"]) - instant(segments[0]["started_at"])).total_seconds()
        duration = round(seconds / 60, 2)
        if duration > MAX_DURATION_MINUTES:
            duration = None
    return {
        "finished": finish is not None,
        "segments": segments,
        "side": "both" if len(sides) > 1 else next(iter(sides), None),
        "started_at": start["at"] if start else first and first["started_at"],
        "started_side": start["side"] if start else first and first["side"],
        "end_at": finish["at"] if finish else None,
        "duration_minutes": duration,
    }


def with_derived(data):
    """Stored feed data with its actions in order and every derived field from them.

    A feed with no finish stays as it was between running and ``unknown_end``: which of those
    it is depends on the child's other feeds, which the caller settles after this.
    """
    result = reduce_feed(data["actions"])
    state = data.get("state") if data.get("state") == "unknown_end" else "running"
    derived = {
        **data,
        "actions": ordered(data["actions"]),
        "state": "finished" if result["finished"] else state,
        # Never the side stored before: that would depend on the order the taps arrived in.
        "side": result["side"] or result["started_side"],
        "duration_minutes": result["duration_minutes"],
    }
    derived.pop("end_at", None)
    if result["end_at"]:
        derived["end_at"] = result["end_at"]
    return derived


def retimed(actions, at):
    """Move a feed's start when a parent corrects its time; the other tap times are untouched."""
    actions = ordered(actions)
    named = [item for item in actions if item["action"] == "start"] or [
        item for item in actions if item["action"] == "switch"
    ]
    # Clients resend the time with every edit; an unchanged one rewrites nothing.
    if not named or instant(named[0]["at"]) == instant(at):
        return actions
    return [{**item, "at": at} if item is named[0] else item for item in actions]


def same_action(stored, incoming):
    """The same tap retried, whatever offset its time was written in."""
    return (
        stored["action"] == incoming["action"]
        and stored.get("side") == incoming.get("side")
        and stored.get("target") == incoming.get("target")
        and instant(stored["at"]) == instant(incoming["at"])
    )

"""A kick session's taps and a contraction's stop. No database or clock, so the app can mirror it.

Each tap and stop has its own identity and needs no revision, so two phones never conflict and a
retry changes nothing. The result depends only on the set of actions, never on arrival order.
"""

from app.domains.baby.feeds import instant

SESSION_KINDS = ("contraction", "kick_session")


def reduce_session(actions):
    """Taps still standing, and the earliest stop still standing. An undo takes back one action."""
    undone = {item["target"] for item in actions if item["action"] == "undo"}
    live = [item for item in actions if item["action"] != "undo" and item["id"] not in undone]
    stops = [item for item in live if item["action"] == "finish"]
    return {
        "count": sum(item["action"] == "tap" for item in live),
        "end_at": min(stops, key=lambda item: (instant(item["at"]), item["id"]))["at"] if stops else None,
    }


def with_session(kind, data, occurred_at):
    """Stored session data with its count and end from its actions."""
    result = reduce_session(data["session_actions"])
    end = result["end_at"]
    # A phone whose clock runs behind can stop a session before the start another phone gave it.
    if end and instant(end) < occurred_at:
        end = occurred_at.isoformat()
    return {
        **data,
        "end_at": end,
        **({"count": result["count"]} if kind == "kick_session" else {}),
    }

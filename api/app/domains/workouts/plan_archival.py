"""Reversible plan organization never removes prescriptions or actuals."""

from copy import deepcopy

from fastapi import HTTPException


def is_archived(content):
    return bool(content.get("schedule_state", {}).get("archived_at"))


def require_unarchived(content):
    if is_archived(content):
        raise HTTPException(409, "Restore this archived plan before changing its schedule")


def archive_content(content, archived, timestamp):
    result = deepcopy(content)
    if is_archived(content) == archived:
        return result
    state = result.get("schedule_state", {}).copy()
    if archived:
        state["archive_previous_status"] = state.get("status")
        state["archived_at"] = timestamp.isoformat()
        # Older clients already disable training and PUT edits for paused plans.
        state["status"] = "paused"
    else:
        previous_status = state.pop("archive_previous_status", None)
        state.pop("archived_at", None)
        if previous_status is None:
            state.pop("status", None)
        else:
            state["status"] = previous_status
    if state:
        result["schedule_state"] = state
    else:
        result.pop("schedule_state", None)
    return result

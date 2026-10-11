"""Keep workout sources, health records and coaching context out of telemetry."""

from urllib.parse import urlsplit

from app.ai_governance import current_ai_context


def _workouts_path(value):
    if not isinstance(value, str):
        return False
    try:
        return urlsplit(value).path.startswith("/api/v1/workouts")
    except ValueError:
        return False


def redact_workouts_event(event, hint=None):
    """Retain a minimal diagnostic without request bodies or local variable data.

    Sentry's default PII flag does not remove all request bodies. For this private
    domain we deliberately discard exception values, breadcrumbs and contexts;
    source/provider errors can otherwise contain imported or health text.
    """
    request = event.get("request") or {}
    if not any(
        _workouts_path(value)
        for value in (
            request.get("url"),
            event.get("transaction"),
            current_ai_context().route,
        )
    ):
        return event
    return {
        key: event[key]
        for key in ("event_id", "timestamp", "level", "platform", "release", "environment", "type")
        if key in event
    } | {"message": "Workouts request failed", "tags": {"product": "workouts"}}


def redact_workouts_transaction(event, hint=None):
    """Do not capture traces whose spans can include health/source metadata."""
    request = event.get("request") or {}
    if any(
        _workouts_path(value)
        for value in (
            request.get("url"),
            event.get("transaction"),
            current_ai_context().route,
        )
    ):
        return None
    return event


class WorkoutsAccessLogFilter:
    """Keep capability tokens and private query values out of access logs."""

    def filter(self, record):
        values = record.args if isinstance(record.args, tuple) else (record.args,)
        return not any(isinstance(value, str) and "/api/v1/workouts" in value for value in values)

"""Keep private workouts and shared media monitor contents out of telemetry."""

from urllib.parse import urlsplit

from app.ai_governance import current_ai_context


def _workouts_path(value):
    if not isinstance(value, str):
        return False
    try:
        return urlsplit(value).path.startswith("/api/v1/workouts")
    except ValueError:
        return False


def _baby_path(value):
    if not isinstance(value, str):
        return False
    try:
        path = urlsplit(value).path
        return path == "/api/v1/baby" or path.startswith("/api/v1/baby/")
    except ValueError:
        return False


def _private_product(event):
    request = event.get("request") or {}
    values = (request.get("url"), event.get("transaction"), current_ai_context().route)
    if any(_baby_path(value) for value in values):
        return "baby"
    if any(_workouts_path(value) for value in values):
        return "workouts"
    return None


def _monitor_event(event):
    request = event.get("request") or {}
    return (event.get("tags") or {}).get("monitor") == "import-health" or any(
        isinstance(value, str) and "/internal/import-health" in value
        for value in (request.get("url"), event.get("transaction"), current_ai_context().route)
    )


def redact_workouts_event(event, hint=None):
    """Retain a minimal diagnostic without request bodies or local variable data.

    Sentry's default PII flag does not remove all request bodies. For this private
    domain we deliberately discard exception values, breadcrumbs and contexts;
    source/provider errors can otherwise contain imported or health text.
    """
    if _monitor_event(event):
        tags = event.get("tags") or {}
        platform = tags.get("platform")
        stage = tags.get("stage")
        platform = platform if platform in {"instagram", "tiktok", "youtube"} else "unknown"
        stage = stage if stage in {"auth", "input", "lock", "metadata", "audio", "frames", "complete"} else "unknown"
        return {
            key: event[key] for key in ("event_id", "timestamp", "level", "platform", "release", "environment")
            if key in event
        } | {
            "message": "Shared media health check failed",
            "tags": {"monitor": "import-health", "platform": platform, "stage": stage},
            "fingerprint": ["import-health", platform, stage],
        }
    product = _private_product(event)
    if product is None:
        return event
    return {
        key: event[key]
        for key in ("event_id", "timestamp", "level", "platform", "release", "environment", "type")
        if key in event
    } | {"message": f"{'Baby' if product == 'baby' else 'Workouts'} request failed", "tags": {"product": product}}


def redact_workouts_transaction(event, hint=None):
    """Do not capture traces whose spans can include health/source metadata."""
    if _monitor_event(event):
        return None
    if _private_product(event):
        return None
    return event


class WorkoutsAccessLogFilter:
    """Keep capability tokens and private query values out of access logs."""

    def filter(self, record):
        values = record.args if isinstance(record.args, tuple) else (record.args,)
        return not any(isinstance(value, str) and any(
            path in value for path in ("/api/v1/workouts", "/api/v1/baby", "/internal/import-health")
        ) for value in values)

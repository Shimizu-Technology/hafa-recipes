"""Keep private workouts and shared media monitor contents out of telemetry."""

import logging
import re
from urllib.parse import urlsplit
from uuid import uuid4

import sentry_sdk
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException

from app.ai_governance import current_ai_context
from app.config import get_settings

logger = logging.getLogger(__name__)
_PRIVATE_ROUTES = set()
ERROR_CODES = frozenset({
    "unknown", "http_error", "validation_error", "unexpected_error", "timeout", "coach_failure",
    "empty_response", "invalid_provider_output", "invalid_tool_call", "provider_disabled",
    "provider_incomplete", "provider_input_limit", "provider_output_limit", "provider_refusal",
    "provider_unavailable", "uninspected_source", "uninspected_target",
    "workouts_import_busy", "workouts_import_timeout",
    "TIMEOUT", "RATE_LIMITED", "MEDIA_BUSY", "SOURCE_UNAVAILABLE", "SOURCE_RESPONSE_INVALID",
    "INSTAGRAM_AUTH_REQUIRED", "NO_CONTENT",
    "workouts_ai_attempt_cap_exceeded", "workouts_ai_attempt_reused",
    "workouts_ai_budget_authority_unconfigured", "workouts_ai_budget_configuration_invalid",
    "workouts_ai_budget_disabled", "workouts_ai_budget_exceeded", "workouts_ai_budget_unavailable",
    "workouts_ai_budget_unconfigured", "workouts_ai_capability_unsupported",
    "workouts_ai_diagnostics_invalid", "workouts_ai_envelope_unsupported",
    "workouts_ai_model_unpriced", "workouts_ai_usage_invalid",
})


def _diagnostic_tags(tags):
    clean = {}
    for key, allowed in {
        "error_code": ERROR_CODES,
        "stage": {"request", "coach", "metadata", "audio", "frames"},
        "exception_class": {"CoachFailure", "HTTPException", "TimeoutError", "CancelledError",
                            "RequestValidationError", "Exception"},
        "route": _PRIVATE_ROUTES,
    }.items():
        value = tags.get(key)
        if isinstance(value, str) and value in allowed:
            clean[key] = value
    status = tags.get("http_status")
    if re.fullmatch(r"[45][0-9]{2}", str(status)):
        clean["http_status"] = str(status)
    response_status = tags.get("response_status")
    if re.fullmatch(r"[1-3][0-9]{2}", str(response_status)):
        clean["response_status"] = str(response_status)
    correlation = tags.get("correlation_id")
    if isinstance(correlation, str) and re.fullmatch(r"[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}", correlation):
        clean["correlation_id"] = correlation
    return clean


class PrivateFailureRoute(APIRoute):
    """Observe private route failures without reading response or request bodies."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if _baby_path(self.path) or _workouts_path(self.path):
            _PRIVATE_ROUTES.add(self.path)

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except HTTPException as error:
                detail = error.detail
                code = detail.get("code") if isinstance(detail, dict) else detail
                request.scope["private_failure_code"] = code if isinstance(code, str) and code in ERROR_CODES else "unknown"
                raise
            except RequestValidationError:
                request.scope["private_failure_code"] = "validation_error"
                raise

        return handler


def report_private_failure(scope, status, *, response_status=None):
    """Use only a registered template, never the raw ASGI path or response body."""
    route = getattr(scope.get("route"), "path", None)
    if route not in _PRIVATE_ROUTES:
        return
    product = "baby" if _baby_path(route) else "workouts"
    tags = _diagnostic_tags({"route": route, "http_status": status,
        "response_status": response_status,
        "error_code": scope.get("private_failure_code", "http_error"),
        "stage": "request", "correlation_id": uuid4().hex}) | {"product": product}
    release = get_settings().app_release_id
    # Deployment configuration, never a request-provided release label.
    release = release if re.fullmatch(r"[A-Za-z0-9._-]{1,100}", release) else "unknown"
    logger.warning("private_request_failed product=%s route=%s http_status=%s response_status=%s error_code=%s stage=%s release=%s correlation_id=%s",
        product, tags["route"], tags["http_status"], tags.get("response_status", "unknown"),
        tags.get("error_code", "unknown"), tags["stage"], release, tags["correlation_id"])
    if status >= 500:
        sentry_sdk.capture_event({"message": "Private request failed", "level": "error",
            "release": release, "tags": tags, "request": {"url": route}})


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
    tags = {"product": product} | _diagnostic_tags(event.get("tags") or {})
    redacted = {
        key: event[key]
        for key in ("event_id", "timestamp", "level", "platform", "release", "environment", "type")
        if key in event
    } | {"message": f"{'Baby' if product == 'baby' else 'Workouts'} request failed", "tags": tags}
    if "route" in tags:
        redacted["fingerprint"] = [product, tags["route"], tags.get("http_status", "unknown"), tags.get("error_code", "unknown")]
    return redacted


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

"""New-profile-only numeric recipe-chat observation, without warming SDK resources."""

import contextvars
import json
import math
import os
import time
from pathlib import Path

from capacity.safety import ensure

FIELDS = (
    "sdk_body_ms",
    "accounting_exit_ms",
    "fixture_transport_ms",
    "fixture_requested_wait_ms",
    "fixture_transport_calls",
)
# uvloop0.22.1 uses integer-ms timers and refreshes uv_now before starting
# them (loop.pyx call_later; handles/timer.pyx UVTimer.start). A requested
# 250ms sleep can finish just under250ms on our higher-resolution clock.
# Keep the measured value; this bound validates diagnostic consistency only.
TIMER_QUANTIZATION_MS = 1.0
REQUESTED_WAIT_MS = 250.0
MIN_OBSERVED_WAIT_MS = REQUESTED_WAIT_MS - TIMER_QUANTIZATION_MS
STAGES = {
    "gc_pause",
    "loop_lag",
    "thumbnail_normalize",
    "evidence_frames",
    "cover_frames",
    "cover_compare",
}
active = contextvars.ContextVar("capacity_recipe_chat_frame", default=None)
REJECTIONS = {
    "none": {"none"},
    "unknown": {"unavailable"},
    "checkpoint": {"missing"},
    "components": {
        "count",
        "shape",
        "ordinal",
        "incomplete",
        "fields",
        "wait",
        "transport_calls",
        "requested_wait",
        "observed_wait",
        "body_duration",
    },
    "trace": {"samples", "source", "bounds", "pairing", "count", "format"},
    "stages": {"bounds", "failed", "fields"},
    "public": {"shape"},
}


def rejection_public(value):
    """Closed content-free boundary evidence; unknown inputs imply no attribution."""
    unknown = {"boundary": "unknown", "code": "unavailable", "ordinal": 0, "count": 0}
    if not isinstance(value, dict):
        return unknown
    boundary, code = value.get("boundary"), value.get("code")
    if (
        type(boundary) is not str
        or type(code) is not str
        or code not in REJECTIONS.get(boundary, set())
    ):
        return unknown
    if (
        type(value.get("ordinal")) is not int
        or not 0 <= value["ordinal"] <= 5
        or type(value.get("count")) is not int
        or not 0 <= value["count"] <= 4097
    ):
        return unknown
    return {
        "boundary": boundary,
        "code": code,
        "ordinal": value["ordinal"],
        "count": value["count"],
    }


def reject(sink, boundary, code, *, ordinal=0, count=0):
    if isinstance(sink, dict):
        sink.clear()
        sink.update(
            {
                "boundary": boundary,
                "code": code,
                "ordinal": ordinal,
                "count": min(max(count, 0), 4097) if type(count) is int else 0,
            }
        )
    return {"available": False}


def chat_rejection(diagnosis, observation, parser):
    if diagnosis.get("available") is True:
        return {"boundary": "none", "code": "none", "ordinal": 0, "count": 5}
    parsed, observed = rejection_public(parser), rejection_public(observation)
    if observed["boundary"] in {"components", "checkpoint"}:
        return observed
    return parsed


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1e15


def wait_rejection(row):
    """Four independent checks; never round observed time to the requested wait."""
    if row["fixture_transport_calls"] != 1:
        return "transport_calls"
    if row["fixture_requested_wait_ms"] != REQUESTED_WAIT_MS:
        return "requested_wait"
    if row["fixture_transport_ms"] < MIN_OBSERVED_WAIT_MS:
        return "observed_wait"
    if row["sdk_body_ms"] < row["fixture_transport_ms"]:
        return "body_duration"
    return None


class Components:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.calls = 0
        self.rows = []
        self.rejection = {}

    def begin(self):
        self.calls += 1
        if self.calls > 5:
            return None
        row = {
            "ordinal": self.calls,
            "complete": False,
            "failed": False,
            "sdk_body_ms": None,
            "accounting_exit_ms": None,
            "fixture_transport_ms": 0.0,
            "fixture_requested_wait_ms": 0.0,
            "fixture_transport_calls": 0,
        }
        self.rows.append(row)
        return row

    def snapshot(self):
        return component_public(
            {"calls_observed": self.calls, "rows": self.rows}, self.rejection
        )


def component_public(value, rejection=None):
    """Closed five-row whitelist. Partial/failed/overflow evidence is unavailable."""
    try:
        rows = value.get("rows")
        if (
            type(value.get("calls_observed")) is not int
            or value["calls_observed"] != 5
            or not isinstance(rows, list)
            or len(rows) != 5
        ):
            return reject(
                rejection, "components", "count", count=value.get("calls_observed")
            )
        clean = []
        for ordinal, row in enumerate(rows, 1):
            if type(row.get("ordinal")) is not int or row["ordinal"] != ordinal:
                return reject(rejection, "components", "ordinal", ordinal=ordinal)
            if row.get("complete") is not True or row.get("failed") is not False:
                return reject(rejection, "components", "incomplete", ordinal=ordinal)
            if (
                any(not number(row.get(key)) for key in FIELDS)
                or type(row.get("fixture_transport_calls")) is not int
            ):
                return reject(rejection, "components", "fields", ordinal=ordinal)
            if code := wait_rejection(row):
                return reject(rejection, "components", code, ordinal=ordinal)
            clean.append(
                {
                    "ordinal": ordinal,
                    "complete": True,
                    "failed": False,
                    **{key: row[key] for key in FIELDS},
                }
            )
        if isinstance(rejection, dict):
            rejection.clear()
            rejection.update(boundary="none", code="none", ordinal=0, count=5)
        return {
            "available": True,
            "calls_observed": 5,
            "inclusive_timings": True,
            "nested_timings_summed": False,
            "rows": clean,
        }
    except (AttributeError, KeyError, TypeError):
        return reject(rejection, "components", "shape")


def install(app, patch=setattr, *, clock=time.monotonic):
    ensure()
    if os.environ.get("CAPACITY_EXPORT_JOBS_MIXED") != "true" or os.environ.get(
        "CAPACITY_PHASE"
    ) not in ("baseline", "mixed"):
        raise RuntimeError("Recipe diagnosis requires the new isolated mixed wrapper")
    # These classes are already imported by the real application. Do not touch
    # openai_client.chat/completions: cached resource imports belong to traffic.
    from app.ai_governance import AIInvocationTracker

    from capacity.transport import ProviderTransport

    route = next(
        route
        for route in app.routes
        if getattr(route, "path", None) == "/capacity/status"
    )
    status = route.dependant.call
    components = Components(clock)
    enter, exit_call = AIInvocationTracker.__aenter__, AIInvocationTracker.__aexit__
    transport = ProviderTransport.handle_async_request

    async def observed_enter(tracker):
        row = components.begin() if tracker.capability == "recipe_chat" else None
        token = active.set(
            None
        )  # Nested unrelated capabilities do not inherit a frame.
        try:
            result = await enter(tracker)
        except BaseException:
            if row is not None:
                row["failed"] = True
            active.reset(token)
            raise
        body_started = clock() if row is not None else None
        active.set(row)
        pairs = getattr(tracker, "_capacity_chat_pairs", [])
        pairs.append((row, token, body_started))
        tracker._capacity_chat_pairs = pairs
        return result

    async def observed_exit(tracker, *args):
        row, token, body_started = tracker._capacity_chat_pairs.pop()
        exit_started = clock() if row is not None else None
        if row is not None:
            row["sdk_body_ms"] = (exit_started - body_started) * 1000
            row["failed"] = args[1] is not None or tracker.status != "success"
        try:
            return await exit_call(tracker, *args)
        except BaseException:
            if row is not None:
                row["failed"] = True
            raise
        finally:
            if row is not None:
                row["accounting_exit_ms"] = (clock() - exit_started) * 1000
                row["complete"] = True
            active.reset(token)
            if not tracker._capacity_chat_pairs:
                del tracker._capacity_chat_pairs

    async def observed_transport(provider, request):
        row = active.get()
        if row is None:
            return await transport(provider, request)
        started = clock()
        row["fixture_transport_calls"] += 1
        row["fixture_requested_wait_ms"] += provider.delay * 1000
        try:
            return await transport(provider, request)
        except BaseException:
            row["failed"] = True
            raise
        finally:
            row["fixture_transport_ms"] += (clock() - started) * 1000

    patch(AIInvocationTracker, "__aenter__", observed_enter)
    patch(AIInvocationTracker, "__aexit__", observed_exit)
    patch(ProviderTransport, "handle_async_request", observed_transport)

    async def observed_status(*args, **kwargs):
        result = await status(*args, **kwargs)
        measured = components.snapshot()
        return {
            **result,
            "recipe_chat_components": measured,
            "recipe_chat_observation": rejection_public(components.rejection),
        }

    patch(route.dependant, "call", observed_status)
    return components


def chat_trace(samples, trace_path, components, rejection=None):
    """Five actual trace pairs aligned to existing sample origin, no IDs/UTC output."""
    unavailable = {"available": False}
    boundary = "trace"
    try:
        if (
            not samples
            or len(samples) > 1000
            or not number(origin := samples[0].get("timestamp"))
        ):
            return reject(rejection, "trace", "samples")
        path = Path(trace_path)
        if not path.is_file() or path.is_symlink():
            return reject(rejection, "trace", "source")
        with path.open("rb") as stream:
            data = stream.read(2 * 1024 * 1024 + 1)
        lines = data.decode().splitlines()
        if len(data) > 2 * 1024 * 1024 or len(lines) > 4096:
            return reject(rejection, "trace", "bounds", count=len(lines))
        rows, pending, last_request, last_end = [], None, -1, origin
        for line in lines:
            event = json.loads(line)
            if event.get("route") != "recipes/chat":
                continue
            if len(rows) >= 5:
                return reject(rejection, "trace", "count", count=len(rows) + 1)
            if event.get("event") == "start":
                if (
                    pending is not None
                    or not number(event.get("timestamp"))
                    or event["timestamp"] < last_end
                    or type(event.get("request_number")) is not int
                    or event["request_number"] <= last_request
                ):
                    return reject(rejection, "trace", "pairing", ordinal=len(rows) + 1)
                pending = (event.get("request_number"), event["timestamp"])
            elif event.get("event") == "end":
                if (
                    pending is None
                    or event.get("request_number") != pending[0]
                    or type(event.get("request_number")) is not int
                    or type(event.get("status")) is not int
                    or event["status"] != 200
                    or not number(event.get("milliseconds"))
                    or event["milliseconds"] <= 0
                    or not number(event.get("timestamp"))
                    or event["timestamp"] < pending[1]
                    or pending[1] < origin
                ):
                    return reject(rejection, "trace", "pairing", ordinal=len(rows) + 1)
                rows.append(
                    {
                        "ordinal": len(rows) + 1,
                        "relative_start_ms": (pending[1] - origin) * 1000,
                        "duration_ms": event["milliseconds"],
                        "status": 200,
                    }
                )
                last_request = pending[0]
                last_end = event["timestamp"]
                pending = None
            else:
                return reject(rejection, "trace", "pairing", ordinal=len(rows) + 1)
        if pending is not None or len(rows) != 5:
            return reject(rejection, "trace", "count", count=len(rows))
        clean_components = component_public(components, rejection)
        if not clean_components["available"]:
            return unavailable
        boundary = "stages"
        observed = []
        for sample in samples:
            for event in sample.get("stages", []):
                if event.get("stage") in STAGES:
                    if len(observed) >= 1024:
                        return reject(
                            rejection, "stages", "bounds", count=len(observed)
                        )
                    if event.get("event") == "failed":
                        return reject(rejection, "stages", "failed")
                    observed.append(event)
        for row, timings in zip(rows, clean_components["rows"]):
            row.update({key: timings[key] for key in FIELDS})
            # Completed end-event durations define actual intervals, not an
            # arbitrary start/end envelope spanning missing events.
            left, right = (
                origin + row["relative_start_ms"] / 1000,
                origin + (row["relative_start_ms"] + row["duration_ms"]) / 1000,
            )
            row["overlap_counts"] = {}
            for stage in sorted(STAGES):
                count = 0
                for event in observed:
                    if event.get("stage") != stage or event.get("event") != "end":
                        continue
                    end, duration = event.get("timestamp"), event.get("duration_ms")
                    if not number(end) or not number(duration) or duration <= 0:
                        return reject(rejection, "stages", "fields")
                    count += int(min(right, end) > max(left, end - duration / 1000))
                row["overlap_counts"][stage] = count
        clean = chat_public({"available": True, "rows": rows})
        if not clean["available"]:
            return reject(rejection, "public", "shape")
        return clean
    except OSError:
        return reject(rejection, "trace", "source")
    except (UnicodeError, ValueError, TypeError, KeyError, AttributeError):
        return reject(
            rejection, boundary, "fields" if boundary == "stages" else "format"
        )


def chat_public(value):
    try:
        rows = value.get("rows")
        if (
            value.get("available") is not True
            or not isinstance(rows, list)
            or len(rows) != 5
        ):
            return {"available": False}
        clean = []
        for ordinal, row in enumerate(rows, 1):
            if (
                type(row.get("ordinal")) is not int
                or row["ordinal"] != ordinal
                or row.get("status") != 200
                or type(row.get("status")) is not int
            ):
                return {"available": False}
            fields = ("relative_start_ms", "duration_ms", *FIELDS)
            if (
                any(not number(row.get(key)) for key in fields)
                or row["duration_ms"] <= 0
                or type(row["fixture_transport_calls"]) is not int
                or wait_rejection(row) is not None
            ):
                return {"available": False}
            overlaps = {stage: row["overlap_counts"][stage] for stage in sorted(STAGES)}
            if any(
                type(count) is not int or not 0 <= count <= 1024
                for count in overlaps.values()
            ):
                return {"available": False}
            clean.append(
                {
                    "ordinal": ordinal,
                    "status": 200,
                    **{key: row[key] for key in fields},
                    "overlap_counts": overlaps,
                }
            )
        return {
            "available": True,
            "inclusive_timings": True,
            "nested_timings_summed": False,
            "rows": clean,
        }
    except (AttributeError, KeyError, TypeError):
        return {"available": False}

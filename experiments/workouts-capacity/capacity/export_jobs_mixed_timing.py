"""Private fixed handshake and shared Linux monotonic timing; numeric public proof."""

import asyncio
import json
import math
import os
import stat
import time
from pathlib import Path

NAMES = {
    "load-prepared.json",
    "observer-prepared.json",
    "start.json",
    "observing.json",
    "observer-ended.json",
}
PREPARATION_SECONDS = 60
PHASE_SECONDS = 470
TRAFFIC_SECONDS = 300
OBSERVATION_SECONDS = 450
TAIL_SECONDS = 150
START_TOLERANCE_SECONDS = 1


class TimingError(RuntimeError):
    pass


def finite(value):
    return type(value) in (float, int) and math.isfinite(value) and value >= 0


def namespace():
    return os.stat("/proc/self/ns/time").st_ino


def directory(control):
    path = Path(control)
    if path.is_symlink() or not path.is_dir():
        raise TimingError("mixed_timing_failed")
    return path


def write_state(control, name, value):
    folder = directory(control)
    if name not in NAMES:
        raise TimingError("mixed_timing_failed")
    data = json.dumps(value, allow_nan=False, separators=(",", ":")).encode()
    if len(data) > 4096:
        raise TimingError("mixed_timing_failed")
    temporary = folder / (name + ".pending")
    descriptor = os.open(
        temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(
            temporary, folder / name, follow_symlinks=False
        )  # Publish once; never replace history.
    finally:
        temporary.unlink()


def read_state(control, name):
    folder = directory(control)
    if name not in NAMES:
        raise TimingError("mixed_timing_failed")
    try:
        descriptor = os.open(folder / name, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    except OSError:
        raise TimingError("mixed_timing_failed") from None
    try:
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
                raise TimingError("mixed_timing_failed")
            data = stream.read(4097)
            if len(data) > 4096:
                raise TimingError("mixed_timing_failed")
            value = json.loads(data)
    except (OSError, ValueError):
        raise TimingError("mixed_timing_failed") from None
    if (
        not isinstance(value, dict)
        or type(value.get("schema_version")) is not int
        or value.get("schema_version") != 1
    ):
        raise TimingError("mixed_timing_failed")
    return value


def prepared(role, phase):
    return {
        "schema_version": 1,
        "role": role,
        "phase": phase,
        "namespace_inode": namespace(),
        "prepared_at": time.monotonic(),
    }


def check_prepared(value, role, phase, host_namespace, until):
    if (
        not isinstance(value, dict)
        or type(value.get("schema_version")) is not int
        or value.get("schema_version") != 1
        or value.get("role") != role
        or value.get("phase") != phase
        or type(value.get("namespace_inode")) is not int
        or value["namespace_inode"] != host_namespace
        or not finite(value.get("prepared_at"))
        or value["prepared_at"] > min(until, time.monotonic())
    ):
        raise TimingError("mixed_timing_failed")


def checked_start(value, phase, clock_namespace):
    if (
        not isinstance(value, dict)
        or type(value.get("schema_version")) is not int
        or value.get("schema_version") != 1
        or value.get("phase") != phase
        or type(value.get("namespace_inode")) is not int
        or value["namespace_inode"] != clock_namespace
        or not finite(value.get("start_at"))
    ):
        raise TimingError("mixed_timing_failed")
    return value["start_at"]


def checked_observing(value, start, clock_namespace):
    if (
        not isinstance(value, dict)
        or type(value.get("schema_version")) is not int
        or value.get("schema_version") != 1
        or value.get("namespace_inode") != clock_namespace
        or value.get("start_at") != start
        or not finite(value.get("observer_started_at"))
        or not finite(value.get("first_sample_at"))
        or not start
        <= value["observer_started_at"]
        <= value["first_sample_at"]
        <= start + START_TOLERANCE_SECONDS
    ):
        raise TimingError("mixed_timing_failed")
    return value


async def wait_state(control, name, until):
    while time.monotonic() < until:
        value = read_state(control, name)
        if value is not None:
            return value
        await asyncio.sleep(min(0.05, max(0, until - time.monotonic())))
    raise TimingError("mixed_timing_failed")


async def client_start(control, phase, preparation_until):
    clock_namespace = namespace()
    write_state(control, "load-prepared.json", prepared("load", phase))
    start = checked_start(
        await wait_state(control, "start.json", preparation_until),
        phase,
        clock_namespace,
    )
    value = checked_observing(
        await wait_state(
            control,
            "observing.json",
            min(preparation_until, start + START_TOLERANCE_SECONDS),
        ),
        start,
        clock_namespace,
    )
    if (
        not start
        <= value["first_sample_at"]
        <= time.monotonic()
        <= start + START_TOLERANCE_SECONDS
    ):
        raise TimingError("mixed_timing_failed")
    return start, value


def timing_proof(traffic, observer):
    if not isinstance(traffic, dict) or not isinstance(observer, dict):
        return {"passed": False}
    numbers = {
        key: traffic.get(key)
        for key in ("start_at", "traffic_first_start", "traffic_last_end")
    }
    numbers.update(
        {
            key: observer.get(key)
            for key in ("observer_started_at", "first_sample_at", "observer_ended_at")
        }
    )
    valid = all(finite(value) for value in numbers.values())
    start = numbers["start_at"]
    valid = valid and (
        type(traffic.get("namespace_inode")) is int
        and type(observer.get("namespace_inode")) is int
        and traffic["namespace_inode"] > 0
        and traffic["namespace_inode"] == observer.get("namespace_inode")
        and observer.get("start_at") == start
        and traffic.get("unsettled_requests") == 0
        and observer.get("completed") is True
    )
    if not valid:
        return {"passed": False}
    first, last = numbers["traffic_first_start"], numbers["traffic_last_end"]
    began, sampled, ended = (
        numbers["observer_started_at"],
        numbers["first_sample_at"],
        numbers["observer_ended_at"],
    )
    tail = ended - last
    passed = (
        start <= began <= sampled <= first <= start + START_TOLERANCE_SECONDS
        and first <= last <= start + TRAFFIC_SECONDS
        and ended - began >= OBSERVATION_SECONDS
        and tail >= TAIL_SECONDS
    )
    return {
        "passed": passed,
        "planned_traffic_seconds": TRAFFIC_SECONDS,
        "planned_observation_seconds": OBSERVATION_SECONDS,
        "first_traffic_delay_seconds": first - start,
        "last_traffic_offset_seconds": last - start,
        "observer_duration_seconds": ended - began,
        "actual_tail_seconds": tail if tail >= 0 else None,
    }

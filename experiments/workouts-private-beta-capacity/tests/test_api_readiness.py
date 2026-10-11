"""Actual inline probe's deadline semantics; no socket or global clock changes."""

import ast
import io
import json
from pathlib import Path
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "experiments/workouts-private-beta-capacity/run.sh"
code = (
    SCRIPT.read_text()
    .split("python -c 'import json,sys,time,urllib.request,urllib.error\n", 1)[1]
    .split('\' "$startup_deadline")', 1)[0]
)
namespace = {"json": json}
functions = ast.Module(
    body=[node for node in ast.parse(code).body if isinstance(node, ast.FunctionDef)],
    type_ignores=[],
)
# Checked-in pure function only; the CLI/file/network calls are not executed.
exec(compile(functions, str(SCRIPT), "exec"), namespace)  # noqa: S102
probe = namespace["readiness"]


class Clock:
    def __init__(self):
        self.now = 0
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def test_refused_until_six_seconds_passes_inside_original_twelve_second_budget():
    clock = Clock()

    def request(_url, *, timeout):
        assert 0 < timeout <= min(1, 12 - clock.now)
        if clock.now < 6:
            raise URLError(ConnectionRefusedError())
        return io.BytesIO(b'{"status":"ok"}')

    result = probe(12, clock, clock.sleep, request)
    assert result["ready"] and not result["expired"]
    assert 6 <= clock.now < 12


def test_never_ready_stops_at_deadline_with_closed_failure_metadata():
    clock = Clock()

    def request(_url, *, timeout):
        assert 0 < timeout <= 1
        raise URLError(ConnectionRefusedError())

    result = probe(12, clock, clock.sleep, request)
    assert result == {
        "ready": False,
        "expired": True,
        "attempts": result["attempts"],
        "error_class": "ConnectionRefusedError",
    }
    assert clock.now == 12 and all(0 < value <= 0.2 for value in clock.sleeps)


def test_late_success_after_deadline_cannot_be_accepted():
    clock = Clock()

    def request(_url, *, timeout):
        clock.now = 12.01
        return io.BytesIO(b'{"status":"ok"}')

    result = probe(12, clock, clock.sleep, request)
    assert not result["ready"] and result["expired"]
    assert result["error_class"] == "DeadlineExceeded"

"""Actual retained evidence boundaries, without Docker, sockets or app imports."""

import ast
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
BETA = ROOT / "experiments/workouts-private-beta-capacity"
spec = importlib.util.spec_from_file_location("numeric_trace", BETA / "numeric_trace.py")
trace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trace)


def write(path, values):
    path.write_text("".join(json.dumps(row) + "\n" for row in values))


def fixture(tmp_path, route="/up", milliseconds=51):
    folder = tmp_path / "enabled"
    folder.mkdir()
    start = {"timestamp": 100, "phase": "mixed", "request_number": 19,
             "event": "start", "route": route}
    end = {**start, "timestamp": 100 + milliseconds / 1000, "event": "end",
           "milliseconds": milliseconds, "status": 200, "bytes": 300}
    sample = {"timestamp": 99, "phase": "mixed", "memory_current": 200,
              "memory_peak": 300, "cpu": {"usage_usec": 1000, "nr_periods": 8,
              "nr_throttled": 2, "throttled_usec": 500},
              "processes": [{"pid": 912, "name": "python"}],
              "stages": [{"sequence": 1, "stage": "evidence_frames", "event": "start",
                          "timestamp": 99.5, "input_bytes": 100}]}
    write(folder / "latency.json.requests.jsonl", [start, end])
    write(folder / "memory.jsonl", [sample])
    return folder, start, end, sample


@pytest.mark.parametrize("route", sorted(trace.SELECTED))
def test_keeps_protected_and_export_spans_below_100ms_without_ids(tmp_path, route):
    fixture(tmp_path, route)
    encoded = trace.collect(tmp_path)
    value = json.loads(encoded)["phases"]["enabled"]
    assert value["state"] == "captured"
    assert value["requests"] == [{"route": route, "event": "end", "duration_ms": 51,
                                  "status": 200, "bytes": 300,
                                  "start_offset_seconds": 1, "end_offset_seconds": 1.051}]
    assert value["samples"][0]["cpu"]["nr_throttled"] == 2
    assert value["media"][0]["offset_seconds"] == 0.5
    assert "request_number" not in encoded and "912" not in encoded and "processes" not in encoded


@pytest.mark.parametrize("fault", ["secret", "route", "number", "cpu", "stage", "pair"])
def test_invalid_input_has_only_closed_unavailable_error(tmp_path, fault):
    folder, start, end, sample = fixture(tmp_path)
    if fault == "secret":end["authorization"] = "private-token"
    if fault == "route":end["route"] = "private-token"
    if fault == "number":end["milliseconds"] = "private-token"
    if fault == "cpu":sample["cpu"]["private-token"] = 1
    if fault == "stage":sample["stages"][0]["stage"] = "private-token"
    if fault == "pair":start["route"] = "recipes/list"
    write(folder / "latency.json.requests.jsonl", [start, end])
    write(folder / "memory.jsonl", [sample])
    encoded = trace.collect(tmp_path)
    assert json.loads(encoded)["phases"]["enabled"] == {"state": "unavailable", "error_class": "TraceError"}
    assert "private-token" not in encoded


def test_input_and_output_limits_fail_closed_without_truncating_evidence(tmp_path, monkeypatch):
    fixture(tmp_path)
    monkeypatch.setattr(trace, "MAX_INPUT", 10)
    assert json.loads(trace.collect(tmp_path))["phases"]["enabled"]["state"] == "unavailable"
    monkeypatch.setattr(trace, "MAX_INPUT", 8 * 1024**2)
    monkeypatch.setattr(trace, "MAX_OUTPUT", 10)
    assert json.loads(trace.collect(tmp_path)) == {"version": 1, "state": "unavailable", "error_class": "OutputLimit"}


def test_actual_observer_patch_keeps_memory_gate_and_reads_cpu_in_same_cat(tmp_path):
    original = subprocess.check_output(["git", "show", "405d894:experiments/workouts-capacity/capacity/host_monitor.py"], cwd=ROOT)
    target = tmp_path / "host_monitor.py"
    target.write_bytes(original)
    result = subprocess.run(["patch", "--fuzz=0", "-p1", "-d", str(tmp_path)], input=(BETA / "observer-cpu.patch").read_bytes(), capture_output=True, check=False)
    assert result.returncode == 0
    source = target.read_text()
    tree = ast.parse(source)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "cgroup")
    namespace = {"MonitorError": ValueError}
    # Only the pinned pure parser; no Docker/network code is executed.
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(target), "exec"), namespace)  # noqa: S102
    raw = "200\n300\nlow 0\nhigh 0\nmax 0\noom 0\noom_kill 0\nusage_usec 1000\nnr_periods 8\nnr_throttled 2\nthrottled_usec 500\n"
    value = namespace["cgroup"](raw)
    assert value["memory_current"] == 200 and value["memory_peak"] == 300 and value["oom_kill"] == 0
    assert value["cpu"] == {"usage_usec": 1000, "nr_periods": 8, "nr_throttled": 2, "throttled_usec": 500}
    with pytest.raises(ValueError):namespace["cgroup"](raw + "usage_usec 1\n")
    with pytest.raises(ValueError):namespace["cgroup"](raw.replace("throttled_usec 500\n", ""))
    assert source.count('"/sys/fs/cgroup/cpu.stat"') == 1


def test_interrupted_selected_request_keeps_start_without_inventing_duration(tmp_path):
    folder, start, _, _ = fixture(tmp_path)
    write(folder / "latency.json.requests.jsonl", [start])
    value = json.loads(trace.collect(tmp_path))["phases"]["enabled"]
    assert value["unfinished_selected_requests"] == 1
    assert value["requests"] == [{"route": "/up", "event": "unfinished", "duration_ms": None,
                                  "status": None, "bytes": None,
                                  "start_offset_seconds": 1, "end_offset_seconds": None}]


@pytest.mark.parametrize("missing", ["memory.jsonl", "latency.json.requests.jsonl"])
def test_single_missing_input_is_unavailable_not_never_started(tmp_path, missing):
    folder, _, _, _ = fixture(tmp_path)
    (folder / missing).unlink()
    value = json.loads(trace.collect(tmp_path))["phases"]["enabled"]
    assert value == {"state": "unavailable", "error_class": "TraceError"}


@pytest.mark.parametrize("stages", [None, "private-token", {}, [None]])
def test_invalid_stage_container_is_closed_without_raw_errors(tmp_path, stages):
    folder, _, _, sample = fixture(tmp_path)
    sample["stages"] = stages
    write(folder / "memory.jsonl", [sample])
    encoded = trace.collect(tmp_path)
    assert json.loads(encoded)["phases"]["enabled"] == {"state": "unavailable", "error_class": "TraceError"}
    assert "private-token" not in encoded


def test_full_two_phase_fixture_retains_every_span_and_900_samples_within_bound(tmp_path):
    counts = {"/up": 152, "recipes/list": 152, "recipes/search": 152,
              "recipes/detail": 152, "workouts/export-page": 95,
              "workouts/export-build": 5, "workouts/import-submit": 5,
              "workouts/import-poll": 305, "workouts/coach": 5}
    for name, phase in [("off", "baseline"), ("enabled", "mixed")]:
        folder = tmp_path / name
        folder.mkdir()
        requests = []
        sequence = 0
        for route, count in counts.items():
            for index in range(count):
                sequence += 1
                stamp = 1800000000 + index * 0.325
                start = {"timestamp": stamp, "phase": phase, "request_number": sequence,
                         "event": "start", "route": route}
                requests.extend([start, {**start, "event": "end", "timestamp": stamp + 0.356276,
                                         "milliseconds": 356.276537, "status": 200, "bytes": 8388608}])
        write(folder / "latency.json.requests.jsonl", requests)
        samples = [{"timestamp": 1800000000 + i * 0.5, "phase": phase,
                    "memory_current": 276593750, "memory_peak": 290029568,
                    "cpu": {"usage_usec": 999999999999 + i, "nr_periods": 999999 + i,
                            "nr_throttled": 99999 + i, "throttled_usec": 888888888888 + i},
                    "stages": ([{"sequence": i, "stage": "evidence_frames", "event": "end",
                                 "timestamp": 1800000000 + i * 0.5, "duration_ms": 999.123456,
                                 "input_bytes": 10079395, "pixels": 16000000}] if i < 30 else [])}
                   for i in range(900)]
        write(folder / "memory.jsonl", samples)
    encoded = trace.collect(tmp_path)
    assert 512 * 1024 < len(encoded.encode()) <= 1024 * 1024
    value = json.loads(encoded)
    for phase in value["phases"].values():
        assert phase["state"] == "captured"
        assert len(phase["samples"]) == 900 and len(phase["media"]) == 30
        assert len(phase["requests"]) == sum(counts.values()) == 1023
        for route, count in counts.items():
            assert sum(row["route"] == route for row in phase["requests"]) == count

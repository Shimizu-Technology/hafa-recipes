"""Exercise the pinned driver with its actual patch and fake HTTP responses only."""
import ast
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[3]
PATCH = ROOT / "experiments/workouts-private-beta-capacity/private-beta.patch"

@pytest.fixture
def poll(tmp_path):
    original = subprocess.check_output(["git", "show", "405d89446b536f8ca0009739a07d45101ee095de:experiments/workouts-capacity/capacity/driver.py"], cwd=ROOT)
    (tmp_path / "driver.py").write_bytes(original)
    result = subprocess.run(["patch", "--fuzz=0", "-p1", "-d", str(tmp_path)], input=PATCH.read_bytes(), capture_output=True)
    assert result.returncode == 0, result.stderr.decode()
    tree = ast.parse((tmp_path / "driver.py").read_text())
    method = next(node for cls in tree.body if isinstance(cls, ast.ClassDef) for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "poll")
    namespace = {"PREFIX": "/api/v1/workouts"}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(PATCH), "exec"), namespace)
    return namespace["poll"]

def response(value, status=200):
    return SimpleNamespace(status_code=status, json=lambda: value)

def driver(request):
    return SimpleNamespace(jobs=[("owner", "one", "request-one")], recipe_jobs=[("owner", "recipe-one")], outcomes={"workouts": {}, "recipes": {}, "accepted": set()}, request=request)

async def test_terminal_import_accepts_once_with_one_same_id_replay_and_retires(poll):
    calls = []
    async def request(method, path, owner, **kwargs):
        calls.append((method, path))
        if method == "POST":
            return response({"id": "saved-one"})
        return response({"status": "completed"} if "/api/jobs/" in path else {"status": "ready", "result": {"workout": {"title": "Fixture"}}})
    state = driver(request)
    await poll(state)
    assert state.jobs == state.recipe_jobs == []
    assert state.outcomes["accepted"] == {"saved-one"}
    assert state.outcomes["recipes"] == {"recipe-one": "completed"}
    assert len([item for item in calls if item[0] == "POST"]) == 2
    before = list(calls)
    await poll(state)
    assert calls == before

async def test_queued_jobs_and_new_submissions_survive_await_then_failed_terminal_retires(poll):
    stage = "queued"
    state = None
    appended = False
    async def request(method, path, owner, **kwargs):
        nonlocal appended
        assert method == "GET"
        if not appended:
            state.jobs.append(("other", "two", "request-two"))
            appended = True
        return response({"status": stage, "result": None})
    state = driver(request)
    await poll(state)
    assert [item[1] for item in state.jobs] == ["one", "two"]
    assert state.recipe_jobs == [("owner", "recipe-one")]
    stage = "failed"
    await poll(state)
    assert state.jobs == state.recipe_jobs == []
    assert state.outcomes["workouts"] == {"one": "failed", "two": "failed"}
    assert not state.outcomes["accepted"]

async def test_mismatched_acceptance_replay_aborts_without_false_saved_outcome(poll):
    posts = 0
    async def request(method, path, owner, **kwargs):
        nonlocal posts
        if method == "GET":
            return response({"status": "incomplete", "result": {"workout": {"title": "Fixture"}}})
        posts += 1
        return response({"id": "saved-one" if posts == 1 else "different"})
    state = driver(request)
    with pytest.raises(RuntimeError, match="acceptance replay differs"):
        await poll(state)
    assert posts == 2 and not state.outcomes["accepted"]

@pytest.mark.parametrize("status", ["ready", "incomplete", "failed", "cancelled", "expired"])
async def test_all_terminal_imports_retire_without_accepting_missing_workout(poll, status):
    async def request(method, path, owner, **kwargs):
        assert method == "GET"
        return response({"status": status, "result": None})
    state = driver(request)
    state.recipe_jobs = []
    await poll(state)
    assert state.jobs == [] and not state.outcomes["accepted"]

async def test_already_accepted_import_keeps_saved_id_without_posting_again(poll):
    calls = []
    async def request(method, path, owner, **kwargs):
        calls.append(method)
        assert method == "GET"
        return response({"status": "ready", "accepted_workout_id": "saved-before", "result": {"workout": {"title": "Fixture"}}})
    state = driver(request)
    state.recipe_jobs = []
    await poll(state)
    assert state.jobs == [] and state.outcomes["accepted"] == {"saved-before"}
    await poll(state)
    assert calls == ["GET"]

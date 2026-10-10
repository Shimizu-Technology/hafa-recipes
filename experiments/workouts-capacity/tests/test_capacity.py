"""Source/readiness only; never starts a server, container, database or provider."""

import base64
import json

import httpx
import pytest
from capacity import metrics, plan
from capacity.fixtures import generate
from capacity.safety import FAKE_KEY, ensure
from capacity.transport import ProviderTransport, workout


def test_safety_refuses_any_real_service_or_wrong_database():
    env = plan.environment()
    assert ensure(env) is env
    assert len(base64.urlsafe_b64decode(env["WORKOUTS_SHARE_ENCRYPTION_KEY"])) == 32
    for key, value in [
        ("ENVIRONMENT", "production"),
        ("DATABASE_URL", "postgresql://localhost/production"),
        ("OPENAI_API_KEY", "real-looking-key"),
        ("SENTRY_DSN", "https://example.test"),
        ("AWS_ACCESS_KEY_ID", "credential"),
    ]:
        with pytest.raises(RuntimeError):
            ensure({**env, key: value})
    assert env["OPENAI_API_KEY"] == FAKE_KEY


def test_filtered_context_never_copies_git_env_or_dependency_caches(tmp_path):
    repository = tmp_path / "repo"
    for folder in [
        "api/app",
        "api/migrations",
        "experiments/workouts-capacity/capacity",
    ]:
        (repository / folder).mkdir(parents=True)
        (repository / folder / "source.py").write_text("pass")
        (repository / folder / ".env").write_text("must not be copied")
        (repository / folder / "__pycache__").mkdir()
        (repository / folder / "__pycache__/secret.pyc").write_bytes(b"cache")
    (repository / "api/requirements.txt").write_text("pypdf==6.20.0")
    (repository / "experiments/workouts-capacity/Dockerfile").write_text("FROM scratch")
    files = plan.prepare_context(repository, tmp_path / "context")
    assert set(files) == {
        "Dockerfile",
        "api/requirements.txt",
        "api/app/source.py",
        "api/migrations/source.py",
        "capacity/source.py",
    }
    with pytest.raises(RuntimeError):
        plan.prepare_context(repository, tmp_path / "context")


async def test_synthetic_http_keeps_workout_payload_path_and_blocks_unknown_egress():
    transport = ProviderTransport(delay=0)
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json={
                "model": "fixture",
                "messages": [
                    {
                        "role": "system",
                        "content": "You extract workout prescriptions from untrusted source material.",
                    },
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": "provided_text"}],
                    },
                ],
            },
        )
        body = json.loads(response.json()["choices"][0]["message"]["content"])
        assert body["blocks"][0]["exercises"][0]["sets"] == 3
        with pytest.raises(RuntimeError, match="blocked"):
            await client.get("https://private.example.test")
        with pytest.raises(RuntimeError, match="blocked"):
            await client.post("https://api.openai.com/v1/unrecognized", json={})
    assert transport.calls["extraction"] == 1


def test_real_fixture_pdf_images_and_near_body_are_bounded_deterministic(tmp_path):
    from PIL import Image
    from pypdf import PdfReader

    first = generate(tmp_path / "one", media=False)
    second = generate(tmp_path / "two", media=False)
    assert first == second
    assert first["near-body.json"]["bytes"] < 3 * 1024 * 1024
    assert len(PdfReader(tmp_path / "one/source-30.pdf").pages) == 30
    assert "Squat" in PdfReader(tmp_path / "one/source-1.pdf").pages[0].extract_text()
    with Image.open(tmp_path / "one/image-limit.jpg") as image:
        assert image.width * image.height == 4_000_000
    with Image.open(tmp_path / "one/cover.jpg") as image:
        assert image.width * image.height == 16_000_000


def test_numeric_metrics_report_stop_without_reading_commands_or_environment(tmp_path):
    cg, proc = tmp_path / "cg", tmp_path / "proc"
    cg.mkdir()
    proc.mkdir()
    (cg / "memory.current").write_text(str(460 * 1024 * 1024))
    (cg / "memory.peak").write_text(str(470 * 1024 * 1024))
    (cg / "memory.events").write_text("oom 0\noom_kill 0\n")
    pid = proc / "123"
    pid.mkdir()
    (pid / "status").write_text(
        "Name:\tpython\nPPid:\t1\nVmRSS:\t1024 kB\nVmHWM:\t2048 kB\n"
    )
    (pid / "environ").write_text("must never appear")
    value = metrics.sample(cg, proc)
    assert value["stop_required"] and value["processes"][0]["rss_kib"] == 1024
    assert "must never appear" not in json.dumps(value)


def test_large_export_fixture_remains_inside_normal_content_limit():
    from capacity.fixtures import padding

    content = workout()
    content["notes"] = [padding(4000, n) for n in range(56)]
    assert len(json.dumps(content).encode()) < 240 * 1024


def test_report_never_turns_missing_samples_or_baseline_into_pass():
    from capacity.report import READS, evaluate

    route = {"p95_ms": 100, "p99_ms": 150, "unexpected": 0}
    ordinary = {"routes": {label: dict(route) for label in READS}}
    assert evaluate(ordinary, ordinary, [])["local_gate"] == "blocked"
    samples = [{"memory_peak": 400 * 1024 * 1024, "stop_required": False, "oom": 0}]
    assert evaluate(ordinary, ordinary, samples)["local_gate"] == "passed"
    unsafe = evaluate(
        ordinary, ordinary, [{"memory_peak": 470 * 1024 * 1024, "stop_required": True}]
    )
    assert unsafe["local_gate"] == "failed" and unsafe["r04_closed"] is False
    slow = {"routes": {label: {**route, "p95_ms": 130} for label in READS}}
    assert evaluate(ordinary, slow, samples)["local_gate"] == "failed"


async def test_driver_auth_scope_and_metadata_only_without_network(tmp_path):
    from capacity.driver import Driver
    from capacity.safety import OWNERS

    calls = []

    async def respond(request):
        calls.append(request)
        return httpx.Response(200, json={"private": "do not retain in report"})

    driver = Driver(tmp_path)
    await driver.client.aclose()
    driver.client = httpx.AsyncClient(
        base_url="http://127.0.0.1:18047", transport=httpx.MockTransport(respond)
    )
    try:
        await driver.request("GET", "/scope", OWNERS[1], label="scope")
        await driver.request("GET", "/scope", label="unauth", authenticated=False)
        assert calls[0].headers["X-Hafa-Account-ID"] == OWNERS[1]
        assert calls[0].headers["X-Workouts-Generation"] == "1"
        assert "X-Capacity-User" not in calls[1].headers
        assert "do not retain" not in json.dumps(driver.report())
    finally:
        await driver.client.aclose()


def test_actual_wrapper_imports_in_explicit_fake_environment_without_network_or_startup():
    import subprocess
    import sys

    environment = plan.environment()
    environment["PYTHONPATH"] = "api:experiments/workouts-capacity"
    environment["PATH"] = "/usr/bin:/bin"
    code = """
import socket

def denied(*args, **kwargs):
    raise AssertionError('Network/server operation forbidden in import readiness test')

socket.socket.connect = denied
socket.socket.connect_ex = denied
socket.socket.bind = denied
socket.socket.listen = denied
socket.create_connection = denied
socket.getaddrinfo = denied
import capacity.app as candidate
assert candidate.imports.workout_import_worker.task is None
assert sum(candidate.transport.calls.values()) == 0
from app.domains.workouts.automation_router import imports_router
assert any(getattr(route, 'path', None) == '/api/v1/workouts/imports' for route in imports_router.routes)
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr

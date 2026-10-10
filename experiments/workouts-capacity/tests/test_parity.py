"""Test-only setup fences, never provisions or connects a database/provider."""

import pytest
from capacity import parity


def environment():
    database = "postgresql://postgres:capacity_local_only@127.0.0.1:5432/hafa_workouts_pip_parity_test"
    return {
        "HAFACAPACITY_PARITY_TEST": "1",
        "ENVIRONMENT": "test",
        "OPENAI_API_KEY": parity.FAKE_KEY,
        "DATABASE_URL": database,
        "TEST_DATABASE_URL": database.replace("postgresql:", "postgresql+asyncpg:"),
        "DATABASE_USE_SSL": "false",
        "TEST_BUDGET_AUTHORITY_DATABASE_URL": database.replace(
            "postgresql:", "postgresql+asyncpg:"
        ).replace("_pip_parity_test", "_pip_authority_test"),
    }


def test_parity_scratch_guard_rejects_shared_production_and_override_urls():
    env = environment()
    parity.validate_environment(env)
    for field, value in [
        ("HAFACAPACITY_PARITY_TEST", ""),
        ("ENVIRONMENT", "production"),
        ("OPENAI_API_KEY", "real-key"),
        (
            "DATABASE_URL",
            env["DATABASE_URL"].replace("_pip_parity_test", "_capacity_test"),
        ),
        ("TEST_DATABASE_URL", env["TEST_DATABASE_URL"] + "?host=remote.example"),
        ("DATABASE_URL", env["DATABASE_URL"] + "#other"),
        ("AWS_ACCESS_KEY_ID", "real-key"),
        ("HTTPS_PROXY", "http://proxy"),
        ("TEST_BUDGET_AUTHORITY_DATABASE_URL", env["TEST_DATABASE_URL"]),
        (
            "TEST_BUDGET_AUTHORITY_DATABASE_URL",
            env["TEST_BUDGET_AUTHORITY_DATABASE_URL"] + "?host=remote.example",
        ),
    ]:
        with pytest.raises(RuntimeError):
            parity.validate_environment({**env, field: value})


def test_test_derivative_cannot_upgrade_any_original_runtime_distribution():
    before = {
        "fastapi": "0.122.0",
        "starlette": "0.50.0",
        "openai": "2.8.1",
        "pydantic": "2.12.5",
        "pillow": "12.3.0",
        "pip": "25.0.1",
    }
    assert (
        parity.validate_runtime(before, {**before, "pytest": "9.1.1"})["openai"]
        == "2.8.1"
    )
    with pytest.raises(RuntimeError):
        parity.validate_runtime(before, {**before, "openai": "3.1.0"})
    with pytest.raises(RuntimeError):
        parity.validate_runtime(before, {**before, "pip": "26.2.1"})


def test_socket_guard_blocks_dns_and_nonloopback_before_any_original_call(monkeypatch):
    import socket

    calls = []
    monkeypatch.setattr(socket.socket, "connect", lambda *args: calls.append("connect"))
    monkeypatch.setattr(
        socket.socket, "connect_ex", lambda *args: calls.append("connect_ex")
    )
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args: calls.append("dns"))
    parity.block_external_sockets()
    with socket.socket() as s:
        with pytest.raises(OSError):
            s.connect(("203.0.113.1", 443))
        with pytest.raises(OSError):
            s.connect_ex(("provider.example", 443))
    with pytest.raises(OSError):
        socket.getaddrinfo("provider.example", 443)
    assert calls == []


def test_required_authority_cases_must_pass_call_not_skip_or_only_setup():
    from types import SimpleNamespace

    coverage = parity.AuthorityCoverage()
    for case in parity.REQUIRED_AUTHORITY:
        coverage.pytest_runtest_logreport(
            SimpleNamespace(when="setup", passed=True, nodeid="tests/file.py::" + case)
        )
    assert len(coverage.missing) == 7
    for case in parity.REQUIRED_AUTHORITY:
        coverage.pytest_runtest_logreport(
            SimpleNamespace(when="call", passed=True, nodeid="tests/file.py::" + case)
        )
    assert coverage.missing == []


def test_test_image_context_uses_only_tracked_files_and_rejects_dotenv(tmp_path):
    import subprocess

    repo = tmp_path / "repo"
    for name in (
        "api/tests/conftest.py",
        "api/pyproject.toml",
        "experiments/workouts-capacity/test-tools.txt",
        "experiments/workouts-capacity/Dockerfile.parity",
    ):
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture")
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    private = repo / "api/tests/.env.production"
    private.write_text("must never enter image")
    files = parity.prepare_context(repo, tmp_path / "context")
    assert set(files) == {
        "api/tests/conftest.py",
        "api/pyproject.toml",
        "test-tools.txt",
        "Dockerfile",
    }
    subprocess.run(
        ["git", "-C", str(repo), "add", "api/tests/.env.production"], check=True
    )
    with pytest.raises(RuntimeError, match="Unsafe tracked"):
        parity.prepare_context(repo, tmp_path / "unsafe")
    assert not (tmp_path / "unsafe").exists()

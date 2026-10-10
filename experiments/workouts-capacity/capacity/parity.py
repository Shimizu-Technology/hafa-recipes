"""Explicit test-only pip-graph gate. Never imported by production or capacity API."""

import importlib.metadata
import ipaddress
import json
import os
import socket
from pathlib import Path
from urllib.parse import urlparse

DATABASE = "hafa_workouts_pip_parity_test"
FAKE_KEY = "capacity-not-a-provider-credential"
FILES = [
    "tests/test_request_context.py",
    "tests/test_workouts_bulk_ingress.py",
    "tests/test_workouts_export_snapshots.py",
    "tests/test_workouts_export_response_gate.py",
    "tests/test_workouts_export_assembly.py",
    "tests/test_workouts_activity_log.py",
    "tests/test_mobile_contract_compatibility.py",
    "tests/test_thumbnail_memory.py",
    "tests/test_thumbnail_normalization.py",
    "tests/test_storage.py",
    "tests/test_cover_selection.py",
]


def validate_environment(env):
    if (
        env.get("HAFACAPACITY_PARITY_TEST") != "1"
        or env.get("ENVIRONMENT") != "test"
        or env.get("OPENAI_API_KEY") != FAKE_KEY
    ):
        raise RuntimeError("Explicit test-only parity environment required")
    for key in ("DATABASE_URL", "TEST_DATABASE_URL"):
        value = urlparse(env.get(key, ""))
        if (
            value.scheme not in {"postgresql", "postgresql+asyncpg"}
            or value.hostname != "127.0.0.1"
            or value.port != 5432
            or value.path != "/" + DATABASE
            or value.username != "postgres"
            or value.password != "capacity_local_only"
            or value.query
            or value.fragment
        ):
            raise RuntimeError("Own loopback parity scratch database required")
    if env.get("DATABASE_USE_SSL") != "false":
        raise RuntimeError("Explicit test database SSL setting required")
    for key in (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "SENTRY_DSN",
        "CLERK_SECRET_KEY",
        "YTDLP_PROXY_URL",
        "YTDLP_COOKIES_FILE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "WORKOUTS_DEVELOPMENT_AI_API_KEY",
    ):
        if env.get(key):
            raise RuntimeError("External service credentials/proxies forbidden")


def validate_runtime(before, installed):
    if not before or any(
        installed.get(name) != version for name, version in before.items()
    ):
        raise RuntimeError("Production runtime package graph changed")
    required = {
        "fastapi": "0.122.0",
        "starlette": "0.50.0",
        "openai": "2.8.1",
        "pydantic": "2.12.5",
    }
    if any(installed.get(name) != version for name, version in required.items()):
        raise RuntimeError("Unexpected production runtime versions")
    return required


def block_external_sockets():
    original = socket.socket.connect
    original_ex = socket.socket.connect_ex
    original_resolve = socket.getaddrinfo

    def checked(address):
        if not isinstance(address, tuple) or not isinstance(address[0], str):
            raise OSError("Only loopback test database sockets permitted")
        try:
            allowed = ipaddress.ip_address(address[0]).is_loopback
        except ValueError:
            allowed = False
        if not allowed:
            raise OSError("External network forbidden in parity tests")

    def connect(self, address):
        checked(address)
        return original(self, address)

    def connect_ex(self, address):
        checked(address)
        return original_ex(self, address)

    def resolve(host, *args, **kwargs):
        if host not in {None, "localhost"}:
            checked((host, 0))
        return original_resolve(host, *args, **kwargs)

    socket.socket.connect, socket.socket.connect_ex = connect, connect_ex
    socket.getaddrinfo = resolve


def main():
    validate_environment(os.environ)
    before = json.loads(Path("/runtime-before.json").read_text())
    installed = {
        d.metadata["Name"].lower(): d.version
        for d in importlib.metadata.distributions()
    }
    graph = validate_runtime(before, installed)
    block_external_sockets()
    import pytest

    result = pytest.main(["-c", "/api/pyproject.toml", "-q", "--tb=short", *FILES])
    print(
        json.dumps(
            {
                "test_only": True,
                "production_graph_unchanged": True,
                "versions": graph,
                "exit_code": int(result),
                "provider_acceptance": False,
                "capacity_acceptance": False,
            }
        )
    )
    raise SystemExit(result)


def prepare_context(repository, output):
    """Copy only tracked tests/tooling; never local configs, caches or symlinks."""
    import shutil
    import subprocess

    repository, output = Path(repository).resolve(), Path(output).resolve()
    if output.exists():
        raise RuntimeError("New parity context required")
    names = (
        subprocess.check_output(
            [
                "git",
                "-C",
                str(repository),
                "ls-files",
                "-z",
                "--",
                "api/tests",
                "api/pyproject.toml",
                "experiments/workouts-capacity/test-tools.txt",
                "experiments/workouts-capacity/Dockerfile.parity",
            ]
        )
        .decode()
        .split("\0")
    )
    names = [n for n in names if n]
    required = {
        "api/tests/conftest.py",
        "api/pyproject.toml",
        "experiments/workouts-capacity/test-tools.txt",
        "experiments/workouts-capacity/Dockerfile.parity",
    }
    if not required <= set(names):
        raise RuntimeError("Tracked parity setup incomplete")
    mapping = []
    for name in names:
        source = repository / name
        if (
            source.is_symlink()
            or not source.resolve().is_relative_to(repository)
            or not source.is_file()
            or any(
                p.startswith(".env")
                or p in {".git", ".venv", "__pycache__", "node_modules"}
                for p in Path(name).parts
            )
        ):
            raise RuntimeError("Unsafe tracked parity file")
        target = name.removeprefix("experiments/workouts-capacity/")
        if target == "Dockerfile.parity":
            target = "Dockerfile"
        mapping.append((source, target))
    output.mkdir(parents=True)
    for source, name in mapping:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return [name for _, name in mapping]


if __name__ == "__main__":
    main()

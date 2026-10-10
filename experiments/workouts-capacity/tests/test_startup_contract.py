"""Actual public liveness schema plus finite coordinator startup, no Docker."""

import json
from types import SimpleNamespace

import pytest
from capacity.ci_run import Coordinator
from capacity.ci_safety import SafetyError, public_receipt


def configured(tmp_path, value, monkeypatch):
    coordinator = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    coordinator.image = "sha256:" + "a" * 64
    coordinator.pg = "b" * 64
    coordinator.plan_root = tmp_path
    coordinator.run_id = "ci-123-1"
    info = {
        "Image": coordinator.image,
        "HostConfig": {
            "Memory": 512 * 2**20,
            "MemorySwap": 512 * 2**20,
            "NanoCpus": 500_000_000,
        },
        "State": {"Running": True, "OOMKilled": False},
    }
    coordinator.ledger = SimpleNamespace(
        create_container=lambda *args: "c" * 64, inspect=lambda _: info
    )
    coordinator.command = lambda *args, **kwargs: value
    clock = iter([0, 0, 61])
    monkeypatch.setattr("capacity.ci_run.time.monotonic", lambda: next(clock))
    monkeypatch.setattr("capacity.ci_run.time.sleep", lambda _: None)
    return coordinator, info


def test_startup_accepts_exact_actual_mounted_liveness_handler(tmp_path, monkeypatch):
    import asyncio

    import httpx
    from fastapi import FastAPI

    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://postgres:capacity_local_only@127.0.0.1:5432/hafa_workouts_capacity_test",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "capacity-not-a-provider-credential")
    monkeypatch.setenv("DATABASE_USE_SSL", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    from app.routers.health import router

    application = FastAPI()
    application.include_router(router)

    async def actual_request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application),
            base_url="http://capacity.invalid",
        ) as client:
            response = await client.get("/up")
            assert response.status_code == 200
            return response.text

    try:
        actual_response = asyncio.run(
            actual_request()
        )  # In-process mounted handler; no sockets/lifespan/DB calls.
        assert json.loads(actual_response) == {"status": "ok"}
        coordinator, _ = configured(tmp_path, actual_response, monkeypatch)
        coordinator.start_api("baseline")
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize(
    "value",
    [
        '{"status":"healthy"}',
        '{"status":"degraded"}',
        '{"status":"ok","dependencies":{}}',
        '{"status":true}',
        "[]",
        "null",
        '{"truncated":',
    ],
)
def test_unhealthy_wrong_shape_or_diagnostic_response_cannot_start_traffic(
    tmp_path, value, monkeypatch
):
    coordinator, _ = configured(tmp_path, value, monkeypatch)
    with pytest.raises(SafetyError, match="api_startup_deadline"):
        coordinator.start_api("baseline")


@pytest.mark.parametrize("change", ["stopped", "oom", "image", "memory", "swap", "cpu"])
def test_stopped_oom_or_wrong_budget_image_remains_refused(
    tmp_path, change, monkeypatch
):
    coordinator, info = configured(tmp_path, '{"status":"ok"}', monkeypatch)
    if change == "stopped":
        info["State"]["Running"] = False
    elif change == "oom":
        info["State"]["OOMKilled"] = True
    elif change == "image":
        info["Image"] = "sha256:" + "d" * 64
    else:
        info["HostConfig"][
            {"memory": "Memory", "swap": "MemorySwap", "cpu": "NanoCpus"}[change]
        ] += 1
    with pytest.raises(SafetyError):
        coordinator.start_api("baseline")


def test_failure_code_is_fixed_and_primary_cause_survives_cleanup(tmp_path):
    coordinator = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    coordinator.active_phase = "baseline"
    coordinator.record_failure(SafetyError("api_startup_deadline"))
    coordinator.record_failure(
        RuntimeError("private health bearer http://private.invalid"),
        phase="cleanup",
        fallback="cleanup_failed",
    )
    failure = public_receipt(coordinator.summary)["failure"]
    assert failure == {"code": "api_startup_deadline", "phase": "baseline"}
    other = Coordinator(tmp_path, tmp_path / "other", tmp_path / "other.json")
    other.record_failure(RuntimeError("private health bearer http://private.invalid"))
    encoded = json.dumps(public_receipt(other.summary))
    assert "private" not in encoded and "unexpected_failure" in encoded
    with pytest.raises(SafetyError, match="invalid_public_failure"):
        public_receipt({"failure": {"code": "Bearer secret", "phase": "baseline"}})
    with pytest.raises(SafetyError, match="invalid_public_failure"):
        public_receipt(
            {"failure": {"code": "api_startup_deadline", "phase": "private-id"}}
        )

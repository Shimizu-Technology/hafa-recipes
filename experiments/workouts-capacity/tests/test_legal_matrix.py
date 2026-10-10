"""Finite matrix fixtures/admission/receipts; no Docker or runtime traffic."""

import json
from types import SimpleNamespace

import pytest
from capacity.ci_safety import READS, public_receipt
from capacity.legal_ci import receipt
from capacity.legal_contract import BOOLEANS, CASES, COUNTS, case_passed
from capacity.legal_fixtures import SPECS, generate
from PIL import Image


def passed(case):
    return {
        **dict.fromkeys(BOOLEANS, True),
        "normalized": COUNTS[case],
        "stored": COUNTS[case],
        "distinct_recipe_count": COUNTS[case],
        "normalizer_peak": 2,
        "frames": 1,
        "scene_calls": 1,
        "scene_child_count": 1,
    }


def test_exact_legal_dimensions_and_bytes_preserve_alpha_exif_and_nonblank(tmp_path):
    manifest = generate(tmp_path)
    assert set(manifest) == set(SPECS)
    assert manifest["rgba40"]["pixels"] == 40_000_000
    assert manifest["palette40"]["pixels"] == 40_000_000
    assert manifest["wide40"]["pixels"] == 39_996_000
    assert manifest["wide40"]["width"] == 12_000
    for name, row in manifest.items():
        assert row["bytes"] <= 10 * 2**20
        from app.image_validation import validate_image_bytes

        data = (tmp_path / f"{name}.png").read_bytes()
        validated = validate_image_bytes(
            data, max_bytes=10 * 2**20, declared_content_type="image/png"
        )
        assert validated.data is data and validated.content_type == "image/png"
        assert (validated.width, validated.height) == SPECS[name][:2]
        with Image.open(tmp_path / f"{name}.png") as image:
            assert image.format == "PNG" and image.mode == SPECS[name][2]
            assert image.getexif()[274] == 6
            pixels = [
                image.getpixel((0, image.height - 1)),
                image.getpixel((image.width // 2, image.height // 2)),
                image.getpixel((max(16, image.width // 64) - 1, image.height - 1)),
            ]
            assert len(set(pixels)) > 1
            if image.mode == "RGBA":
                assert {pixel[3] for pixel in pixels} >= {0, 255}
            else:
                assert {0, 128, 255} <= set(image.info["transparency"])


@pytest.mark.parametrize("case", CASES)
def test_case_requires_actual_outputs_settlement_and_overlap(case):
    row = passed(case)
    assert case_passed(case, row)
    assert not case_passed(case, {**row, "children_settled": False})
    assert not case_passed(case, {**row, "media_permits_restored": False})
    assert not case_passed(case, {**row, "normalizers_settled": False})
    if "ffmpeg" in case:
        assert not case_passed(case, {**row, "ffmpeg_overlap_observed": False})
    if case.startswith("two_") or case == "burst":
        assert not case_passed(case, {**row, "normalizer_peak": 1})
    if case.startswith("cancel_"):
        assert not case_passed(case, {**row, "cancelled": False})


def test_receipt_no_threshold_relaxation_and_no_partial_success():
    routes = {
        name: {
            "count": 8,
            "unexpected": 0,
            "statuses": {"200": 8},
            "p95_ms": 100,
            "p99_ms": 200,
        }
        for name in READS
    }
    report = {
        "completed": True,
        "routes": routes,
        "cases": {case: passed(case) for case in CASES},
    }
    samples = [{"memory_peak": 410 * 2**20, "memory_current": 100}]
    baseline = {"routes": routes}
    assert receipt(report, samples, baseline)["passed"]
    assert not receipt(
        report, [{"memory_peak": 410 * 2**20 + 1, "memory_current": 100}], baseline
    )["passed"]
    assert not receipt({**report, "completed": False}, samples, baseline)["passed"]
    assert not receipt({**report, "cases": {}}, samples, baseline)["passed"]
    slower = {**routes, "/up": {**routes["/up"], "p95_ms": 126}}
    assert not receipt({**report, "routes": slower}, samples, baseline)["passed"]
    assert not receipt(report, [{**samples[0], "oom": 1}], baseline)["passed"]


def test_public_matrix_never_copies_identifiers_bodies_or_unknown_fields():
    secret = "private-identifier-body"
    summary = {
        "cleaned_owned_resources": True,
        "phases": {
            "legal": {
                "cases": {
                    case: {**passed(case), "source": secret, "recipe_id": secret}
                    for case in CASES
                },
                "urls": [secret],
            }
        },
    }
    result = public_receipt(summary)
    assert secret not in json.dumps(result)
    assert len(result["phases"]["legal"]["cases"]) == len(CASES)


@pytest.mark.asyncio
async def test_routes_absent_without_explicit_flag_and_unknown_case_refused(
    monkeypatch,
):
    from capacity.legal_ops import OperationRequest, install
    from fastapi import FastAPI
    from pydantic import ValidationError

    app = FastAPI()
    monkeypatch.delenv("CAPACITY_LEGAL_MATRIX", raising=False)
    install(app, lambda: None, SimpleNamespace(), SimpleNamespace())
    assert not any(route.path.startswith("/capacity/legal") for route in app.routes)
    with pytest.raises(ValidationError):
        OperationRequest(case="../../private")
    with pytest.raises(ValidationError):
        OperationRequest(case="single_rgba", path="/private")
    monkeypatch.setenv("CAPACITY_LEGAL_MATRIX", "true")
    monkeypatch.setenv("WORKOUTS_API_ENABLED", "true")
    with pytest.raises(RuntimeError, match="OFF"):
        install(app, lambda: None, SimpleNamespace(), SimpleNamespace())


@pytest.mark.asyncio
async def test_actual_executor_observed_even_without_contextvar_propagation(
    tmp_path, monkeypatch
):
    import asyncio
    import time

    from capacity.legal_ops import OperationRequest, install
    from fastapi import FastAPI

    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://postgres:capacity_local_only@127.0.0.1:5432/hafa_workouts_capacity_test",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "capacity-not-a-provider-credential")
    monkeypatch.setenv("DATABASE_USE_SSL", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    from app.services import storage as module
    from app.services.storage import StorageService

    monkeypatch.setenv("CAPACITY_LEGAL_MATRIX", "true")
    monkeypatch.setenv("WORKOUTS_API_ENABLED", "false")
    generate(tmp_path, {name: (256, 256, mode) for name, (_, _, mode) in SPECS.items()})
    rendered = []
    original = module.normalize_thumbnail_variants

    def actual_render(*args, **kwargs):
        # Allow event-loop cancellation to arrive during the real worker job.
        time.sleep(0.03)
        result = original(*args, **kwargs)
        rendered.append(True)
        return result

    monkeypatch.setattr(module, "normalize_thumbnail_variants", actual_render)
    original_spawn = asyncio.create_subprocess_exec

    class Storage:
        _prepare_thumbnail_variants = StorageService._prepare_thumbnail_variants

        async def _store_thumbnail_variants(self, variants, recipe_id, **kwargs):
            assert set(variants) == {"hero", "list"}
            return f"https://capacity.invalid/{recipe_id}"

    async def scene(*args, **kwargs):
        return []

    video = SimpleNamespace(
        _write_scene_change_frames=scene, _media_slots=asyncio.BoundedSemaphore(1)
    )
    app = FastAPI()
    try:
        install(app, lambda: None, Storage(), video, tmp_path)
        endpoint = next(
            route.endpoint
            for route in app.routes
            if route.path == "/capacity/legal/operation"
        )
        pair = await asyncio.wait_for(endpoint(OperationRequest(case="two_rgba")), 5)
        assert pair["normalizer_peak"] == 2 and pair["distinct_recipe_count"] == 2
        assert pair["normalizers_settled"] and len(rendered) == 2
        cancellation = await asyncio.wait_for(
            endpoint(OperationRequest(case="cancel_normalizer")), 5
        )
        assert cancellation["cancelled"] and cancellation["normalizers_settled"]
        assert cancellation["stored"] == 0 and len(rendered) == 3
        # Cancellation didn't leak the probe or poison the next operation.
        single = await endpoint(OperationRequest(case="single_rgba"))
        assert single["normalized"] == 1 and single["normalizer_peak"] == 1
    finally:
        asyncio.create_subprocess_exec = original_spawn
        get_settings.cache_clear()


def test_separate_peak_and_ffmpeg_witness_cannot_prove_two_decoder_overlap():
    from capacity.legal_ops import Probe

    probe = Probe()
    probe.peak = 2
    probe.decoder_active = 1
    probe.children.append(SimpleNamespace(returncode=None))
    with probe.lock:
        probe.observe_overlap()
    assert probe.overlap and not probe.two_ffmpeg_overlap
    assert not case_passed(
        "rgba_ffmpeg",
        {**passed("rgba_ffmpeg"), "two_normalizers_ffmpeg_overlap_observed": False},
    )
    probe.decoder_active = 2
    with probe.lock:
        probe.observe_overlap()
    assert probe.two_ffmpeg_overlap
    probe2 = Probe()
    probe2.decoder_active = 2
    probe2.children.append(SimpleNamespace(returncode=0))
    with probe2.lock:
        probe2.observe_overlap()
    assert not probe2.two_ffmpeg_overlap


def test_interrupted_atomic_snapshot_preserves_prior_cases(tmp_path, monkeypatch):
    from capacity.legal_driver import write_snapshot

    output = tmp_path / "report.json"
    write_snapshot(output, {"cases": {"single_rgba": passed("single_rgba")}})

    def interrupted(*args):
        raise OSError("Interrupted before atomic replacement")

    monkeypatch.setattr("capacity.legal_driver.os.replace", interrupted)
    with pytest.raises(OSError):
        write_snapshot(output, {"cases": {}})
    assert json.loads(output.read_text())["cases"]["single_rgba"]["completed"]


def test_partial_legal_receipt_recovers_trace_and_oom(tmp_path):
    from capacity.legal_ci import LegalCoordinator

    coordinator = LegalCoordinator(
        tmp_path, tmp_path / "private", tmp_path / "receipt.json"
    )
    coordinator.plan_root = tmp_path
    coordinator.active_phase = "legal"
    coordinator.api = "a" * 64
    coordinator.ledger = SimpleNamespace(
        state={"containers": {"api": coordinator.api}},
        inspect=lambda _: {"State": {"OOMKilled": True}},
    )
    coordinator.baseline = {
        "routes": {route: {"p95_ms": 100, "p99_ms": 200} for route in READS}
    }
    (tmp_path / "results").mkdir()
    root = tmp_path / "results"
    (root / "legal.json").write_text('{"broken":')
    (root / "legal.json.requests.jsonl").write_text(
        json.dumps(
            {
                "timestamp": 2,
                "event": "end",
                "route": "/up",
                "milliseconds": 170,
                "status": 200,
            }
        )
        + "\n"
    )
    (root / "legal-external.jsonl").write_text(
        json.dumps(
            {
                "timestamp": 1,
                "memory_current": 1,
                "memory_peak": 470 * 2**20,
                "oom": 1,
                "stages": [
                    {
                        "stage": "legal_case",
                        "event": "start",
                        "timestamp": 1,
                        "case_index": 3,
                    }
                ],
            }
        )
        + "\n"
    )
    coordinator.capture_partial()
    row = coordinator.summary["phases"]["legal"]
    assert not row["passed"] and row["container_oom_killed"]
    assert row["routes"]["/up"]["count"] == 1
    assert row["timeline"]["stages"][0]["case_index"] == 3
    result = public_receipt(coordinator.summary)
    assert result["phases"]["legal"]["container_oom_killed"]

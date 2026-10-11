"""Finite protocol/receipt tests; mocks do not establish hosted acceptance."""

import asyncio
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from capacity.ci_safety import SafetyError
from capacity.export_jobs_diagnostic_ci import BRANCH, ExportJobsCoordinator
from capacity.export_jobs_diagnostic_contract import OUTCOME_BOOLEANS, READS, ROUTES
from capacity.export_jobs_diagnostic_driver import (
    JobProbeFailure,
    JobsProbe,
    checked_job,
    ready_proof,
)
from capacity.export_jobs_diagnostic_prescriptions import (
    PrescriptionProof,
    expected_content,
    expected_prescriptions,
)
from capacity.export_jobs_diagnostic_receipt import receipt, summarize
from capacity.plan import build_plan
from test_export_diagnostic import observations, report_fixture


def checks(status=5):
    return {
        "job_count": 1,
        "status_code": status,
        "slot_rows": 1,
        "active_slot_count": 0,
        "actual_end_ack_count": 1,
        "ack_completion_ms": 1800,
        "deadline_window_ms": 120000,
        "expiry_window_ms": 600000,
        "snapshot_count": 0 if status == 5 else 1,
        "page_count": 0 if status == 5 else 19,
        "running_registry_count": 0,
        "worker_active_task_count": 0,
        "worker_active_execution_count": 0,
        "worker_pending_ack_count": 0,
        "worker_heartbeat_task_count": 0,
        "worker_retirement_task_count": 0,
        "source_frames_retired": True,
        "global_slot_idle": True,
    }


def report():
    value = report_fixture()
    value["routes"].pop("workouts/export-build")
    value["routes"].pop("workouts/export-remove")
    for key, status, count in [
        ("workouts/export-admit", "202", 1),
        ("workouts/export-status", "200", 1),
        ("workouts/export-cancel", "200", 1),
        ("workouts/export-observe", "200", 1),
    ]:
        value["routes"][key] = {
            "count": count,
            "unexpected": 0,
            "statuses": {status: count},
            "p95_ms": 10,
            "p99_ms": 10,
        }
    value["job_outcome"] = {
        **dict.fromkeys(OUTCOME_BOOLEANS, True),
        "admission_ms": 10,
        "poll_count": 1,
        "ready_observed_ms": 4000,
        "pages_read": 19,
        "workouts_rows": 190,
        "versions_rows": 190,
        "dataset_count": 2,
        "total_rows": 380,
        "wire_bytes": 100,
    }
    value["metrics"]["job_checks"] = checks()
    value["metrics"]["spans"] = [
        {
            "stage": "build_total",
            "offset_ms": 0,
            "duration_ms": 100,
            "query_count": 100,
            "sync_thread_cpu_ms": 0,
            "failed": False,
        }
    ]
    value["spans"] = [
        {"route": route, "offset_ms": offset, "duration_ms": 10, "status": 200}
        for route in sorted(READS)
        for offset in [1010, 2005, *[4000 + index * 100 for index in range(78)]]
    ] + [
        {
            "route": "workouts/export-page",
            "offset_ms": 2000 + index * 50,
            "duration_ms": 20,
            "status": 200,
        }
        for index in range(19)
    ]
    return value


def analyze(value):
    return summarize(
        value,
        observations(),
        {"completed": True, "local_memory_gate": "passed"},
        {
            "recipe_active": 0,
            "workout_active": 0,
            "extract_jobs": 0,
            "cover_jobs": 0,
            "export_snapshots": 0,
            "export_pages": 0,
        },
        False,
    )


def test_positive_receipt_requires_actual_ack_and_keeps_sync_failure_separate():
    value = report()
    data = analyze(value)
    assert data["complete"] and data["safety_passed"] and data["latency_slos_passed"]
    safe = receipt({"cleaned_owned_resources": True}, data)
    assert safe["passed"] and "diagnostic" not in safe
    assert (
        not safe["r04_closed"]
        and not safe["render_parity"]
        and not safe["provider_quality"]
    )
    assert set(safe["background_export_diagnostic"]["routes"]) == ROUTES


@pytest.mark.parametrize(
    "field,value",
    [
        ("actual_end_ack_count", 0),
        ("active_slot_count", 1),
        ("source_frames_retired", False),
        ("worker_active_task_count", 1),
        ("worker_heartbeat_task_count", 1),
        ("worker_retirement_task_count", 1),
        ("worker_pending_ack_count", 1),
        ("snapshot_count", 1),
        ("page_count", 19),
        ("status_code", 4),
    ],
)
def test_final_completion_refuses_missing_end_or_drain(field, value):
    candidate = report()
    assert analyze(candidate)["complete"]
    candidate["metrics"]["job_checks"][field] = value
    assert not analyze(candidate)["complete"]


@pytest.mark.parametrize(
    "route", ["workouts/export-admit", "workouts/export-cancel", "recipes/chat", *READS]
)
def test_absolute_slos_are_not_waived_by_successful_completion(route):
    candidate = report()
    candidate["routes"][route]["p95_ms"] = 1001 if route not in READS else 501
    data = analyze(candidate)
    assert data["complete"] and not data["latency_slos_passed"]


def test_original_database_completion_deadline_and_admission_duration_are_both_required():
    candidate = report()
    candidate["metrics"]["job_checks"]["ack_completion_ms"] = 120001
    assert not analyze(candidate)["completion_slo_passed"]
    candidate = report()
    candidate["job_outcome"]["admission_ms"] = 1001
    assert not analyze(candidate)["admission_slo_passed"]
    candidate = report()
    candidate["metrics"]["job_checks"]["deadline_window_ms"] = 180000
    assert not analyze(candidate)["complete"]


def test_numeric_whitelist_excludes_private_ids_dates_content_and_keeps_unknown_unknown():
    data = analyze(report())
    for key in ("job_checks", "job_outcome"):
        data[key].update(
            job_id="PRIVATE_ID",
            admitted_at="PRIVATE_TIMESTAMP",
            token="PRIVATE_KEY",
            profile="PRIVATE_BODY",
        )
    safe = json.dumps(receipt({"cleaned_owned_resources": True}, data))
    assert "PRIVATE" not in safe
    data["job_checks"] = {}
    unknown = receipt({"cleaned_owned_resources": True}, data)[
        "background_export_diagnostic"
    ]["job_checks"]
    assert (
        unknown["global_slot_idle"] is None and unknown["source_frames_retired"] is None
    )
    data["driver_failure_code"] = "raw provider failure text"
    with pytest.raises(SafetyError):
        receipt({}, data)


def test_ready_proof_allows_only_scalar_postcommit_ack_metadata_until_final_drain():
    value = checks(4)
    value["worker_pending_ack_count"] = 1
    assert ready_proof(value)
    value["worker_heartbeat_task_count"] = 1
    assert not ready_proof(value)


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", [None, "notes", "reps"])
async def test_driver_actual_http_adapter_reads_complete_history_then_cancels_same_handle(
    monkeypatch, tmp_path, corruption
):
    from capacity import export_jobs_diagnostic_driver as module

    sleeps, requests = [], []
    admitted = datetime.now(timezone.utc)
    identifier = "00000000-0000-4000-8000-000000000001"
    snapshot = "00000000-0000-4000-8000-000000000002"
    request_id = None

    async def sleep(seconds):
        sleeps.append(seconds)

    def job(status):
        return {
            "schema_version": 1,
            "generation": 1,
            "id": identifier,
            "request_id": request_id,
            "status": status,
            "admitted_at": admitted.isoformat(),
            "deadline_at": (admitted + timedelta(seconds=120)).isoformat(),
            "expires_at": (admitted + timedelta(seconds=600)).isoformat(),
            "cleanup_pending": False,
            "manifest": {
                "schema_version": 1,
                "id": snapshot,
                "generation": 1,
                "page_size": 10,
                "page_count": 19,
                "totals": {"workouts": 190, "workout_versions": 190},
            }
            if status == "ready"
            else None,
        }

    async def serve(request):
        nonlocal request_id
        requests.append((request.method, request.url.path))
        assert request.headers["X-Hafa-Account-ID"] == "capacity-22"
        assert request.headers["X-Workouts-Generation"] == "1"
        if request.method == "POST" and request.url.path.endswith("/jobs"):
            request_id = json.loads(request.content)["request_id"]
            return httpx.Response(202, json=job("queued"))
        if request.url.path.endswith("/build-start"):
            return httpx.Response(200, json={"build_started": True})
        if request.url.path.endswith("/cancel"):
            return httpx.Response(200, json=job("cancelled"))
        if request.url.path.endswith("/" + identifier):
            return httpx.Response(200, json=job("ready"))
        if request.url.path == "/capacity/export-jobs-diagnostic":
            return httpx.Response(200, json={"job_checks": checks(4)})
        page = int(request.url.path.rsplit("/", 1)[1])
        body = {
            "snapshot_id": snapshot,
            "page": page,
            "page_count": 19,
            "export": {
                "offset": page * 10,
                "limit": 10,
                "schema_version": 1,
                "enrollment": {"generation": 1},
                "profile_revision": 0,
                "profile": None,
                "grants": [],
                "ai_consent": None,
                "totals": {"workouts": 190, "workout_versions": 190},
                "has_more": {"workouts": page < 18, "workout_versions": page < 18},
                "datasets": {
                    name: [
                        {
                            "id": f"{name}-{index}",
                            "workout_id": f"workouts-{index}"
                            if name == "workout_versions"
                            else None,
                            "revision": 1,
                            "content": {
                                **expected_content(index),
                                "id": f"workouts-{index}",
                            },
                        }
                        for index in range(page * 10, (page + 1) * 10)
                    ]
                    for name in ("workouts", "workout_versions")
                },
            },
        }
        if page == 0 and corruption:
            target = "workouts" if corruption == "notes" else "workout_versions"
            assert len(body["export"]["datasets"][target]) == 10
            content = body["export"]["datasets"][target][0]["content"]
            if corruption == "notes":
                content["notes"][0] = content["notes"][0][:-1]
            else:
                content["blocks"][0]["exercises"][0]["reps_min"] += 1
            assert body["export"]["totals"] == {
                "workouts": 190,
                "workout_versions": 190,
            }
        return httpx.Response(200, json=body)

    monkeypatch.setattr(module.asyncio, "sleep", sleep)
    probe = JobsProbe()
    await probe.client.aclose()
    probe.client = httpx.AsyncClient(
        base_url="http://fixture.invalid", transport=httpx.MockTransport(serve)
    )
    probe.begin_trace(tmp_path / "private.json")
    try:
        if corruption:
            with pytest.raises(JobProbeFailure, match="pages_failed"):
                await probe.export()
            assert not probe.outcome.get("prescriptions_matched")
            assert not any(path.endswith("/cancel") for _, path in requests)
            return
        await probe.export()
        assert sleeps == [48, 4]
        assert (
            sum(
                method == "POST" and path.endswith("/jobs") for method, path in requests
            )
            == 1
        )
        assert requests[-1] == (
            "POST",
            "/api/v1/workouts/export/jobs/" + identifier + "/cancel",
        )
        assert (
            probe.outcome["versions_rows"] == 190
            and probe.outcome["workouts_rows"] == 190
        )
        assert (
            probe.outcome["all_totals_matched"] and probe.outcome["same_job_cancelled"]
        )
        assert probe.outcome["prescriptions_matched"]
        assert len(probe.spans) == 23 and not probe.pending
    finally:
        probe.trace_stream.close()
        await probe.client.aclose()


def test_identity_and_original_deadline_parser_refuse_refreshed_or_foreign_handles():
    now = datetime.now(timezone.utc)
    value = {
        "schema_version": 1,
        "generation": 1,
        "request_id": "original",
        "id": "00000000-0000-4000-8000-000000000001",
        "status": "queued",
        "cleanup_pending": False,
        "manifest": None,
        "admitted_at": now.isoformat(),
        "deadline_at": (now + timedelta(seconds=120)).isoformat(),
        "expires_at": (now + timedelta(seconds=600)).isoformat(),
    }
    assert checked_job(value, "original") == value
    for patch in (
        {"request_id": "replacement"},
        {"generation": True},
        {"id": "../private"},
        {"manifest": {"secret": "body"}},
    ):
        with pytest.raises(JobProbeFailure):
            checked_job({**value, **patch}, "original")
    with pytest.raises(JobProbeFailure, match="deadline"):
        checked_job(
            {**value, "deadline_at": (now + timedelta(seconds=121)).isoformat()},
            "original",
        )
    refreshed = {
        **value,
        **{
            key: (
                datetime.fromisoformat(value[key]) + timedelta(seconds=10)
            ).isoformat()
            for key in ("admitted_at", "deadline_at", "expires_at")
        },
    }
    with pytest.raises(JobProbeFailure, match="deadline"):
        checked_job(refreshed, "original", value["id"], original=value)


def test_independent_prescription_relationship_and_coverage_are_not_replaced_by_counts():
    expected = expected_prescriptions()
    proof = PrescriptionProof(expected)
    content = {**expected_content(0), "id": "workout-zero"}
    proof.page(
        {"workouts": [{"id": "workout-zero", "revision": 1, "content": content}]}
    )
    assert not proof.complete()
    with pytest.raises(ValueError, match="relationship"):
        proof.page(
            {
                "workout_versions": [
                    {
                        "id": "version-zero",
                        "workout_id": "foreign-workout",
                        "revision": 1,
                        "content": content,
                    }
                ]
            }
        )
    with pytest.raises(ValueError, match="history"):
        proof.page(
            {
                "workouts": [
                    {
                        "id": "different-workout",
                        "revision": 1,
                        "content": {**content, "id": "different-workout"},
                    }
                ]
            }
        )


def test_new_coordinator_and_workflow_are_separate_and_inherit_owned_cleanup(tmp_path):
    root = Path(__file__).resolve().parents[3]
    coordinator = ExportJobsCoordinator(root, tmp_path / "work", tmp_path / "receipt")
    assert coordinator.app_module.endswith("export_jobs_diagnostic_app:app")
    assert coordinator.preparation_steps() == [
        ("seed", "seed_actual_migrations_once_empty_owned_db", 180)
    ]
    assert coordinator.output_name == "export-jobs-diagnostic.json"
    workflow = (
        root / ".github/workflows/workouts-export-jobs-diagnostic.yml"
    ).read_text()
    assert (
        BRANCH in workflow
        and "timeout-minutes: 35" in workflow
        and "persist-credentials: false" in workflow
    )
    assert "--cleanup-only" in workflow and "retention-days: 1" in workflow
    assert "pull_request_target" not in workflow and "secrets." not in workflow
    original = (root / ".github/workflows/workouts-export-diagnostic.yml").read_text()
    assert "== 'codex/workouts-export-diagnostic'" in original
    capacity = (root / ".github/workflows/workouts-capacity.yml").read_text()
    assert capacity.count("github.head_ref != '" + BRANCH + "'") == 2
    assert capacity.count("github.ref_name != '" + BRANCH + "'") == 2


def test_actual_preparation_seed_command_enables045_without_changing_default_plan(
    tmp_path,
):
    repository = tmp_path / "repository"
    for relative in (
        "api/app",
        "api/migrations",
        "experiments/workouts-capacity/capacity",
    ):
        (repository / relative).mkdir(parents=True)
    (repository / "api/app/example.py").write_text("# synthetic source\n")
    (repository / "api/requirements.txt").write_text(
        "# synthetic requirement fixture\n"
    )
    subprocess.run(
        ["git", "init", "-q", str(repository)], check=True, capture_output=True
    )
    subprocess.run(
        ["git", "-C", str(repository), "add", "."], check=True, capture_output=True
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "-c",
            "user.name=Capacity fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "synthetic fixture",
        ],
        check=True,
        capture_output=True,
    )
    coordinator = ExportJobsCoordinator(
        repository, tmp_path / "work", tmp_path / "receipt"
    )
    coordinator.plan_root, coordinator.run_id = tmp_path / "jobs-plan", "jobs-seed-test"
    plan = coordinator.preparation_plan()
    seed = next(
        row["argv"]
        for row in plan["commands"]
        if row["step"] == "seed_actual_migrations_once_empty_owned_db"
    )
    env_file = Path(seed[seed.index("--env-file") + 1])
    effective = dict(line.split("=", 1) for line in env_file.read_text().splitlines())
    assert effective["WORKOUTS_EXPORT_JOBS_ENABLED"] == "true"
    assert (
        effective["WORKOUTS_API_ENABLED"] == "true"
        and effective["JOB_WORKER_ENABLED"] == "true"
    )
    assert effective["DATABASE_URL"] == effective["WORKOUTS_AI_BUDGET_DATABASE_URL"]
    original = build_plan(
        repository,
        tmp_path / "original-plan",
        "original-seed-test",
        0.5,
        owner="capacity_ci",
    )
    original_seed = next(
        row["argv"]
        for row in original["commands"]
        if row["step"] == "seed_actual_migrations_once_empty_owned_db"
    )
    assert (
        "WORKOUTS_EXPORT_JOBS_ENABLED"
        not in Path(original_seed[original_seed.index("--env-file") + 1]).read_text()
    )
    with pytest.raises(ValueError, match="fixed"):
        build_plan(
            repository,
            tmp_path / "invalid-plan",
            "invalid-seed-test",
            0.5,
            owner="capacity_ci",
            fixture_overrides={"DATABASE_URL": "postgresql://external.invalid/private"},
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupted", [False, True])
async def test_final_report_settles_and_records_a_held_protected_request(
    monkeypatch, tmp_path, interrupted
):
    from capacity import export_jobs_diagnostic_driver as module

    entered = asyncio.Event()

    async def serve(_):
        entered.set()
        await asyncio.Event().wait()

    class Held(JobsProbe):
        def __init__(self):
            super().__init__()
            self.client = httpx.AsyncClient(
                base_url="http://fixture.invalid", transport=httpx.MockTransport(serve)
            )

        async def readers(self, index):
            if index == 0:
                await self.request("GET", "/up", label="/up")
            else:
                await asyncio.Event().wait()

        async def export(self):
            await entered.wait()
            if interrupted:
                await asyncio.Event().wait()
            raise JobProbeFailure("export_job_terminal")

        async def chat(self):
            await asyncio.Event().wait()

    monkeypatch.setattr(module, "JobsProbe", Held)
    output = tmp_path / "interrupted.json"
    task = asyncio.create_task(module.run(output))
    await entered.wait()
    if interrupted:
        task.cancel()
    with pytest.raises(asyncio.CancelledError if interrupted else JobProbeFailure):
        await task
    value = json.loads(output.read_text())
    assert value["completed"] is False and value["unsettled_requests"] == 0
    assert (
        value["routes"]["/up"]["count"] == 1
        and value["routes"]["/up"]["unexpected"] == 1
    )
    assert value["spans"][0]["status"] == 0
    assert value["driver_failure_code"] == (
        "export_job_request_failed" if interrupted else "export_job_terminal"
    )

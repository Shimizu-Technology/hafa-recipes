"""Fresh fixed-rate baseline and five actual background-export mixed cycles."""

import argparse
import asyncio
import json
import time
from pathlib import Path
from uuid import uuid4

from capacity.driver import PREFIX, Driver, protected_acceptance
from capacity.driver_diagnostics import AcceptanceFailure, failure_code
from capacity.export_jobs_diagnostic_driver import (
    JobProbeFailure,
    checked_job,
    instant,
    ready_proof,
    row_key,
)
from capacity.export_jobs_diagnostic_prescriptions import (
    PrescriptionProof,
    expected_prescriptions,
)
from capacity.safety import OWNERS

SECONDS = 300
START_TOLERANCE_SECONDS = 1.0


def reader_targets(index, started=0):
    return tuple(
        started + 2 * index + 16 * turn
        for turn in range(19)
        if 2 * index + 16 * turn < SECONDS
    )


async def anchored_turns(targets, operation):
    """A missed offered-load slot fails before issuing another operation."""
    for index, target in enumerate(targets):
        if time.monotonic() - target > START_TOLERANCE_SECONDS:
            raise AcceptanceFailure("workload_slot_missed")
        await asyncio.sleep(max(0, target - time.monotonic()))
        if time.monotonic() - target > START_TOLERANCE_SECONDS:
            raise AcceptanceFailure("workload_slot_missed")
        await operation(index)


async def protected_reader(driver, index, mixed, started):
    async def operation(_):
        await driver.lightweight(index, mixed)

    await anchored_turns(reader_targets(index, started), operation)


async def heavy_cycles(driver, mixed, started):
    async def operation(index):
        await driver.media_and_chat(index, mixed)

    await anchored_turns(tuple(started + 60 * index for index in range(5)), operation)


async def settled_workload(*coroutines):
    tasks = [asyncio.create_task(coroutine) for coroutine in coroutines]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_workload(driver, mixed, seconds):
    started = time.monotonic()
    deadline = started + seconds

    async def polling():
        while time.monotonic() < deadline:
            await driver.poll()
            await asyncio.sleep(5)

    async with asyncio.timeout(seconds + 30):
        await settled_workload(
            *(protected_reader(driver, index, mixed, started) for index in range(8)),
            heavy_cycles(driver, mixed, started),
            polling(),
        )


class MixedDriver(Driver):
    def __init__(self, directory):
        self.expected = expected_prescriptions()  # Before all timed traffic.
        super().__init__(directory)
        self.cycles = []
        self.export_static = None
        self.origin = time.time()
        self.spans, self.pending = [], {}
        self.dropped = 0

    def trace(self, number, event, label, **values):
        super().trace(number, event, label, **values)
        if event == "start":
            self.pending[number] = time.time()
        elif number in self.pending:
            start = self.pending.pop(number)
            if label in {
                "/up",
                "recipes/list",
                "recipes/detail",
                "recipes/search",
                "workouts/export-page",
            }:
                if len(self.spans) < 4096:
                    self.spans.append(
                        {
                            "route": label,
                            "offset_ms": (start - self.origin) * 1000,
                            "duration_ms": values["milliseconds"],
                            "status": values.get("status", 0),
                        }
                    )
                else:
                    self.dropped += 1

    async def measurements(self):
        response = await self.request("GET", "/capacity/export-jobs-mixed", OWNERS[22])
        response.raise_for_status()
        return response.json()

    def report(self):
        value = super().report()
        value.update(
            job_cycles=self.cycles,
            spans=self.spans,
            origin_timestamp=self.origin,
            dropped_spans=self.dropped,
            unsettled_requests=len(self.pending),
        )
        return value

    async def export_snapshot(self):
        self.outcome = {}
        self.prescriptions = PrescriptionProof(self.expected)
        page_span_start = len(self.spans)
        request_id = str(uuid4())
        started = time.monotonic()
        response = await self.request(
            "POST",
            PREFIX + "/export/jobs",
            OWNERS[22],
            label="workouts/export-admit",
            expected=(202,),
            json={"request_id": request_id},
        )
        response.raise_for_status()
        if response.status_code != 202:
            raise JobProbeFailure("export_job_identity_failed")
        self.outcome["admission_ms"] = (time.monotonic() - started) * 1000
        job = checked_job(response.json(), request_id)
        original = job
        identifier, admitted = job["id"], instant(job["admitted_at"])
        deadline = instant(job["deadline_at"]).timestamp()
        polls = 0
        # Four-second reads match the native foreground cadence. Admission is
        # never replayed, and neither a timeout nor a terminal state creates a job.
        while job["status"] != "ready":
            if job["status"] not in {"queued", "running"}:
                raise JobProbeFailure("export_job_terminal")
            remaining = deadline - time.time()
            if remaining <= 0 or polls >= 30:
                raise JobProbeFailure("export_job_deadline_failed")
            await asyncio.sleep(4)
            response = await self.request(
                "GET",
                f"{PREFIX}/export/jobs/{identifier}",
                OWNERS[22],
                label="workouts/export-status",
            )
            response.raise_for_status()
            polls += 1
            job = checked_job(
                response.json(), request_id, identifier, original=original
            )
        self.outcome.update(
            poll_count=polls,
            original_identity_preserved=True,
            ready_observed_ms=max(0, time.time() - admitted.timestamp()) * 1000,
        )
        proof = (await self.measurements()).get("job_checks", {})
        if job["cleanup_pending"] or not ready_proof(proof):
            raise JobProbeFailure("export_job_ack_failed")
        self.outcome["ready_actual_end_verified"] = True
        manifest = job.get("manifest") or {}
        totals = manifest.get("totals", {})
        if (
            manifest.get("generation") != 1
            or manifest.get("schema_version") != 1
            or manifest.get("page_size") != 10
            or manifest.get("page_count") != 19
            or totals.get("workouts") != 190
            or totals.get("workout_versions") != 190
            or not all(type(value) is int and value >= 0 for value in totals.values())
        ):
            raise JobProbeFailure("export_job_pages_failed")
        collected, identities, static, wire = {}, {}, None, 0
        for page in range(19):
            response = await self.request(
                "GET",
                f"{PREFIX}/export/snapshots/{manifest['id']}/pages/{page}",
                OWNERS[22],
                label="workouts/export-page",
            )
            response.raise_for_status()
            value = await asyncio.to_thread(response.json)
            data = value.get("export", {})
            if (
                value.get("snapshot_id") != manifest["id"]
                or value.get("page") != page
                or value.get("page_count") != 19
                or data.get("offset") != page * 10
                or data.get("limit") != 10
                or data.get("schema_version") != 1
                or data.get("enrollment", {}).get("generation") != 1
                or data.get("totals") != totals
                or set(data.get("datasets", {})) != set(totals)
                or any(data.get("has_more", {}).values()) != (page < 18)
            ):
                raise JobProbeFailure("export_job_pages_failed")
            current = [
                data.get(key)
                for key in ("profile_revision", "profile", "grants", "ai_consent")
            ]
            if static is not None and current != static:
                raise JobProbeFailure("export_job_pages_failed")
            if self.export_static is not None and current != self.export_static:
                raise JobProbeFailure("export_job_pages_failed")
            static = current
            self.export_static = current
            try:
                await asyncio.to_thread(self.prescriptions.page, data["datasets"])
            except (ValueError, TypeError):
                raise JobProbeFailure("export_job_pages_failed") from None
            for name, rows in data["datasets"].items():
                identities.setdefault(name, set())
                for row in rows:
                    key = row_key(name, row)
                    if key in identities[name]:
                        raise JobProbeFailure("export_job_pages_failed")
                    identities[name].add(key)
                collected[name] = collected.get(name, 0) + len(rows)
            wire += len(response.content)
            self.outcome["pages_read"] = page + 1
        if collected != totals or not self.prescriptions.complete():
            raise JobProbeFailure("export_job_pages_failed")
        self.outcome.update(
            all_totals_matched=True,
            prescriptions_matched=True,
            unique_rows=True,
            workouts_rows=collected["workouts"],
            versions_rows=collected["workout_versions"],
            dataset_count=len(totals),
            total_rows=sum(totals.values()),
            wire_bytes=wire,
        )
        response = await self.request(
            "POST",
            f"{PREFIX}/export/jobs/{identifier}/cancel",
            OWNERS[22],
            label="workouts/export-cancel",
        )
        response.raise_for_status()
        cancelled = checked_job(
            response.json(), request_id, identifier, original=original
        )
        if (
            cancelled["status"] != "cancelled"
            or cancelled["cleanup_pending"]
            or cancelled["manifest"] is not None
        ):
            raise JobProbeFailure("export_job_cleanup_failed")
        self.outcome["same_job_cancelled"] = True
        proof = (await self.measurements()).get("job_checks", {})
        cycle = len(self.cycles) + 1
        if (
            not ready_proof({**proof, "status_code": 4})
            or proof.get("status_code") != 5
            or proof.get("cycle_count") != cycle
            or proof.get("cancelled_count") != cycle
            or proof.get("snapshot_count") != 0
            or proof.get("page_count") != 0
            or proof.get("worker_pending_ack_count") != 0
        ):
            raise JobProbeFailure("export_job_cleanup_failed")
        measured = await self.measurements()
        self.cycles.append(
            {
                "outcome": dict(self.outcome),
                "job_checks": proof,
                "metrics": {
                    key: value for key, value in measured.items() if key != "job_checks"
                },
                "page_spans": [
                    row
                    for row in self.spans[page_span_start:]
                    if row["route"] == "workouts/export-page"
                ],
            }
        )


async def run(args):
    if Path(args.output).exists():
        raise RuntimeError(
            "Use a new phase output; historical evidence cannot be replaced"
        )
    driver = MixedDriver(args.fixtures)
    completed = False
    failure_type = None
    fixed_failure = None
    try:
        driver.phase = "baseline" if args.profile == "recipes-baseline" else "mixed"
        driver.begin_trace(args.output)
        await driver.checkpoint("before")
        if args.profile == "mixed":
            await driver.prepare()
        mixed = args.profile == "mixed"
        driver.results.clear()  # Setup is excluded from protected-route latency.
        await run_workload(driver, mixed, args.seconds)
        await driver.poll()
        if args.profile in {"recipes-baseline", "mixed"}:
            await driver.checkpoint("after")
            report = driver.report()
            if any(row["unexpected"] for row in report["routes"].values()):
                raise AcceptanceFailure("unexpected_workload_status")
            stages = driver.checkpoints["after"]["stage_counts"]
            before = driver.checkpoints["before"]["stage_counts"]
            for stage in ("evidence_frames", "cover_frames", "cover_compare"):
                if stages.get(stage, {}).get("end", 0) <= before.get(stage, {}).get(
                    "end", 0
                ):
                    raise AcceptanceFailure(
                        {
                            "evidence_frames": "cold_evidence_frames_missing",
                            "cover_frames": "cold_cover_fallback_missing",
                            "cover_compare": "cold_cover_compare_missing",
                        }[stage]
                    )
            scenarios = driver.checkpoints["after"].get("cover_scenarios")
            if not isinstance(scenarios, dict) or scenarios.get("cached") != {
                "observed": 5,
                "completed": 5,
                "linked_recipes": 5,
            }:
                raise AcceptanceFailure("cold_cover_reuse_missing")
            if scenarios.get("fallback") != {
                "observed": 1,
                "completed": 1,
                "linked_recipes": 1,
            }:
                raise AcceptanceFailure("cold_cover_fallback_missing")
            if not driver.recipe_submission_ids or len(
                driver.outcomes["recipes"]
            ) != len(driver.recipe_submission_ids):
                raise AcceptanceFailure("cold_saved_outcomes_missing")
            if len(driver.recipe_saved_links) != len(driver.recipe_submission_ids):
                raise AcceptanceFailure("cold_saved_links_not_distinct")
            if any(
                state != "completed" for state in driver.outcomes["recipes"].values()
            ):
                raise AcceptanceFailure("cold_jobs_not_drained")
        completed = True
        if (
            args.profile in {"recipes-baseline", "mixed"}
            and not protected_acceptance(driver.report())["passed"]
        ):
            raise AcceptanceFailure("protected_category_failed")
    except BaseException as exc:
        # Preserve cancellation/transport failure while retaining partial numeric
        # evidence. Never serialize provider messages, source payloads or URLs.
        failure_type = type(exc).__name__
        fixed_failure = failure_code(exc)
        raise
    finally:
        try:
            report = driver.report()
            report.update(
                completed=completed,
                failure_type=failure_type,
                failure_code=fixed_failure,
            )
            if args.profile in {"recipes-baseline", "mixed"}:
                report["protected_acceptance"] = protected_acceptance(report)
            Path(args.output).write_text(json.dumps(report, indent=2))
            print(
                json.dumps(
                    {
                        "report_written": True,
                        "completed": completed,
                        "failure_type": failure_type,
                        "unexpected": sum(
                            r["unexpected"] for r in report["routes"].values()
                        ),
                    }
                )
            )
        finally:
            if driver.trace_stream:
                driver.trace_stream.close()
            await driver.client.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile", choices=("recipes-baseline", "mixed"), required=True
    )
    parser.add_argument("--seconds", type=int, choices=(300,), default=300)
    parser.add_argument("--fixtures", default="/fixtures")
    parser.add_argument("--output", required=True)
    asyncio.run(run(parser.parse_args()))

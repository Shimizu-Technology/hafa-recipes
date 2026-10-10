"""One durable export admission; unchanged protected readers/chat, no retries."""

import argparse
import asyncio
import json
import signal
import time
from datetime import datetime
from uuid import UUID, uuid4

from capacity.driver import PREFIX
from capacity.export_diagnostic_driver import EXPORT_START_SECONDS, Probe, save
from capacity.export_jobs_diagnostic_contract import ROUTES, STATUS_CODES
from capacity.export_jobs_diagnostic_prescriptions import (
    PrescriptionProof,
    expected_prescriptions,
)
from capacity.safety import OWNERS


class JobProbeFailure(RuntimeError):
    """Only fixed codes reach the private report and whitelisted receipt."""


def instant(value):
    try:
        result = datetime.fromisoformat(value)
        if result.tzinfo is None:
            raise ValueError
        return result
    except (TypeError, ValueError):
        raise JobProbeFailure("export_job_identity_failed") from None


def checked_job(value, request_id, identifier=None, *, original=None):
    if (
        not isinstance(value, dict)
        or type(value.get("schema_version")) is not int
        or value.get("schema_version") != 1
        or type(value.get("generation")) is not int
        or value.get("generation") != 1
        or value.get("request_id") != request_id
        or value.get("status") not in STATUS_CODES
        or not isinstance(value.get("id"), str)
        or (identifier is not None and value["id"] != identifier)
        or type(value.get("cleanup_pending")) is not bool
    ):
        raise JobProbeFailure("export_job_identity_failed")
    try:
        UUID(value["id"])
    except ValueError:
        raise JobProbeFailure("export_job_identity_failed") from None
    admitted = instant(value.get("admitted_at"))
    if (instant(value.get("deadline_at")) - admitted).total_seconds() != 120 or (
        instant(value.get("expires_at")) - admitted
    ).total_seconds() != 600:
        raise JobProbeFailure("export_job_deadline_failed")
    if original is not None and any(
        instant(value.get(key)) != instant(original.get(key))
        for key in ("admitted_at", "deadline_at", "expires_at")
    ):
        raise JobProbeFailure("export_job_deadline_failed")
    if value["status"] != "ready" and value.get("manifest") is not None:
        raise JobProbeFailure("export_job_identity_failed")
    return value


def ready_proof(value):
    return (
        value.get("job_count") == 1
        and value.get("status_code") == 4
        and value.get("actual_end_ack_count") == 1
        and value.get("slot_rows") == 1
        and value.get("active_slot_count") == 0
        and value.get("global_slot_idle") is True
        and value.get("source_frames_retired") is True
        and value.get("running_registry_count") == 0
        and value.get("worker_active_task_count") == 0
        and value.get("worker_active_execution_count") == 0
        and value.get("worker_heartbeat_task_count") == 0
        and value.get("worker_retirement_task_count") == 0
        and type(value.get("ack_completion_ms")) in (int, float)
        and 0 <= value["ack_completion_ms"] <= 120000
    )


def row_key(name, row):
    if not isinstance(row, dict):
        raise JobProbeFailure("export_job_pages_failed")
    if isinstance(row.get("id"), str):
        return row["id"]
    keys = {
        "health_connections": ("provider",),
        "health_owned_writes": ("provider", "canonical_session_id", "revision"),
        "library_organization": ("workout_id",),
        "library_collection_members": ("collection_id", "workout_id"),
    }
    if name in keys:
        return json.dumps([row.get(key) for key in keys[name]], sort_keys=True)
    return json.dumps(row, sort_keys=True)


class JobsProbe(Probe):
    routes = ROUTES

    def __init__(self):
        # Independent190 expected payload hashes are prepared outside all timed
        # traffic, before Probe captures its trace origin and reader/chat clock.
        self.prescriptions = PrescriptionProof(expected_prescriptions())
        super().__init__()
        self.outcome = {}

    async def measurements(self):
        response = await self.request(
            "GET", "/capacity/export-jobs-diagnostic", OWNERS[22]
        )
        response.raise_for_status()
        return response.json()

    async def export(self):
        await asyncio.sleep(EXPORT_START_SECONDS)
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
            static = current
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


async def run(output):
    probe = JobsProbe()
    probe.begin_trace(output)
    probe.trace_stream.write(json.dumps({"origin_timestamp": probe.origin}) + "\n")
    probe.trace_stream.flush()
    probe.started = time.monotonic()
    report, tasks = {"completed": False}, []
    save(output, {"completed": False, "origin_timestamp": probe.origin})
    try:
        tasks = [asyncio.create_task(probe.readers(i)) for i in range(8)]
        tasks += [
            asyncio.create_task(probe.export()),
            asyncio.create_task(probe.chat()),
        ]
        async with asyncio.timeout(180):
            await asyncio.gather(*tasks)
            measured = await probe.measurements()
            status = await probe.request("GET", "/capacity/status")
            report.update(metrics=measured, status=status.json(), completed=True)
    except BaseException as error:
        from capacity.export_jobs_diagnostic_contract import FAILURES

        report["driver_failure_code"] = (
            error.args[0]
            if isinstance(error, JobProbeFailure)
            and error.args
            and error.args[0] in FAILURES
            else "export_job_request_failed"
        )
        raise
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        report.update(
            routes=probe.report()["routes"],
            percentile_method="nearest_rank",
            spans=probe.spans,
            dropped_spans=probe.dropped,
            origin_timestamp=probe.origin,
            unsettled_requests=len(probe.pending),
            job_outcome=probe.outcome,
        )
        save(output, report)
        probe.trace_stream.close()
        await probe.client.aclose()


async def entry(output):
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, task.cancel)
    try:
        await run(output)
    finally:
        loop.remove_signal_handler(signal.SIGTERM)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(entry(args.output))


if __name__ == "__main__":
    try:
        main()
    except BaseException:  # noqa: BLE001 - never publish response/identity/traceback
        raise SystemExit(2) from None

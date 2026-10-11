"""Private, finite same-namespace death proof; never production recovery.

Run only in a separately owned Linux fixture container AFTER the reviewed
capacity seed. This module neither provisions containers nor installs migrations.
There is no HTTP route, platform verifier adapter, timestamp rewrite or grace.
"""

import asyncio
import json
import os
import signal
import sys
from pathlib import Path
from uuid import uuid4

from capacity.export_jobs_death_process import (
    bind_child,
    process_state,
    require,
    signal_child,
    validate_child,
)
from capacity.safety import OWNERS, ensure


async def run():
    ensure()
    require(
        sys.platform == "linux" and os.environ.get("CAPACITY_LINUX_DEATH") == "true"
    )
    require(
        hasattr(os, "pidfd_open")
        and hasattr(signal, "pidfd_send_signal")
        and hasattr(os, "P_PIDFD")
    )
    from app.auth import ClerkUser
    from app.config import get_settings
    from app.db.database import AsyncSessionLocal as sessions
    from app.db.database import engine
    from app.domains.workouts.export_job_identity import (
        current_worker_identity,
        evidence_digest,
        same_namespace_ended,
    )
    from app.domains.workouts.export_job_models import (
        WorkoutsExportJob,
        WorkoutsExportJobRecovery,
        WorkoutsExportJobSlot,
    )
    from app.domains.workouts.export_job_service import ExportJobCoordinator
    from app.domains.workouts.export_job_worker import (
        ExportJobWorker,
        _running,
        engine_key,
    )
    from app.domains.workouts.export_models import (
        WorkoutsExportPage,
        WorkoutsExportSnapshot,
    )
    from app.domains.workouts.export_service import PrivateExportService
    from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
    from fastapi import HTTPException
    from sqlalchemy import func, select

    configured = get_settings()
    require(
        configured.workouts_export_jobs_enabled
        and configured.job_worker_enabled
        and not configured.workouts_ai_enabled
        and not configured.workouts_imports_enabled
    )
    identity = current_worker_identity()
    require(identity.boot and identity.namespace and identity.start)
    coordinator = ExportJobCoordinator(sessions, settings=configured, identity=identity)
    require(await coordinator.installed())  # Actual045 verifier, not metadata-only.
    owner = ClerkUser(
        id=OWNERS[22],
        clerk_user_id=OWNERS[22],
        clerk_issuer="https://capacity.invalid",
        clerk_environment="test",
    )
    child = bound = worker = None
    record = None
    receipt = {}

    async def count(model):
        async with sessions() as db:
            return await db.scalar(select(func.count()).select_from(model))

    async def held(identifier):
        async with sessions() as db:
            slot = await db.get(WorkoutsExportJobSlot, 1)
            row = await db.get(WorkoutsExportJob, identifier)
            require(
                slot is not None
                and slot.active_job_id == identifier
                and slot.started_at
            )
            require(row is not None and row.worker_identity == slot.worker_identity)
            require(
                row.worker_instance == slot.worker_instance
                and row.lease_token == slot.lease_token
                and row.started_at == slot.started_at
                and row.deadline_at == slot.deadline_at
                and row.worker_identity["instance"] == str(row.worker_instance)
            )
            require((row.deadline_at - row.admitted_at).total_seconds() == 120)
            require((row.expires_at - row.admitted_at).total_seconds() == 600)
            return dict(slot.worker_identity), slot.leased_until, row

    async def refused(call, status):
        try:
            await call
        except HTTPException as error:
            require(error.status_code == status)
            return
        require(False)

    try:
        # Never reuse a partially executed fixture; no schema reset or cleanup SQL.
        for model in (
            WorkoutsExportJob,
            WorkoutsExportJobRecovery,
            WorkoutsExportSnapshot,
            WorkoutsExportPage,
        ):
            require(await count(model) == 0)
        async with sessions() as db:
            workouts = await db.scalar(
                select(func.count())
                .select_from(WorkoutRecord)
                .where(WorkoutRecord.app_user_id == owner.id)
            )
            versions = await db.scalar(
                select(func.count())
                .select_from(WorkoutVersion)
                .where(WorkoutVersion.app_user_id == owner.id)
            )
        require(workouts >= 11 and versions == workouts)
        request_id = uuid4()
        admitted = await coordinator.admit(owner, 1, request_id)
        require(admitted.status == "queued")
        child = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "capacity.export_jobs_death_child",
            str(admitted.id),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        bound = bind_child(child.pid)
        marker = await asyncio.wait_for(child.stdout.readline(), 25)
        require(marker == b"source_held_after_commit\n" and child.returncode is None)
        record, _, row = await held(admitted.id)
        validate_child(record, identity, child.pid)
        require(record["start"] == bound.start)
        require(not same_namespace_ended(record, identity))
        require(
            await count(WorkoutsExportPage) == 1
            and await count(WorkoutsExportSnapshot) == 1
        )
        await coordinator.maintain()
        await held(admitted.id)
        require(await coordinator.claim() is None)
        await refused(coordinator.admit(owner, 1, uuid4()), 429)
        await refused(coordinator.recover_verified_death({"claim": "dead"}), 409)
        receipt["live_source_slot_retained"] = True

        signal_child(
            record,
            identity,
            child.pid,
            signal.SIGSTOP,
            send=lambda _, sig: bound.signal(sig),
        )
        # A stopped process still owns all its source memory. Observe the natural
        # lease using the actual DB clock; never rewrite lease/deadline/identity.
        until = asyncio.get_running_loop().time() + 25
        stop_until = asyncio.get_running_loop().time() + 2
        while process_state(child.pid) not in {"T", "t"}:
            require(asyncio.get_running_loop().time() < stop_until)
            await asyncio.sleep(0.01)
        while True:
            require(child.returncode is None)
            require(process_state(child.pid) in {"T", "t"})
            _, lease, _ = await held(admitted.id)
            async with sessions() as db:
                clock = await db.scalar(select(func.clock_timestamp()))
            if lease <= clock:
                break
            require(asyncio.get_running_loop().time() < until)
            await asyncio.sleep(0.1)
        require(not same_namespace_ended(record, identity))
        await coordinator.maintain()
        _, _, row = await held(admitted.id)
        require(row.status == "failed" and row.failure_code == "interrupted")
        stopped_receipt = await coordinator.receipt(owner, 1, admitted.id)
        require(stopped_receipt.cleanup_pending and stopped_receipt.manifest is None)
        require(
            await count(WorkoutsExportPage) == 0
            and await count(WorkoutsExportSnapshot) == 0
        )
        require(await coordinator.claim() is None)
        await refused(coordinator.admit(owner, 1, uuid4()), 429)
        await refused(coordinator.recover_verified_death({"claim": "dead"}), 409)
        receipt["suspended_expired_lease_slot_retained"] = True
        receipt["default_operator_verifier_refused"] = True

        signal_child(
            record,
            identity,
            child.pid,
            signal.SIGKILL,
            send=lambda _, sig: bound.signal(sig),
        )
        require(await asyncio.wait_for(child.wait(), 5) == -signal.SIGKILL)
        require(not Path(f"/proc/{child.pid}").exists())
        require(same_namespace_ended(record, identity))
        # A wrong namespace remains UNKNOWN even with a missing local PID.
        require(
            not same_namespace_ended(
                {**record, "namespace": "pid:[unverified]"}, identity
            )
        )
        await coordinator.maintain()
        async with sessions() as db:
            slot = await db.get(WorkoutsExportJobSlot, 1)
            require(slot.active_job_id is None)
            audits = (
                await db.scalars(
                    select(WorkoutsExportJobRecovery).where(
                        WorkoutsExportJobRecovery.job_id == admitted.id
                    )
                )
            ).all()
            require(len(audits) == 1 and audits[0].reason == "same_namespace_dead")
            require(audits[0].worker_instance == row.worker_instance)
            require(
                audits[0].evidence_digest
                == evidence_digest(
                    [str(admitted.id), record, str(row.lease_token)],
                    "same_namespace_dead",
                )
            )
        replay = await coordinator.admit(owner, 1, request_id)
        require(
            replay.id == admitted.id
            and replay.status == "failed"
            and not replay.cleanup_pending
        )
        require(await coordinator.claim(admitted.id) is None)
        receipt["killed_reaped_identity_absent"] = True
        receipt["same_namespace_death_audit"] = True
        receipt["wrong_namespace_default_deny"] = True
        receipt["old_uuid_never_restarted"] = True

        fresh = await coordinator.admit(owner, 1, uuid4())
        require(fresh.id != admitted.id and fresh.status == "queued")
        builder = PrivateExportService(sessions, settings=configured)
        require(builder._builtin_page_source)
        worker = ExportJobWorker(coordinator, builder)
        until = asyncio.get_running_loop().time() + 30
        while True:
            await worker.tick()
            fresh_receipt = await coordinator.receipt(owner, 1, fresh.id)
            if fresh_receipt.status == "ready" and not fresh_receipt.cleanup_pending:
                break
            require(asyncio.get_running_loop().time() < until)
            await asyncio.sleep(0.01)
        require(fresh_receipt.manifest.page_count >= 2)
        require(fresh_receipt.manifest.totals["workouts"] == workouts)
        require(fresh_receipt.manifest.totals["workout_versions"] == versions)
        await builder.remove(owner, 1, fresh_receipt.manifest.id)
        require(await worker.stop())
        require(
            worker.active_task is None
            and worker.heartbeat_task is None
            and worker.pending_ack is None
        )
        require(not any(key[0] == engine_key(coordinator) for key in _running))
        require(
            await count(WorkoutsExportSnapshot) == 0
            and await count(WorkoutsExportPage) == 0
        )
        async with sessions() as db:
            require((await db.get(WorkoutsExportJobSlot, 1)).active_job_id is None)
            require(
                await db.scalar(
                    select(func.count())
                    .select_from(WorkoutsExportJobRecovery)
                    .where(
                        WorkoutsExportJobRecovery.job_id == fresh.id,
                        WorkoutsExportJobRecovery.reason == "actual_end",
                    )
                )
                == 1
            )
        receipt.update(
            fresh_uuid_actual_end=True, artifacts_zero=True, slot_idle=True, passed=True
        )
        return receipt
    finally:
        # A bound kernel handle cannot signal a reused numeric PID. If binding
        # fails, do not fall back to an unverified PID signal; outer exact
        # container cleanup remains required, and this helper reports failure.
        try:
            if child is not None and child.returncode is None:
                require(bound is not None)
                bound.signal(signal.SIGKILL)
                await asyncio.wait_for(child.wait(), 5)
        finally:
            try:
                if bound is not None:
                    bound.close()
            finally:
                try:
                    if worker is not None:
                        require(await worker.stop())
                finally:
                    await engine.dispose()


def main():
    try:
        result = asyncio.run(asyncio.wait_for(run(), 100))
        print(json.dumps(result, sort_keys=True, allow_nan=False))
    except BaseException:  # noqa: BLE001 - do not print SQL/private traceback
        print("linux_death_acceptance_failed", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

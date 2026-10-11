"""Fresh Linux source-owning child for an isolated death acceptance helper."""

import asyncio
import os
import sys
from uuid import UUID

from capacity.export_jobs_death_process import HoldAfterCommit, require
from capacity.safety import ensure


async def run(identifier):
    ensure()  # No external credentials or nonfixture DB before API imports.
    require(
        sys.platform == "linux" and os.environ.get("CAPACITY_LINUX_DEATH") == "true"
    )
    from app.config import get_settings
    from app.db.database import AsyncSessionLocal, engine
    from app.domains.workouts.export_job_identity import current_worker_identity
    from app.domains.workouts.export_job_service import ExportJobCoordinator
    from app.domains.workouts.export_job_worker import (
        ExportJobWorker,
        _running,
        engine_key,
    )
    from app.domains.workouts.export_service import PrivateExportService

    configured = get_settings()
    require(
        configured.workouts_export_jobs_enabled
        and configured.job_worker_enabled
        and not configured.workouts_ai_enabled
        and not configured.workouts_imports_enabled
    )
    identity = current_worker_identity()  # Never inherit a parent's module identity.
    require(
        identity.pid == os.getpid()
        and identity.boot
        and identity.namespace
        and identity.start
    )
    coordinator = ExportJobCoordinator(
        AsyncSessionLocal, settings=configured, identity=identity
    )
    builder = PrivateExportService(AsyncSessionLocal, settings=configured)
    require(builder._builtin_page_source)
    entered, resume = asyncio.Event(), asyncio.Event()
    builder._write_page = HoldAfterCommit(builder._write_page, entered, resume)
    worker = ExportJobWorker(coordinator, builder)
    try:
        await worker.tick()
        await asyncio.wait_for(entered.wait(), 20)
        execution, source = worker.active_execution, worker.active_task
        require(
            execution is not None
            and execution.job_id == identifier
            and source is not None
            and not source.done()
            and source.get_coro().cr_frame is not None
            and (engine_key(coordinator), identifier) in _running
            and worker.heartbeat_task is not None
            and not worker.heartbeat_task.done()
        )
        print("source_held_after_commit", flush=True)
        # No cooperative end/ACK in the success path: parent kills this process.
        await asyncio.Future()
    finally:
        await worker.stop()
        await engine.dispose()


def main():
    try:
        require(len(sys.argv) == 2)
        asyncio.run(run(UUID(sys.argv[1])))
    except BaseException:  # noqa: BLE001 - no private exception output
        print("linux_death_child_failed", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

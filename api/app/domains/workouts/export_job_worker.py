"""Persistent one-slot dispatch; no queue or source view lives only in memory."""

import asyncio
from dataclasses import dataclass
from types import SimpleNamespace

from fastapi import HTTPException

from app.domains.workouts.export_job_execution import ClaimExecutionCapsule, LegacyAdmissionCapsule
from app.domains.workouts.export_job_service import ExportJobCoordinator
from app.domains.workouts.export_service import PrivateExportService


@dataclass(frozen=True)
class EndOutcome:
    failure: str | None
    manifest: object | None = None


def clear_exception(error):
    """Consume private helper frames/arguments before an actual-end ACK.

    Nothing from this error is persisted, returned or sent to observability.
    Classification occurs first, then the owned error graph is discarded.
    """
    pending, seen = [error], set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        for linked in (current.__cause__, current.__context__):
            if linked is not None:
                pending.append(linked)
        if isinstance(current, BaseExceptionGroup):
            pending.extend(current.exceptions)
        current.__traceback__ = current.__cause__ = current.__context__ = None
        current.args = ()
        current.__dict__.clear()


def failure_code(error):
    if isinstance(error, (TimeoutError, asyncio.TimeoutError)):
        return "deadline_exceeded"
    if isinstance(error, asyncio.CancelledError):
        return "interrupted"
    if isinstance(error, HTTPException):
        if error.status_code == 413:
            return "too_large"
        if error.detail == "export_job_deadline_exceeded":
            return "deadline_exceeded"
        if error.detail == "export_job_interrupted":
            return "interrupted"
        if error.status_code in {403, 404, 409, 410}:
            return "privacy_changed"
    return "export_failed"


async def safe_build(builder, execution):
    """Return only scalar outcome/manifest; this task never retains an error."""
    try:
        manifest = await builder.create(
            SimpleNamespace(id=execution.owner), execution.generation, execution=execution
        )
        return EndOutcome(None, manifest)
    except BaseException as error:
        code = failure_code(error)
        clear_exception(error)
        return EndOutcome(code)


def engine_key(coordinator):
    return id(getattr(coordinator.sessions, "kw", {}).get("bind"))


# These refs only exist while their matching durable slot is held. Finished task
# objects are removed before ACK; an ACK retry retains only content-free fields.
_running = {}
_pending_legacy_ack = {}
_abandoned_legacy = set()


def register(coordinator, execution, task):
    _running[(engine_key(coordinator), execution.job_id)] = (execution, task)


def forget(coordinator, execution):
    _running.pop((engine_key(coordinator), execution.job_id), None)


def cancel_local_owner(db, owner):
    """Owner-held privacy writer: signal only this engine's source tasks.

    No database call or global-slot lock occurs here. Cancellation fences are
    already written by the caller; rollback may conservatively stop a source.
    """
    key = id(db.bind)
    for registration in tuple(_running):
        if registration[0] == key:
            execution, task = _running[registration]
            if execution.owner == owner:
                task.cancel()
    if engine_key(export_job_worker.coordinator) == key:
        export_job_worker.notify()


async def pulse(coordinator, execution, task):
    while not task.done():
        await asyncio.sleep(3)
        if task.done():
            return
        try:
            renewed = await coordinator.heartbeat(execution)
        except BaseException as error:
            clear_exception(error)
            renewed = False
        if not renewed:
            task.cancel()
            return


def consume(coordinator, execution, task):
    """Drop the completed source task/frame before releasing durable capacity."""
    if not task.done():
        raise RuntimeError("Source execution has not ended")
    try:
        outcome = task.result()  # safe_build consumes every started source error.
    except asyncio.CancelledError as error:
        # Cancellation before the first coroutine step never entered safe_build.
        clear_exception(error)
        outcome = EndOutcome("interrupted")
    if task.get_coro().cr_frame is not None:
        raise RuntimeError("Source execution still retains a frame")
    forget(coordinator, execution)
    return outcome


async def run_compatibility_export(builder, coordinator, user, generation):
    """Own admission before any await can lose the durable start ACK."""
    from uuid import uuid4

    capsule = LegacyAdmissionCapsule(user.id, generation, uuid4())
    try:
        receipt = await coordinator.admit(
            user, generation, capsule.request_id, kind="legacy", capsule=capsule
        )
        execution = await coordinator.legacy_execution(user, generation, receipt.id)
        if capsule.execution is None or execution != capsule.execution:
            raise HTTPException(503, "export_jobs_unavailable")
        return await _run_compatibility_source(
            builder, coordinator, user, generation, execution, capsule
        )
    except BaseException as error:
        if capsule.source_created:
            raise
        # No source task ever existed. Retire admission/driver frames before
        # acknowledging that exact captured execution, including uncertain commit.
        cancelled = isinstance(error, asyncio.CancelledError)
        status = error.status_code if isinstance(error, HTTPException) else 503
        detail = error.detail if isinstance(error, HTTPException) else "export_jobs_unavailable"
        headers = error.headers if isinstance(error, HTTPException) else None
        clear_exception(error)
        if cancelled:
            raise asyncio.CancelledError() from None
        raise HTTPException(status, detail, headers=headers) from None
    finally:
        if capsule.execution is not None and not capsule.source_created:
            try:
                await coordinator.acknowledge_end(capsule.execution, "interrupted")
            except BaseException as error:
                clear_exception(error)
                _pending_legacy_ack[(engine_key(coordinator), capsule.execution.job_id)] = (
                    capsule.execution,
                    "interrupted",
                )


async def _run_compatibility_source(builder, coordinator, user, generation, execution, capsule):
    """Old POST returns201 only after source retirement and fresh readiness."""
    task = heartbeat = None
    try:
        # Mark before scheduling: eager/custom factories may execute source code
        # even when create_task raises and returns no task to this caller.
        capsule.source_created = True
        task = asyncio.create_task(safe_build(builder, execution), name="workouts-export-legacy")
        register(coordinator, execution, task)
        heartbeat = asyncio.create_task(
            pulse(coordinator, execution, task), name="workouts-export-lease"
        )
        await asyncio.shield(task)
        # Only small manifest metadata survives source-task retirement.
        heartbeat.cancel()
        await asyncio.gather(heartbeat, return_exceptions=True)
        heartbeat = None
        outcome = consume(coordinator, execution, task)
        task = None
        try:
            await coordinator.acknowledge_end(execution, outcome.failure)
        except BaseException:
            _pending_legacy_ack[(engine_key(coordinator), execution.job_id)] = (
                execution,
                outcome.failure,
            )
            raise
        if outcome.failure is None:
            receipt = await coordinator.receipt(user, generation, execution.job_id)
            if (
                receipt.status == "ready"
                and not receipt.cleanup_pending
                and receipt.manifest is not None
            ):
                return receipt.manifest
            raise HTTPException(410, "export_snapshot_unavailable") from None
        status = (
            413
            if outcome.failure == "too_large"
            else 410
            if outcome.failure in {"privacy_changed", "interrupted", "deadline_exceeded"}
            else 503
        )
        detail = "export_snapshot_too_large" if status == 413 else "export_snapshot_unavailable"
        raise HTTPException(status, detail) from None
    finally:
        if heartbeat is not None:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            heartbeat = None
        if task is not None:
            task.cancel()
            await asyncio.wait({task}, timeout=5)
            if task.done():
                outcome = consume(coordinator, execution, task)
                task = None
                try:
                    await coordinator.acknowledge_end(execution, outcome.failure)
                except BaseException:
                    _pending_legacy_ack[(engine_key(coordinator), execution.job_id)] = (
                        execution,
                        outcome.failure,
                    )
                    raise
            else:
                # Transfer collection only after this request has retired its
                # heartbeat and will drop its source-task reference. No await
                # follows this handoff, so the dispatcher cannot race the drop.
                _abandoned_legacy.add((engine_key(coordinator), execution.job_id))
                task = None
            # A source that ignored cancellation still owns its durable slot.


class ExportJobWorker:
    def __init__(self, coordinator=None, builder=None):
        self.coordinator = coordinator or ExportJobCoordinator()
        self.builder = builder or PrivateExportService(
            self.coordinator.sessions, settings=self.coordinator.settings
        )
        self.task = None
        self.active_task = None
        self.active_execution = None
        self.heartbeat_task = None
        self.pending_ack = None
        self.claim_capsule = None
        self.stopping = False
        self.wake = asyncio.Event()

    async def start(self):
        if (
            self.coordinator.configured.workouts_api_enabled
            and await self.coordinator.installed()
            and self.task is None
        ):
            self.stopping = False
            self.task = asyncio.create_task(self.run(), name="workouts-export-dispatch")

    def notify(self):
        self.wake.set()

    def cancel_owner(self, owner):
        key = engine_key(self.coordinator)
        for (engine, _), (execution, task) in tuple(_running.items()):
            if engine == key and execution.owner == owner:
                task.cancel()
        self.notify()

    def cancel_job(self, identifier):
        active = _running.get((engine_key(self.coordinator), identifier))
        if active is not None:
            active[1].cancel()
        self.notify()

    async def _finish(self):
        if self.active_task is None or not self.active_task.done():
            return
        if self.heartbeat_task is not None:
            self.heartbeat_task.cancel()
            await asyncio.gather(self.heartbeat_task, return_exceptions=True)
            self.heartbeat_task = None
        execution, completed = self.active_execution, self.active_task
        try:
            outcome = completed.result()
        except asyncio.CancelledError as error:
            clear_exception(error)
            outcome = EndOutcome("interrupted")
        if completed.get_coro().cr_frame is not None:
            raise RuntimeError("Source execution has not retired")
        forget(self.coordinator, execution)
        self.active_execution = self.active_task = None
        completed = None
        self.pending_ack = (execution, outcome.failure)
        outcome = None
        await self._ack()

    async def _ack(self):
        if self.pending_ack is not None:
            execution, failure = self.pending_ack
            await self.coordinator.acknowledge_end(execution, failure)
            self.pending_ack = None

    async def _finish_legacy(self):
        key = engine_key(self.coordinator)
        # Collect only explicitly abandoned requests. Live compatibility calls
        # own their own retirement/ACK, even when the source task has finished.
        for registration in tuple(_abandoned_legacy):
            if registration[0] != key:
                continue
            active = _running.get(registration)
            if active is None:
                _abandoned_legacy.discard(registration)
                continue
            execution, completed = active
            active = None
            if not completed.done():
                completed = None
                continue
            outcome = consume(self.coordinator, execution, completed)
            _pending_legacy_ack[registration] = (execution, outcome.failure)
            completed = outcome = None
            _abandoned_legacy.discard(registration)
        # The snapshot contains keys only; no iterator can retain source tasks
        # while the database acknowledges actual end.
        for registration in tuple(_pending_legacy_ack):
            if registration[0] == key:
                execution, failure = _pending_legacy_ack[registration]
                await self.coordinator.acknowledge_end(execution, failure)
                _pending_legacy_ack.pop(registration, None)

    async def tick(self):
        await self._finish()
        await self._ack()
        await self._finish_legacy()
        await self.coordinator.maintain()
        configured = self.coordinator.configured
        if (
            self.active_task is None
            and self.pending_ack is None
            and self.claim_capsule is None
            and not self.stopping
            and configured.workouts_export_jobs_enabled
            and configured.job_worker_enabled
        ):
            capsule = ClaimExecutionCapsule()
            self.claim_capsule = capsule
            try:
                execution = await self.coordinator.claim(capsule=capsule)
                if execution is not None and not self.stopping:
                    if execution != capsule.execution:
                        raise HTTPException(503, "export_jobs_unavailable")
                    self.active_execution = execution
                    # An eager/custom factory may start source before returning.
                    capsule.source_created = True
                    self.active_task = asyncio.create_task(
                        safe_build(self.builder, execution), name="workouts-export-build"
                    )
                    register(self.coordinator, execution, self.active_task)
                    self.heartbeat_task = asyncio.create_task(
                        pulse(self.coordinator, execution, self.active_task),
                        name="workouts-export-lease",
                    )
            except BaseException as error:
                cancelled = isinstance(error, asyncio.CancelledError)
                clear_exception(error)
                if cancelled:
                    raise asyncio.CancelledError() from None
                raise HTTPException(503, "export_jobs_unavailable") from None
            finally:
                if not capsule.source_created:
                    # All claim frames have returned/been consumed. This exact
                    # capsule proves that this worker created no source task.
                    self.claim_capsule = None
                    if capsule.execution is not None:
                        self.pending_ack = (capsule.execution, "interrupted")
                        await self._ack()
                elif self.active_task is not None:
                    self.claim_capsule = None
                # A factory that returned no task leaves unknown source proof:
                # keep capsule and durable slot, never infer end from registry.

    async def run(self):
        while self.coordinator.configured.workouts_api_enabled:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except BaseException as error:
                clear_exception(error)
                # No source/provider/SQL exceptions or identifiers are logged.
            self.wake.clear()
            try:
                await asyncio.wait_for(self.wake.wait(), 1)
            except TimeoutError:
                pass

    async def stop(self):
        self.stopping = True
        # Signal sources/heartbeat even if a dispatcher is resisting cancellation.
        if self.heartbeat_task is not None:
            self.heartbeat_task.cancel()
        if self.active_task is not None:
            self.active_task.cancel()
        if self.task is not None:
            self.task.cancel()
            await asyncio.wait({self.task}, timeout=5)
            if not self.task.done():
                return False  # Retain dispatcher/capsule/slot; no invented proof.
            try:
                self.task.result()
            except BaseException as error:
                clear_exception(error)
            self.task = None
        # Shutdown stops lease renewal immediately. An unfinished source still
        # retains its task and durable slot; a stopped heartbeat is not proof.
        if self.heartbeat_task is not None:
            self.heartbeat_task.cancel()
        if self.active_task is not None:
            self.active_task.cancel()
            await asyncio.wait({self.active_task}, timeout=5)
        key = engine_key(self.coordinator)
        other = {
            task
            for (engine, _), (_, task) in _running.items()
            if engine == key and task is not self.active_task
        }
        for task in other:
            task.cancel()
        task = None  # The loop variable must not retain a completed legacy task.
        if other:
            await asyncio.wait(other, timeout=5)
        other = None
        try:
            async with asyncio.timeout(5):
                await self._finish()
                await self._ack()
                await self._finish_legacy()
        except BaseException as error:
            clear_exception(error)
        # An unfinished task/ACK remains referenced and the durable slot held.
        # Shutdown is not proof that any still-running native process has ended.
        return (
            self.task is None
            and self.claim_capsule is None
            and self.active_task is None
            and self.pending_ack is None
            and not any(engine == key for engine, _ in _running)
            and not any(engine == key for engine, _ in _pending_legacy_ack)
        )


export_job_worker = ExportJobWorker()

"""Execution ownership and private-reference retirement across every exit."""

import asyncio
import gc
import weakref
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.domains.workouts import export_job_worker as worker


def execution():
    return SimpleNamespace(owner="fixture", generation=1, job_id=uuid4())


class Coordinator:
    sessions = SimpleNamespace(kw={"bind": object()})
    configured = SimpleNamespace(
        workouts_api_enabled=True, workouts_export_jobs_enabled=False, job_worker_enabled=True
    )
    settings = None

    def __init__(self):
        self.execution = execution()
        self.acks = []
        self.task_ref = None
        self.ack_failure = False

    async def admit(self, *a, **kw):
        kw["capsule"].execution = self.execution
        return SimpleNamespace(id=self.execution.job_id)

    async def legacy_execution(self, *a, **kw):
        return self.execution

    async def receipt(self, *a):
        return SimpleNamespace(status="ready", cleanup_pending=False, manifest="safe manifest")

    async def heartbeat(self, *a):
        return True

    async def maintain(self):
        pass

    async def acknowledge_end(self, run, failure):
        gc.collect()
        assert worker._running.get((worker.engine_key(self), run.job_id)) is None
        if self.task_ref is not None:
            assert self.task_ref() is None
        if self.ack_failure:
            raise RuntimeError("fixed scalar ACK fault")
        self.acks.append(failure)


class Builder:
    def __init__(self, coordinator, *, wait=None, error=None):
        self.coordinator = coordinator
        self.wait = wait
        self.error = error

    async def create(self, *a, **kw):
        self.coordinator.task_ref = weakref.ref(asyncio.current_task())
        if self.wait is not None:
            await self.wait.wait()
        if self.error is not None:
            raise self.error
        return None


async def test_dispatcher_never_collects_live_legacy_request():
    coordinator = Coordinator()
    barrier = asyncio.Event()
    # Hold the live request in heartbeat retirement after source completion.
    original = worker.pulse

    async def delayed_pulse(*args):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            await barrier.wait()

    worker.pulse = delayed_pulse
    try:
        pending = asyncio.create_task(
            worker.run_compatibility_export(
                Builder(coordinator), coordinator, SimpleNamespace(id="fixture"), 1
            )
        )
        for _ in range(20):
            await asyncio.sleep(0)
            active = worker._running.get(
                (worker.engine_key(coordinator), coordinator.execution.job_id)
            )
            if active is not None and active[1].done():
                break
        active = None
        dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
        await dispatcher._finish_legacy()
        assert coordinator.acks == [] and len(worker._running) == 1
        barrier.set()
        await pending
        assert coordinator.acks == [None]
    finally:
        worker.pulse = original


async def test_normal_source_task_and_heartbeat_retired_before_ack():
    coordinator = Coordinator()
    await worker.run_compatibility_export(
        Builder(coordinator), coordinator, SimpleNamespace(id="fixture"), 1
    )
    assert coordinator.acks == [None]


async def test_error_graph_is_consumed_and_only_fixed_failure_remains():
    coordinator = Coordinator()
    error = ValueError("private fixture payload")
    with pytest.raises(Exception) as caught:
        await worker.run_compatibility_export(
            Builder(coordinator, error=error), coordinator, SimpleNamespace(id="fixture"), 1
        )
    assert caught.value.detail == "export_snapshot_unavailable"
    assert error.args == () and error.__traceback__ is error.__context__ is error.__cause__ is None
    assert coordinator.acks == ["export_failed"]


async def test_cancel_before_first_source_step_acknowledged_without_frame():
    coordinator = Coordinator()
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    task = asyncio.create_task(worker.safe_build(dispatcher.builder, coordinator.execution))
    task.cancel()
    worker.register(coordinator, coordinator.execution, task)
    dispatcher.active_task = task
    dispatcher.active_execution = coordinator.execution
    await asyncio.wait({task})
    task = None
    await dispatcher._finish()
    assert coordinator.acks == ["interrupted"] and dispatcher.active_task is None


async def test_ack_retry_retains_only_scalar_outcome():
    coordinator = Coordinator()
    coordinator.ack_failure = True
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    task = asyncio.create_task(worker.safe_build(dispatcher.builder, coordinator.execution))
    worker.register(coordinator, coordinator.execution, task)
    dispatcher.active_task = task
    dispatcher.active_execution = coordinator.execution
    await asyncio.wait({task})
    task = None
    with pytest.raises(RuntimeError):
        await dispatcher._finish()
    assert dispatcher.active_task is None and dispatcher.heartbeat_task is None
    assert dispatcher.pending_ack == (coordinator.execution, None)
    coordinator.ack_failure = False
    await dispatcher._ack()
    assert dispatcher.pending_ack is None and coordinator.acks == [None]


async def test_cancel_local_owner_is_engine_and_owner_scoped():
    first, second = Coordinator(), Coordinator()
    # Give these fixture coordinators independently bound engines.
    first.sessions = SimpleNamespace(kw={"bind": object()})
    second.sessions = SimpleNamespace(kw={"bind": object()})
    a = asyncio.create_task(asyncio.Event().wait())
    b = asyncio.create_task(asyncio.Event().wait())
    first.execution.owner = "target"
    second.execution.owner = "target"
    worker.register(first, first.execution, a)
    worker.register(second, second.execution, b)
    worker.cancel_local_owner(SimpleNamespace(bind=first.sessions.kw["bind"]), "other")
    assert not a.cancelling() and not b.cancelling()
    worker.cancel_local_owner(SimpleNamespace(bind=first.sessions.kw["bind"]), "target")
    assert a.cancelling() and not b.cancelling()
    b.cancel()
    await asyncio.gather(a, b, return_exceptions=True)
    worker.forget(first, first.execution)
    worker.forget(second, second.execution)


async def test_abandoned_legacy_only_collected_after_parent_references_retire():
    coordinator = Coordinator()
    entered = asyncio.Event()
    release = asyncio.Event()

    class SlowBuilder(Builder):
        async def create(self, *args, **kwargs):
            self.coordinator.task_ref = weakref.ref(asyncio.current_task())
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
            return None

    parent = asyncio.create_task(
        worker.run_compatibility_export(
            SlowBuilder(coordinator), coordinator, SimpleNamespace(id="fixture"), 1
        )
    )
    await entered.wait()
    parent.cancel()
    with pytest.raises(asyncio.CancelledError):
        await parent
    assert coordinator.acks == []
    assert (
        worker.engine_key(coordinator),
        coordinator.execution.job_id,
    ) in worker._abandoned_legacy
    release.set()
    await asyncio.sleep(0)
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    await dispatcher._finish_legacy()
    assert coordinator.acks == [None]
    assert not worker._abandoned_legacy


@pytest.mark.parametrize(
    "probe", ["alive", "missing", "reused", "unreadable", "different_boot", "different_namespace"]
)
def test_automatic_deathproof_requires_exact_linux_identity(monkeypatch, probe):
    from app.domains.workouts import export_job_identity as identity

    current = identity.WorkerIdentity(uuid4(), 10, "boot", "pid:[1]", "100")
    record = {"pid": 20, "boot": "boot", "namespace": "pid:[1]", "start": "200"}

    def start(pid):
        assert pid == 20
        if probe == "missing":
            raise FileNotFoundError()
        if probe == "unreadable":
            raise PermissionError()
        return "999" if probe == "reused" else "200"

    monkeypatch.setattr(identity, "_start_identity", start)
    if probe == "different_boot":
        record["boot"] = "other"
    if probe == "different_namespace":
        record["namespace"] = "pid:[2]"
    assert identity.same_namespace_ended(record, current) == (probe in {"missing", "reused"})


async def test_shutdown_drops_other_task_loop_reference_before_ack():
    coordinator = Coordinator()
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    task = asyncio.create_task(worker.safe_build(dispatcher.builder, coordinator.execution))
    worker.register(coordinator, coordinator.execution, task)
    worker._abandoned_legacy.add((worker.engine_key(coordinator), coordinator.execution.job_id))
    await asyncio.wait({task})
    task = None
    assert await dispatcher.stop()
    assert coordinator.acks == [None]


async def test_shutdown_retires_heartbeat_before_actual_end_ack():
    coordinator = Coordinator()
    entered = asyncio.Event()

    class WaitingBuilder(Builder):
        async def create(self, *args, **kwargs):
            self.coordinator.task_ref = weakref.ref(asyncio.current_task())
            entered.set()
            await asyncio.Event().wait()

    dispatcher = worker.ExportJobWorker(coordinator, WaitingBuilder(coordinator))
    task = asyncio.create_task(worker.safe_build(dispatcher.builder, coordinator.execution))
    worker.register(coordinator, coordinator.execution, task)
    dispatcher.active_task = task
    dispatcher.active_execution = coordinator.execution
    dispatcher.heartbeat_task = asyncio.create_task(
        worker.pulse(coordinator, coordinator.execution, task)
    )
    task = None
    await entered.wait()
    assert await dispatcher.stop()
    assert coordinator.acks == ["interrupted"] and dispatcher.heartbeat_task is None


async def test_shutdown_bounds_cancellation_resistant_dispatcher():
    coordinator = Coordinator()
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    entered = asyncio.Event()
    release = asyncio.Event()

    async def held():
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()

    dispatcher.task = asyncio.create_task(held())
    await entered.wait()
    clock = asyncio.get_running_loop().time()
    assert not await dispatcher.stop()
    assert asyncio.get_running_loop().time() - clock < 6
    assert dispatcher.task is not None and not dispatcher.task.done() and coordinator.acks == []
    release.set()
    await asyncio.wait({dispatcher.task})
    assert await dispatcher.stop()


async def test_claim_factory_failure_keeps_unknown_capsule_without_ack(monkeypatch):
    coordinator = Coordinator()
    coordinator.configured = SimpleNamespace(
        workouts_api_enabled=True, workouts_export_jobs_enabled=True, job_worker_enabled=True
    )

    async def claim(*, capsule):
        coordinator.capsule = capsule
        capsule.execution = coordinator.execution
        return coordinator.execution

    coordinator.claim = claim
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))

    original_factory = worker.asyncio.create_task

    def failed_factory(coro, **kwargs):
        if coro.cr_code.co_name != "safe_build":
            return original_factory(coro, **kwargs)
        assert coordinator.capsule.source_created
        coro.close()
        raise RuntimeError("synthetic custom factory failed")

    monkeypatch.setattr(worker.asyncio, "create_task", failed_factory)
    with pytest.raises(Exception) as caught:
        await dispatcher.tick()
    assert caught.value.status_code == 503
    assert dispatcher.claim_capsule is coordinator.capsule and coordinator.acks == []
    assert dispatcher.active_task is None
    assert not await dispatcher.stop()


async def test_stop_bounds_resistant_heartbeat_and_retains_collector():
    coordinator = Coordinator()
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    entered = asyncio.Event()
    release = asyncio.Event()

    async def held_heartbeat(source):
        entered.set()
        while not release.is_set():
            try:
                await release.wait()
            except asyncio.CancelledError:
                pass

    source = asyncio.create_task(worker.safe_build(dispatcher.builder, coordinator.execution))
    worker.register(coordinator, coordinator.execution, source)
    dispatcher.active_task = source
    dispatcher.active_execution = coordinator.execution
    dispatcher.heartbeat_task = asyncio.create_task(held_heartbeat(source))
    await asyncio.wait({source})
    source = None
    await entered.wait()
    clock = asyncio.get_running_loop().time()
    try:
        assert not await dispatcher.stop()
        assert asyncio.get_running_loop().time() - clock < 6
        assert dispatcher.retirement_task is not None and not dispatcher.retirement_task.done()
        assert dispatcher.active_task is not None and dispatcher.heartbeat_task is not None
        assert coordinator.acks == []
        retained = dispatcher.retirement_task
        await dispatcher.tick()
        assert dispatcher.retirement_task is retained
        retained = None
    finally:
        release.set()
        await asyncio.wait({dispatcher.retirement_task}, timeout=5)
    assert await dispatcher.stop()
    assert coordinator.acks == [None] and dispatcher.retirement_task is None


async def test_stop_bounds_resistant_ack_without_inventing_end():
    coordinator = Coordinator()
    dispatcher = worker.ExportJobWorker(coordinator, Builder(coordinator))
    release = asyncio.Event()
    entered = asyncio.Event()
    original = coordinator.acknowledge_end

    async def held_ack(*args):
        entered.set()
        while not release.is_set():
            try:
                await release.wait()
            except asyncio.CancelledError:
                pass
        await original(*args)

    coordinator.acknowledge_end = held_ack
    source = asyncio.create_task(worker.safe_build(dispatcher.builder, coordinator.execution))
    worker.register(coordinator, coordinator.execution, source)
    dispatcher.active_task = source
    dispatcher.active_execution = coordinator.execution
    await asyncio.wait({source})
    source = None
    clock = asyncio.get_running_loop().time()
    try:
        assert not await dispatcher.stop()
        assert entered.is_set() and asyncio.get_running_loop().time() - clock < 6
        assert dispatcher.retirement_task is not None and not dispatcher.retirement_task.done()
        assert dispatcher.active_task is None and coordinator.acks == []
        assert dispatcher.pending_ack == (coordinator.execution, None)
    finally:
        release.set()
        await asyncio.wait({dispatcher.retirement_task}, timeout=5)
    assert await dispatcher.stop()
    assert coordinator.acks == [None] and dispatcher.retirement_task is None

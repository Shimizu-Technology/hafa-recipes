"""Meaningful control-boundary regressions, without Linux/DB execution."""

import asyncio
import signal
from types import SimpleNamespace

import pytest
from capacity.export_jobs_death_process import (
    DeathProbeError,
    HoldAfterCommit,
    bind_child,
    signal_child,
    validate_child,
)


def identities():
    return {
        "pid": 47,
        "boot": "boot",
        "namespace": "pid:[1]",
        "start": "100",
    }, SimpleNamespace(boot="boot", namespace="pid:[1]")


@pytest.mark.parametrize(
    "change",
    [
        {"pid": 48},
        {"pid": 47.0},
        {"boot": "other"},
        {"namespace": "pid:[2]"},
        {"start": ""},
        {"start": None},
    ],
)
def test_mismatched_identity_never_signals(change):
    record, current = identities()
    sent = []
    with pytest.raises(DeathProbeError):
        signal_child(
            {**record, **change},
            current,
            47,
            signal.SIGKILL,
            inspect=lambda _: "100",
            send=lambda *args: sent.append(args),
        )
    assert sent == []


def test_reused_pid_never_signals():
    record, current = identities()
    sent = []
    with pytest.raises(DeathProbeError):
        signal_child(
            record,
            current,
            47,
            signal.SIGSTOP,
            inspect=lambda _: "101",
            send=lambda *args: sent.append(args),
        )
    assert sent == []


def test_missing_process_does_not_become_signal_permission():
    record, current = identities()
    sent = []

    def missing(_):
        raise FileNotFoundError()

    with pytest.raises(FileNotFoundError):
        signal_child(
            record,
            current,
            47,
            signal.SIGKILL,
            inspect=missing,
            send=lambda *args: sent.append(args),
        )
    assert sent == []


@pytest.mark.parametrize("sig", [signal.SIGSTOP, signal.SIGKILL])
def test_exact_child_only_receives_requested_signal(sig):
    record, current = identities()
    sent = []
    signal_child(
        record,
        current,
        47,
        sig,
        inspect=lambda _: "100",
        send=lambda *args: sent.append(args),
    )
    assert sent == [(47, sig)]


def test_unrelated_signal_is_rejected():
    record, current = identities()
    with pytest.raises(DeathProbeError):
        signal_child(
            record,
            current,
            47,
            signal.SIGTERM,
            inspect=lambda _: "100",
            send=lambda *_: pytest.fail("unexpected signal"),
        )


def test_missing_current_namespace_denies_validation():
    record, current = identities()
    current.namespace = None
    with pytest.raises(DeathProbeError):
        validate_child(record, current, 47, inspect=lambda _: "100")


def test_pidfd_binding_keeps_live_direct_child_and_start_identity():
    closed = []
    bound = bind_child(
        47,
        open_fd=lambda _: 8,
        wait=lambda _: None,
        inspect=lambda _: "100",
        close=closed.append,
    )
    assert (bound.pid, bound.start, bound.fd) == (47, "100", 8)
    assert closed == []


def test_exited_child_binding_is_closed_and_refused():
    closed = []
    with pytest.raises(DeathProbeError):
        bind_child(
            47,
            open_fd=lambda _: 8,
            wait=lambda _: object(),
            inspect=lambda _: "100",
            close=closed.append,
        )
    assert closed == [8]


def test_foreign_child_binding_is_closed_and_refused():
    closed = []

    def foreign(_):
        raise ChildProcessError()

    with pytest.raises(ChildProcessError):
        bind_child(
            47,
            open_fd=lambda _: 8,
            wait=foreign,
            inspect=lambda _: "100",
            close=closed.append,
        )
    assert closed == [8]


@pytest.mark.asyncio
async def test_control_marker_follows_real_commit_and_holds_unchanged_arguments():
    entered, resume, committing = asyncio.Event(), asyncio.Event(), asyncio.Event()
    received = []
    original_result = object()
    private_bytes = b"synthetic private ciphertext"

    async def original(*args, **kwargs):
        received.append((args, kwargs))
        await committing.wait()
        return original_result

    task = asyncio.create_task(
        HoldAfterCommit(original, entered, resume)(private_bytes, execution="synthetic")
    )
    try:
        await asyncio.sleep(0)
        assert not entered.is_set()
        committing.set()
        await asyncio.wait_for(entered.wait(), 1)
        assert not task.done()
        assert received == [((private_bytes,), {"execution": "synthetic"})]
        resume.set()
        assert await task is original_result
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_failed_commit_never_reports_source_held():
    entered, resume = asyncio.Event(), asyncio.Event()

    async def failed():
        raise RuntimeError("synthetic commit failure")

    with pytest.raises(RuntimeError):
        await HoldAfterCommit(failed, entered, resume)()
    assert not entered.is_set()


@pytest.mark.asyncio
async def test_hold_propagates_cancellation_without_inventing_commit_completion():
    entered, resume = asyncio.Event(), asyncio.Event()

    async def original():
        return None

    task = asyncio.create_task(HoldAfterCommit(original, entered, resume)())
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

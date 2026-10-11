"""Exact owned-child signalling; importing this module starts nothing."""

import os
import signal
from dataclasses import dataclass
from pathlib import Path


class DeathProbeError(RuntimeError):
    """Fixed content-free failure; never retain application exceptions."""


def require(value):
    if not value:
        raise DeathProbeError("linux_death_acceptance_failed")


def process_start(pid):
    return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]


def process_state(pid):
    return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]


@dataclass(frozen=True)
class OwnedChild:
    pid: int
    start: str
    fd: int

    def signal(self, sig):
        require(sig in {signal.SIGSTOP, signal.SIGKILL})
        # A pidfd targets the captured process even if its numeric PID is reused.
        signal.pidfd_send_signal(self.fd, sig)

    def close(self):
        os.close(self.fd)


def bind_child(pid, *, open_fd=None, wait=None, inspect=process_start, close=os.close):
    """Bind a live direct child, without consuming the subprocess wait result."""
    open_fd = open_fd or os.pidfd_open
    wait = wait or (
        lambda fd: os.waitid(os.P_PIDFD, fd, os.WEXITED | os.WNOWAIT | os.WNOHANG)
    )
    fd = open_fd(pid)
    try:
        # ECHILD refuses a foreign/reused process. A result means already exited;
        # None means a live direct child. WNOWAIT leaves reaping to subprocess.
        require(wait(fd) is None)
        return OwnedChild(pid, inspect(pid), fd)
    except BaseException:
        close(fd)
        raise


def validate_child(record, current, owned_pid, *, inspect=process_start):
    require(
        isinstance(record, dict)
        and type(owned_pid) is int
        and owned_pid > 0
        and type(record.get("pid")) is int
        and record.get("pid") == owned_pid
        and record.get("boot") == current.boot
        and record.get("namespace") == current.namespace
        and bool(current.boot)
        and bool(current.namespace)
        and isinstance(record.get("start"), str)
        and bool(record["start"])
    )
    require(inspect(owned_pid) == record["start"])


def signal_child(record, current, owned_pid, sig, *, send, inspect=process_start):
    require(sig in {signal.SIGSTOP, signal.SIGKILL})
    validate_child(record, current, owned_pid, inspect=inspect)
    send(owned_pid, sig)


class HoldAfterCommit:
    """Keep the original builder's real source alive AFTER its page commit.

    The production builtin page source/context is unchanged. No row, ciphertext,
    exception argument or execution identity is written to the control pipe.
    """

    def __init__(self, original, entered, resume):
        self.original, self.entered, self.resume = original, entered, resume

    async def __call__(self, *args, **kwargs):
        result = await self.original(*args, **kwargs)
        self.entered.set()
        await self.resume.wait()
        return result

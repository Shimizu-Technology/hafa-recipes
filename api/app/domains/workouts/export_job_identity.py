"""A missing lease/connection is never proof that source memory has ended."""

import hashlib
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from uuid import UUID, uuid4


@dataclass(frozen=True)
class WorkerIdentity:
    instance: UUID
    pid: int
    boot: str | None
    namespace: str | None
    start: str | None

    def record(self):
        value = asdict(self)
        value["instance"] = str(self.instance)
        return value


def _start_identity(pid):
    # comm may contain spaces/parentheses. Fields after its LAST ')' begin at3.
    tail = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return tail[19]


def current_worker_identity():
    pid = os.getpid()
    try:
        if sys.platform != "linux":
            raise OSError()
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        namespace = os.readlink("/proc/self/ns/pid")
        start = _start_identity(pid)
    except (OSError, ValueError, IndexError):
        boot = namespace = start = None
    return WorkerIdentity(uuid4(), pid, boot, namespace, start)


def same_namespace_ended(record, current):
    """Only a verified former Linux process identity can release an orphan.

    Another namespace/host or unreadable OS state is UNKNOWN, not terminated.
    This checks actual process identity rather than timestamps/heartbeats.
    """
    if not isinstance(record, dict) or not current.boot or not current.namespace:
        return False
    if record.get("boot") != current.boot or record.get("namespace") != current.namespace:
        return False
    pid, start = record.get("pid"), record.get("start")
    if type(pid) is not int or pid <= 0 or not isinstance(start, str) or not start:
        return False
    try:
        return _start_identity(pid) != start
    except FileNotFoundError:
        return True
    except (OSError, ValueError, IndexError):
        return False


def evidence_digest(record, reason):
    return hashlib.sha256(json.dumps([reason, record], sort_keys=True).encode()).hexdigest()


class OperatorDeathVerifier:
    """Default denial; an audited trusted platform verifier must prove death."""

    def verify(self, record, evidence):
        return False

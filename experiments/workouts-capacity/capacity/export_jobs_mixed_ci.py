"""New bounded source/branch scenario; old CI and receipts remain independent."""

import argparse
import os
import platform
import signal
import sys

from capacity.ci_run import Coordinator, execute
from capacity.ci_safety import OWNER, SafetyError
from capacity.export_jobs_diagnostic_plan import build_jobs_plan
from capacity.export_jobs_mixed_receipt import (
    check_scenario,
    mixed_phase_receipt,
    mixed_public_receipt,
)

BRANCH = "codex/workouts-export-jobs-mixed"


class MixedCoordinator(Coordinator):
    driver_module = "capacity.export_jobs_mixed_driver"
    make_phase_receipt = staticmethod(mixed_phase_receipt)
    format_public_receipt = staticmethod(mixed_public_receipt)
    check_scenario = staticmethod(check_scenario)

    def preparation_plan(self):
        return build_jobs_plan(self.repo, self.plan_root, self.run_id, owner=OWNER)

    def runtime_argv(self, name, **kwargs):
        argv = super().runtime_argv(name, **kwargs)
        if kwargs.get("phase"):
            argv += [
                "-e",
                "CAPACITY_EXPORT_DIAGNOSTIC=false",
                "-e",
                "CAPACITY_EXPORT_JOBS_DIAGNOSTIC=false",
                "-e",
                "CAPACITY_EXPORT_JOBS_MIXED=true",
                "-e",
                "WORKOUTS_EXPORT_JOBS_ENABLED=true",
                "-e",
                "JOB_WORKER_ENABLED=true",
            ]
        return argv

    def api_command(self):
        return [
            self.image,
            "python",
            "-m",
            "uvicorn",
            "capacity.export_jobs_mixed_app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "18047",
        ]


def main():
    parser = argparse.ArgumentParser()
    for key in ("repository", "work", "receipt"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    if (
        platform.system() != "Linux"
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "Shimizu-Technology/hafa-recipes"
        or (os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME"))
        != BRANCH
    ):
        raise SafetyError("untrusted_ci_context")
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    return execute(
        MixedCoordinator(args.repository, args.work, args.receipt), args.cleanup_only
    )


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:  # noqa: BLE001 - preserve sanitized interruption/failure
        print("export_jobs_mixed_coordinator_failed", file=sys.stderr)
        result = 2
    raise SystemExit(result)

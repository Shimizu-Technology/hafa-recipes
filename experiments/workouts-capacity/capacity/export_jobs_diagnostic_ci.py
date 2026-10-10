"""One native-x86 background-export diagnostic; no local/provider execution."""

import argparse
import os
import platform
import signal
import sys

from capacity.ci_run import execute
from capacity.ci_safety import SafetyError
from capacity.export_diagnostic_ci import ExportCoordinator
from capacity.export_diagnostic_trace import recover
from capacity.export_jobs_diagnostic_contract import ROUTES
from capacity.export_jobs_diagnostic_receipt import receipt, summarize

BRANCH = "codex/workouts-export-jobs-diagnostic"


def recover_report(path):
    return recover(path, routes=ROUTES)


class ExportJobsCoordinator(ExportCoordinator):
    output_name = "export-jobs-diagnostic.json"
    measurements_path = "/capacity/export-jobs-diagnostic"
    app_module = "capacity.export_jobs_diagnostic_app:app"
    driver_module = "capacity.export_jobs_diagnostic_driver"
    summarize = staticmethod(summarize)
    format_receipt = staticmethod(receipt)
    recover_report = staticmethod(recover_report)

    def runtime_argv(self, name, **kwargs):
        argv = super().runtime_argv(name, **kwargs)
        if kwargs.get("phase"):
            argv += [
                "-e",
                "CAPACITY_EXPORT_DIAGNOSTIC=false",
                "-e",
                "CAPACITY_EXPORT_JOBS_DIAGNOSTIC=true",
                "-e",
                "WORKOUTS_EXPORT_JOBS_ENABLED=true",
                "-e",
                "JOB_WORKER_ENABLED=true",
            ]
        return argv


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
        ExportJobsCoordinator(args.repository, args.work, args.receipt),
        args.cleanup_only,
    )


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:  # noqa: BLE001 - never print private exception arguments
        print("export_jobs_diagnostic_coordinator_failed", file=sys.stderr)
        result = 2
    raise SystemExit(result)

"""Explicit manual synthetic comparison; never a Render plan change."""

import argparse
import os
import platform
import signal
import sys

from capacity.ci_run import execute
from capacity.ci_safety import SafetyError
from capacity.export_jobs_mixed_ci import MixedCoordinator
from capacity.legal_ci import LegalCoordinator
from capacity.resource_profiles import ProfileId


def validate_context(env):
    if (
        platform.system() != "Linux"
        or env.get("GITHUB_ACTIONS") != "true"
        or env.get("GITHUB_REPOSITORY") != "Shimizu-Technology/hafa-recipes"
        or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
    ):
        raise SafetyError("untrusted_ci_context")


def main():
    parser = argparse.ArgumentParser()
    for key in ("repository", "work", "receipt"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--scenario", choices=["mixed", "legal"], required=True)
    parser.add_argument("--resource-profile", choices=list(ProfileId), required=True)
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    validate_context(os.environ)
    coordinator = (MixedCoordinator if args.scenario == "mixed" else LegalCoordinator)(
        args.repository, args.work, args.receipt, resource_profile=args.resource_profile
    )
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    return execute(coordinator, args.cleanup_only)


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:  # noqa: BLE001 - fixed public failure only
        print("capacity_comparison_failed", file=sys.stderr)
        result = 2
    raise SystemExit(result)

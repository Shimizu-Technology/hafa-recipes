"""Explicit manual or labelled PR comparison; never a Render plan change."""

import argparse
import json
import os
import platform
import re
import signal
import sys
from pathlib import Path

from capacity.ci_run import execute
from capacity.ci_safety import SafetyError
from capacity.export_jobs_mixed_ci import MixedCoordinator
from capacity.legal_ci import LegalCoordinator
from capacity.resource_profiles import ProfileId

REPOSITORY = "Shimizu-Technology/hafa-recipes"
BRANCH = "codex/workouts-capacity-profiles"
MAX_EVENT_BYTES = 1024 * 1024
LABELS = {
    "capacity-compare-1c-2g-mixed": "mixed",
    "capacity-compare-1c-2g-legal": "legal",
}


def read_event(path):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(MAX_EVENT_BYTES + 1)
        if len(raw) > MAX_EVENT_BYTES:
            raise SafetyError("untrusted_ci_context")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise SafetyError("untrusted_ci_context")
        return value
    except (OSError, TypeError, ValueError, RecursionError):
        raise SafetyError("untrusted_ci_context") from None


def dictionary(value):
    return value if isinstance(value, dict) else {}


def validate_context(env, *, event=None, scenario=None, resource_profile=None):
    if (
        platform.system() != "Linux"
        or env.get("GITHUB_ACTIONS") != "true"
        or env.get("GITHUB_REPOSITORY") != REPOSITORY
    ):
        raise SafetyError("untrusted_ci_context")
    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        # The existing preparation verifier binds actual HEAD to GITHUB_SHA.
        return
    if env.get("GITHUB_EVENT_NAME") != "pull_request" or not isinstance(event, dict):
        raise SafetyError("untrusted_ci_context")
    pr = dictionary(event.get("pull_request"))
    head, base = dictionary(pr.get("head")), dictionary(pr.get("base"))
    label = dictionary(event.get("label")).get("name")
    source = env.get("COMPARISON_SOURCE_SHA")
    if (
        event.get("action") != "labeled"
        or dictionary(event.get("repository")).get("full_name") != REPOSITORY
        or dictionary(head.get("repo")).get("full_name") != REPOSITORY
        or dictionary(base.get("repo")).get("full_name") != REPOSITORY
        or head.get("ref") != BRANCH
        or env.get("GITHUB_HEAD_REF") != BRANCH
        or not isinstance(source, str)
        or not re.fullmatch(r"[0-9a-f]{40}", source)
        or head.get("sha") != source
        or not isinstance(label, str)
        or label not in LABELS
        or not isinstance(scenario, str)
        or scenario not in {"mixed", "legal"}
        or LABELS.get(label) != scenario
        or resource_profile != ProfileId.STANDARD
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
    event = (
        read_event(os.environ.get("GITHUB_EVENT_PATH"))
        if os.environ.get("GITHUB_EVENT_NAME") == "pull_request"
        else None
    )
    validate_context(
        os.environ,
        event=event,
        scenario=args.scenario,
        resource_profile=args.resource_profile,
    )
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

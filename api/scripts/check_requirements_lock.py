"""Fail when requirements.txt (what Render installs) drifts from uv.lock (what CI tests).

Render builds the API with ``pip install -r requirements.txt`` while CI and
local development run ``uv sync`` from ``uv.lock``. If the two disagree,
production runs package versions the test suite never exercised.

Regenerate requirements.txt after any lock change with:

    uv export --frozen --no-dev --no-hashes --no-emit-project \
        --format requirements-txt --output-file requirements.txt

The comparison ignores comments and formatting so different uv versions that
render the same pins identically in substance do not fail the check.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
EXPORT_COMMAND = [
    "uv",
    "export",
    "--frozen",
    "--no-dev",
    "--no-hashes",
    "--no-emit-project",
    "--format",
    "requirements-txt",
]
_PIN = re.compile(r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==(?P<version>[^\s;\\]+)")


def _normalize_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_pins(text: str) -> dict[str, str]:
    pins: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = _PIN.match(line)
        if match is None:
            if line.startswith("-"):
                continue  # options such as --index-url
            raise ValueError(f"Unpinned or unsupported requirement line: {raw_line!r}")
        name = _normalize_name(match.group("name"))
        version = match.group("version")
        previous = pins.setdefault(name, version)
        if previous != version:
            raise ValueError(f"{name} is pinned to both {previous} and {version}")
    return pins


def compare(requirements: dict[str, str], lock: dict[str, str]) -> list[str]:
    problems = []
    for name in sorted(requirements.keys() | lock.keys()):
        deployed, tested = requirements.get(name), lock.get(name)
        if deployed == tested:
            continue
        if deployed is None:
            problems.append(f"{name}: missing from requirements.txt (uv.lock has {tested})")
        elif tested is None:
            problems.append(f"{name}: {deployed} in requirements.txt but absent from uv.lock")
        else:
            problems.append(f"{name}: requirements.txt {deployed} != uv.lock {tested}")
    return problems


def main() -> int:
    exported = subprocess.run(
        EXPORT_COMMAND, cwd=API_ROOT, check=True, capture_output=True, text=True
    ).stdout
    requirements = (API_ROOT / "requirements.txt").read_text(encoding="utf-8")
    problems = compare(parse_pins(requirements), parse_pins(exported))
    if problems:
        print("api/requirements.txt does not match api/uv.lock:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\nRegenerate it from api/ with:\n  "
            + " ".join(EXPORT_COMMAND)
            + " --output-file requirements.txt",
            file=sys.stderr,
        )
        return 1
    print(f"api/requirements.txt matches api/uv.lock ({len(parse_pins(requirements))} pins)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

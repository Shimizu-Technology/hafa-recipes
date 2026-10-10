"""Finite native ARM Linux parser diagnostic. Never relaxes production limits."""

import importlib.metadata
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path


def main():
    if (
        os.environ.get("HAFACAPACITY_NATIVE_PDF_PROBE") != "1"
        or platform.machine() != "aarch64"
    ):
        raise RuntimeError("Explicit native ARM Linux diagnostic required")
    expected = {
        "pypdf": "6.20.0",
        "cryptography": "46.0.3",
        "cffi": "2.0.0",
        "pycparser": "2.23",
    }
    if platform.python_version() != "3.12.15" or any(
        importlib.metadata.version(k) != v for k, v in expected.items()
    ):
        raise RuntimeError("Diagnostic parser dependency graph changed")
    distro = dict(
        line.split("=", 1)
        for line in Path("/etc/os-release").read_text().splitlines()
        if "=" in line
    )
    rows = []
    for filename, expected_pages in (
        ("source-1.pdf", 1),
        ("source-30.pdf", 30),
        ("source-31.pdf", None),
        ("malformed.pdf", None),
    ):
        started = time.monotonic()
        result = subprocess.run(
            [sys.executable, "-m", "app.domains.workouts.pdf_text"],
            input=(Path("/fixtures") / filename).read_bytes(),
            capture_output=True,
            timeout=15,
            check=False,
            env={"PYTHONPATH": "/api", "PATH": os.defpath},
        )
        try:
            body = json.loads(result.stdout)
        except (ValueError, UnicodeError):
            body = {}
        parts = body.get("parts", [])
        passed = result.returncode == 0 and (
            body.get("error") == "pdf_unreadable_or_limit"
            if expected_pages is None
            else len(parts) == expected_pages
            and all(
                "Reverse lunge: 2 sets of 10 reps per side. Rest 60 seconds."
                in p.get("text", "")
                for p in parts
            )
        )
        rows.append(
            {
                "case": filename,
                "expected_pages": expected_pages,
                "returned_pages": len(parts),
                "passed": passed,
                "exit": result.returncode,
                "seconds": time.monotonic() - started,
                "error_code": body.get("error"),
            }
        )
    report = {
        "diagnostic_only": True,
        "render_parity": False,
        "architecture": platform.machine(),
        "python": platform.python_version(),
        "parser_packages": expected,
        "distro": {
            k: distro[k].strip('"') for k in ("ID", "VERSION_ID", "VERSION_CODENAME")
        },
        "production_as_limit_mib": 96,
        "production_cpu_limit_seconds": 10,
        "cases": rows,
        "passed": all(r["passed"] for r in rows),
    }
    print(json.dumps(report))
    return 0 if report["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

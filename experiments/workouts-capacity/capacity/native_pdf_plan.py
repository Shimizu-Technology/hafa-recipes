"""Prepare the finite native parser diagnostic; never execute Docker commands."""

import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ARM_BASE = (
    "python@sha256:739ba32ae445e8d58f3d90feb85f83bebc8346f8dd280fa1eb5848f4ff1ed163"
)
SOURCE_FILES = {
    "api/app/__init__.py": "api/app/__init__.py",
    "api/app/domains/workouts/pdf_text.py": "api/app/domains/workouts/pdf_text.py",
    "experiments/workouts-capacity/pdf-native.requirements.txt": "pdf-native.requirements.txt",
    "experiments/workouts-capacity/Dockerfile.pdf-native": "Dockerfile",
    "experiments/workouts-capacity/capacity/native_pdf.py": "capacity/native_pdf.py",
}


def prepare(repository, folder, run_id):
    repository, folder = Path(repository).resolve(), Path(folder).resolve()
    if folder.exists() or not re.fullmatch(r"[a-z0-9-]{1,40}", run_id):
        raise ValueError("New private diagnostic folder and bounded run ID required")
    if subprocess.check_output(
        ["git", "-C", str(repository), "status", "--porcelain", "--untracked-files=no"],
        text=True,
    ):
        raise RuntimeError("Commit source before preparing native diagnostic")
    tracked = set(
        subprocess.check_output(
            ["git", "-C", str(repository), "ls-files"], text=True
        ).splitlines()
    )
    for name in SOURCE_FILES:
        p = repository / name
        if (
            name not in tracked
            or p.is_symlink()
            or not p.is_file()
            or not p.resolve().is_relative_to(repository)
        ):
            raise RuntimeError("Only exact tracked diagnostic source is permitted")
    full = (repository / "api/requirements.txt").read_text().splitlines()
    for line in (
        (repository / "experiments/workouts-capacity/pdf-native.requirements.txt")
        .read_text()
        .splitlines()
    ):
        if (
            line
            and not line.startswith("#")
            and line not in {item.split(";", 1)[0].strip() for item in full}
        ):
            raise RuntimeError(
                "Native parser dependency differs from production requirement"
            )
    commit = subprocess.check_output(
        ["git", "-C", str(repository), "rev-parse", "HEAD"], text=True
    ).strip()
    folder.mkdir(mode=0o700, parents=True)
    context = folder / "context"
    hashes = {}
    for source, destination in SOURCE_FILES.items():
        target = context / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repository / source, target)
        hashes[destination] = hashlib.sha256(target.read_bytes()).hexdigest()
    fixture_dir = folder / "fixtures"
    fixture_dir.mkdir(
        mode=0o755
    )  # Parent0700 is private; container UID10001 reads synthetic files.
    name = f"capacity-native-pdf-{run_id}"
    image = f"hafa-native-pdf:{commit[:12]}"
    plan = {
        "source_commit": commit,
        "executed": False,
        "native_arm_only": True,
        "render_parity": False,
        "full_runtime_graph": False,
        "parser_graph_matches_production_requirements": True,
        "official_python_arm_manifest": ARM_BASE,
        "context_sha256": hashes,
        "commands": [
            {
                "step": "build_only",
                "argv": [
                    "docker",
                    "build",
                    "--platform",
                    "linux/arm64",
                    "--build-arg",
                    f"SOURCE_COMMIT={commit}",
                    "--build-arg",
                    f"PYTHON_BASE={ARM_BASE}",
                    "-t",
                    image,
                    str(context),
                ],
            },
            {
                "step": "finite_probe_REQUIRES_ROOT_INSPECTION",
                "argv": [
                    "docker",
                    "run",
                    "-d",
                    "--name",
                    name,
                    "--platform",
                    "linux/arm64",
                    "--network",
                    "none",
                    "--label",
                    "hafa.capacity.owner=native_health_preflight",
                    "--label",
                    f"hafa.capacity.run={run_id}",
                    "--memory",
                    "256m",
                    "--memory-swap",
                    "256m",
                    "--cpus",
                    "0.5",
                    "--read-only",
                    "--tmpfs",
                    "/tmp:rw,size=16m",
                    "-e",
                    "HAFACAPACITY_NATIVE_PDF_PROBE=1",
                    "-v",
                    f"{fixture_dir}:/fixtures:ro",
                    image,
                ],
            },
        ],
        "constraints": [
            "Pin final image ID before runtime",
            "Generate only independently annotated synthetic PDF fixtures",
            "Claim exact returned container ID immediately; capture metadata output, remove exact ID",
            "No database, network, provider credentials, API server or production parser changes",
            "Unchanged96MiB address-space/10s CPU/15s wall parser bounds; no fallback bypass",
        ],
    }
    (folder / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    return plan

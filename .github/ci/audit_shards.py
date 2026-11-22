"""Collect in independent processes and prove each selected file/test occurs once.

Run from api/ with the CI environment installed. No fixtures or DB are executed.
File ownership plus per-file case counts avoids unstable UUID parameter IDs.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--selection", choices=("api", "baby"))
args = parser.parse_args()
for selection in ([args.selection] if args.selection else ("api", "baby")):
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).parent.resolve()),
               BABY_FAMILY_ENABLED="true" if selection == "baby" else "false")
    with tempfile.TemporaryDirectory() as directory:
        manifests = []
        for shard in range(7):
            manifest = Path(directory) / f"{shard}.json"
            command = [sys.executable, "-m", "pytest", "-p", "ci_shards", "-c",
                       "pyproject.toml", "--rootdir=.", "--collect-only", "-q",
                       "--ci-selection", selection, "--ci-manifest", str(manifest)]
            if selection == "baby":
                command += ["-k", "baby"]
            if shard:
                command += ["--ci-shard", str(shard)]
            result = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
            if result.returncode:
                sys.exit(result.stdout + result.stderr)
            manifests.append(Counter(json.loads(manifest.read_text())))
        actual = Counter()
        owners = Counter()
        for manifest in manifests[1:]:
            actual.update(manifest)
            owners.update(manifest.keys())
        assert actual == manifests[0], (selection, actual - manifests[0], manifests[0] - actual)
        assert all(count == 1 for count in owners.values()), owners
        print(f"{selection}: {sum(actual.values())} cases in {len(actual)} files exactly once")

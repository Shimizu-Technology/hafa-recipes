"""Exercise the actual bounded shell fragments with local fake commands only."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "experiments/workouts-private-beta-capacity/run.sh"
text = SCRIPT.read_text()
start = text.index("  for ((n=0;n<60;n++)); do")
end = text.index("  common=", start)
readiness = text[start:end]
start = text.index('  if [[ -n "$pg" && "$stage" == postgres_setup_* ]]')
end = text.index("  # Retain role/state", start)
logging = text[start:end]


def shell(code, cwd):
    return subprocess.run(
        ["/bin/bash", "-c", code],
        cwd=cwd,
        env={"PATH": "/usr/bin:/bin"},
        check=False,
        capture_output=True,
        text=True,
        timeout=3,
    )


def test_socket_only_initialization_and_handoff_are_not_admitted(tmp_path):
    result = shell(
        """set -e
pg=synthetic; calls=0
sleep() { :; }
timeout() {
  [[ "$1" == 5s && "$2" == docker && "$3" == exec && "$4" == synthetic
     && "$5" == pg_isready && "$6" == -h && "$7" == 127.0.0.1 ]] || exit 91
  calls=$((calls+1))
  # First two probes see temporary socket-only init / handoff; only final TCP passes.
  [[ "$calls" -ge 3 ]]
}
"""
        + readiness
        + '\n[[ "$calls" == 4 ]]',
        tmp_path,
    )
    assert result.returncode == 0, result.stderr


def test_unavailable_tcp_exhausts_same_bound_without_starting_seed(tmp_path):
    result = shell(
        """set -e
pg=synthetic; calls=0
trap 'echo CALLS:$calls' EXIT
sleep() { :; }
timeout() { calls=$((calls+1)); return 1; }
"""
        + readiness
        + "\necho SEED_WOULD_START",
        tmp_path,
    )
    assert result.returncode == 1
    assert "SEED_WOULD_START" not in result.stdout
    assert "CALLS:61" in result.stdout


def test_only_preseed_pg_setup_log_is_captured_and_bounded(tmp_path):
    before = """set -e
pg=synthetic; work=$PWD
limited() {
  [[ "$1" == 5 && "$2" == docker && "$3" == logs && "$4" == synthetic ]] || exit 91
  head -c 100000 /dev/zero
}
"""
    result = shell(before + "\nstage=postgres_setup_off\n" + logging, tmp_path)
    assert result.returncode == 0
    assert (tmp_path / "pg-setup.log").stat().st_size == 65536
    (tmp_path / "pg-setup.log").unlink()
    result = shell(before + "\nstage=seed_enabled\n" + logging, tmp_path)
    assert result.returncode == 0
    assert not (tmp_path / "pg-setup.log").exists()

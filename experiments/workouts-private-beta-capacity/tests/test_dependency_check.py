"""Execute the actual preflight on exact source files and deliberate deltas."""

import ast
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "experiments/workouts-private-beta-capacity/run.sh"
body = SCRIPT.read_text().split("<<'CHECK_PINS'\n", 1)[1].split("\nCHECK_PINS", 1)[0]
namespace = {}
functions = ast.Module(
    body=[node for node in ast.parse(body).body if isinstance(node, ast.FunctionDef)],
    type_ignores=[],
)
# Only function definitions from this checked-in script; no imports or CLI calls.
exec(compile(functions, str(SCRIPT), "exec"), namespace)  # noqa: S102
check = namespace["require_matching_requirements"]


@pytest.fixture(scope="module")
def actual_requirements():
    def read(sha):
        return subprocess.check_output(
            ["git", "show", sha + ":api/requirements.txt"], cwd=ROOT, text=True
        )

    return (
        read("823986f48e4eb5de3075969a742f834036b5d473"),
        read("253660117800ffd83494d91230beb199851ec427"),
    )


def test_actual_pinned_pair_preserves_all_seven_platform_markers(actual_requirements):
    old, new = actual_requirements
    assert sum(" ; " in line for line in old.splitlines()) == 7
    check(old, new)


@pytest.mark.parametrize(
    "change",
    [
        lambda s: s.replace("sys_platform != 'ios'", "sys_platform == 'ios'"),
        lambda s: s.replace("brotli==1.2.0", "brotli==1.2.1"),
        lambda s: s.replace("brotli==1.2.0", "brotli[extra]==1.2.0"),
        lambda s: s + "\nunexpected-dependency==1.0.0\n",
        lambda s: s + "\npypdf==6.20.0\n",
        lambda s: s.replace("pypdf==6.20.0\n", ""),
        lambda s: "\n".join(reversed(s.splitlines())),
    ],
    ids=["marker", "version", "extras", "unexpected", "duplicate", "missing", "order"],
)
def test_dependency_difference_is_rejected(actual_requirements, change):
    old, new = actual_requirements
    with pytest.raises(AssertionError):
        check(old, change(new))

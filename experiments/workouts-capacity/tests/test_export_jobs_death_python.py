"""Local ARM base/runtime enforcement; no Docker or registry calls."""

import copy

import pytest
from capacity.ci_safety import SafetyError
from capacity.export_jobs_death_python import (
    ARM_CONFIG,
    ARM_DIGEST,
    ARM_IMAGE,
    SOURCE,
    VERSION,
    local_build_argv,
    verify_base_image,
    verify_runtime,
)
from capacity.plan import PYTHON_BASE


def image():
    return {
        "Id": ARM_CONFIG,
        "Architecture": "arm64",
        "Os": "linux",
        "RepoDigests": ["python@" + ARM_DIGEST],
        "Config": {"Env": ["PYTHON_VERSION=" + VERSION]},
    }


def test_local_base_selection_preserves_generic_x86_pin_and_original_arguments():
    original = [
        "docker",
        "build",
        "--platform",
        "linux/arm64",
        "--build-arg",
        "PYTHON_BASE=" + PYTHON_BASE,
        "context",
    ]
    selected = local_build_argv(original)
    assert (
        PYTHON_BASE
        == "python@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d"
    )
    assert original[5] == "PYTHON_BASE=" + PYTHON_BASE
    assert selected[5] == "PYTHON_BASE=" + ARM_IMAGE


@pytest.mark.parametrize("fault", ["platform", "tag", "missing-buildarg"])
def test_invalid_local_build_is_not_silently_overridden(fault):
    argv = [
        "docker",
        "build",
        "--platform",
        "linux/arm64",
        "--build-arg",
        "PYTHON_BASE=" + PYTHON_BASE,
        "context",
    ]
    if fault == "platform":
        argv[3] = "linux/amd64"
    elif fault == "tag":
        argv[5] = "PYTHON_BASE=python:latest"
    else:
        argv[4] = "--label"
    with pytest.raises(SafetyError):
        local_build_argv(argv)


def test_verified_official_arm_base_passes():
    assert verify_base_image(image()) == SOURCE


@pytest.mark.parametrize(
    "fault", ["config", "architecture", "os", "manifest", "version"]
)
def test_base_provenance_drift_refuses_before_build(fault):
    value = copy.deepcopy(image())
    if fault == "config":
        value["Id"] = "sha256:" + "0" * 64
    elif fault == "architecture":
        value["Architecture"] = "amd64"
    elif fault == "os":
        value["Os"] = "windows"
    elif fault == "manifest":
        value["RepoDigests"] = []
    else:
        value["Config"]["Env"] = ["PYTHON_VERSION=3.12.14"]
    with pytest.raises(SafetyError):
        verify_base_image(value)


@pytest.mark.parametrize(
    "machine,version", [("x86_64", VERSION), ("arm64", VERSION), ("aarch64", "3.12.14")]
)
def test_running_interpreter_must_qualify_independently_of_arm_image_labels(
    machine, version
):
    assert image()["Architecture"] == "arm64"
    with pytest.raises(SafetyError):
        verify_runtime(machine, version)


def test_actual_native_interpreter_contract_passes():
    verify_runtime("aarch64", VERSION)

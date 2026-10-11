"""Local ARM database selection/provenance; no registry or Docker calls."""

import copy

import pytest
from capacity.ci_safety import SafetyError
from capacity.export_jobs_death_postgres import (
    ARM_CONFIG,
    ARM_DIGEST,
    ARM_IMAGE,
    ARM_VERSION,
    SOURCE,
    local_pg_argv,
    verify_pg_image,
)
from capacity.plan import POSTGRES_BASE


def image():
    return {
        "Id": ARM_CONFIG,
        "Architecture": "arm64",
        "Os": "linux",
        "RepoDigests": ["postgres@" + ARM_DIGEST],
        "Config": {"Env": ["PG_MAJOR=15", "PG_VERSION=" + ARM_VERSION]},
    }


def test_local_selection_preserves_original_x86_ci_pin_and_command():
    original = [
        "docker",
        "--context",
        "desktop-linux",
        "run",
        "--platform",
        "linux/arm64",
        POSTGRES_BASE,
    ]
    selected = local_pg_argv(original)
    assert (
        original[-1]
        == POSTGRES_BASE
        == "postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551"
    )
    assert selected == [*original[:-1], ARM_IMAGE]


@pytest.mark.parametrize("fault", ["platform", "unpinned-source"])
def test_wrong_local_plan_cannot_get_silent_platform_override(fault):
    argv = ["docker", "run", "--platform", "linux/arm64", POSTGRES_BASE]
    if fault == "platform":
        argv[3] = "linux/amd64"
    else:
        argv[-1] = "postgres:latest"
    with pytest.raises(SafetyError):
        local_pg_argv(argv)


def test_official_arm_digest_config_and_major_are_verified():
    assert verify_pg_image(image()) == SOURCE


@pytest.mark.parametrize(
    "fault",
    ["config", "architecture", "os", "manifest", "major", "version", "missing-env"],
)
def test_image_drift_is_rejected_before_database_start(fault):
    value = copy.deepcopy(image())
    if fault == "config":
        value["Id"] = "sha256:" + "0" * 64
    elif fault == "architecture":
        value["Architecture"] = "amd64"
    elif fault == "os":
        value["Os"] = "windows"
    elif fault == "manifest":
        value["RepoDigests"] = ["postgres@sha256:" + "0" * 64]
    elif fault == "major":
        value["Config"]["Env"][0] = "PG_MAJOR=16"
    elif fault == "version":
        value["Config"]["Env"][1] = "PG_VERSION=16.0"
    else:
        value["Config"]["Env"] = []
    with pytest.raises(SafetyError):
        verify_pg_image(value)

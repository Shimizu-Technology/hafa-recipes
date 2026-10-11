"""Official native ARM Python base for the LOCAL probe; CI x86 pin unchanged.

Registry metadata2026-10-11: python3.12.15-slim-bookworm LinuxARM64/v8
manifest739ba...163/configeb7d...629. Final actual Python runtime must still
report aarch64/3.12.15; image labels are insufficient, as failed858 proved.
"""

from capacity.ci_safety import SafetyError
from capacity.plan import PYTHON_BASE

ARM_DIGEST = "sha256:739ba32ae445e8d58f3d90feb85f83bebc8346f8dd280fa1eb5848f4ff1ed163"
ARM_IMAGE = "docker.io/library/python@" + ARM_DIGEST
ARM_CONFIG = "sha256:eb7d16fec874f15b584063275012ac719885a2b87574d124c0da9c156d504629"
VERSION = "3.12.15"
SOURCE = {
    "repository": "docker.io/library/python",
    "image": ARM_IMAGE,
    "manifest_digest": ARM_DIGEST,
    "config_digest": ARM_CONFIG,
    "architecture": "arm64",
    "os": "linux",
    "version": VERSION,
    "official_source": "https://github.com/docker-library/python.git#2a3b794c223ab067d122719541cdd54a068732a5:3.12/slim-bookworm",
}


def require(value):
    if not value:
        raise SafetyError("linux_death_native_python_rejected")


def local_build_argv(argv):
    original = "PYTHON_BASE=" + PYTHON_BASE
    require(argv.count(original) == 1)
    require(
        "--platform" in argv and argv[argv.index("--platform") + 1] == "linux/arm64"
    )
    position = argv.index(original)
    require(position > 0 and argv[position - 1] == "--build-arg")
    result = list(argv)
    result[position] = "PYTHON_BASE=" + ARM_IMAGE
    return result


def verify_base_image(image):
    require(isinstance(image, dict))
    require(
        image.get("Id") == ARM_CONFIG
        and image.get("Architecture") == "arm64"
        and image.get("Os") == "linux"
    )
    require(
        any(
            value in {"python@" + ARM_DIGEST, ARM_IMAGE}
            for value in image.get("RepoDigests", [])
        )
    )
    environment = dict(
        value.split("=", 1)
        for value in image.get("Config", {}).get("Env", [])
        if "=" in value
    )
    require(environment.get("PYTHON_VERSION") == VERSION)
    return dict(SOURCE)


def verify_runtime(machine, version):
    # This observes the running interpreter, rather than its Docker label.
    require(machine == "aarch64" and version == VERSION)

"""Official PostgreSQL15 ARM pin for the LOCAL kernel probe only.

Registry metadata observed2026-10-11: docker.io/library/postgres:15 index artifact
c961aa287d8698297cb26cdfadfbe9fd2cbaf77e53cfffe9636e8d8a1e4d842c
selects the Linuxarm64/v8 descriptor below. Config declares PG_MAJOR15,
PG_VERSION15.19-1.pgdg13+2, architecturearm64 and OSlinux. Original native-x86
CI POSTGRES_BASE remains unchanged. This is not database/Render parity.
"""

from capacity.ci_safety import SafetyError
from capacity.plan import POSTGRES_BASE

ARM_DIGEST = "sha256:7edb00ef081f792e6b08ff2990bb72de1b842581de7cfe516d63c9ce293b26ab"
ARM_IMAGE = "docker.io/library/postgres@" + ARM_DIGEST
ARM_CONFIG = "sha256:f6a528436858e8356a8f9265e67eebf2067a3d8cccc90fc800f8d10fb21c7f35"
ARM_VERSION = "15.19-1.pgdg13+2"
SOURCE = {
    "repository": "docker.io/library/postgres",
    "image": ARM_IMAGE,
    "manifest_digest": ARM_DIGEST,
    "config_digest": ARM_CONFIG,
    "architecture": "arm64",
    "os": "linux",
    "major": "15",
    "version": ARM_VERSION,
    "official_source": "https://github.com/docker-library/postgres.git#3cfb3b50d63453da51a439b25a1e18af563c3e2b:15/trixie",
}


def require(value):
    if not value:
        raise SafetyError("linux_death_postgres_platform_rejected")


def local_pg_argv(argv):
    require(argv and argv[-1] == POSTGRES_BASE)
    require(
        "--platform" in argv and argv[argv.index("--platform") + 1] == "linux/arm64"
    )
    # Copy only this local command. Never modify the generic plan/CI constant.
    return [*argv[:-1], ARM_IMAGE]


def verify_pg_image(image):
    require(isinstance(image, dict))
    require(
        image.get("Id") == ARM_CONFIG
        and image.get("Architecture") == "arm64"
        and image.get("Os") == "linux"
    )
    require(
        any(
            value in {"postgres@" + ARM_DIGEST, ARM_IMAGE}
            for value in image.get("RepoDigests", [])
        )
    )
    environment = dict(
        value.split("=", 1)
        for value in image.get("Config", {}).get("Env", [])
        if "=" in value
    )
    require(
        environment.get("PG_MAJOR") == "15"
        and environment.get("PG_VERSION") == ARM_VERSION
    )
    return dict(SOURCE)

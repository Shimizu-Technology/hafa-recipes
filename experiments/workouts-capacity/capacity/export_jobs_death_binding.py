"""Bind Docker operations to reviewed local context/socket/daemon identity."""

import posixpath
import re
from urllib.parse import urlsplit
from uuid import UUID

from capacity.ci_safety import SafetyError


def require(value):
    if not value:
        raise SafetyError("linux_death_docker_binding_rejected")


def validate_shape(binding):
    require(
        isinstance(binding, dict)
        and set(binding) == {"context", "endpoint", "daemon_id", "daemon_name"}
    )
    require(
        isinstance(binding["context"], str)
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", binding["context"])
    )
    require(isinstance(binding["endpoint"], str))
    endpoint = urlsplit(binding["endpoint"])
    require(
        endpoint.scheme == "unix"
        and not endpoint.netloc
        and not endpoint.query
        and not endpoint.fragment
    )
    require(
        endpoint.path.startswith("/")
        and posixpath.normpath(endpoint.path) == endpoint.path
        and endpoint.path.endswith(".sock")
    )
    require(isinstance(binding["daemon_id"], str))
    try:
        require(str(UUID(binding["daemon_id"])) == binding["daemon_id"])
    except ValueError:
        raise SafetyError("linux_death_docker_binding_rejected") from None
    require(isinstance(binding["daemon_name"], str) and bool(binding["daemon_name"]))


def verify_context(binding, context):
    validate_shape(binding)
    require(isinstance(context, dict))
    require(context.get("Name") == binding["context"])
    require(
        context.get("Endpoints", {}).get("docker", {}).get("Host")
        == binding["endpoint"]
    )


def verify_binding(binding, context, daemon):
    verify_context(binding, context)
    require(isinstance(daemon, dict))
    require(
        daemon.get("ID") == binding["daemon_id"]
        and daemon.get("Name") == binding["daemon_name"]
    )
    require(
        daemon.get("OSType") == "linux"
        and daemon.get("Architecture") in {"aarch64", "arm64"}
    )


def selected(argv, context):
    require(argv and argv[0] == "docker")
    if len(argv) > 2 and argv[1] == "--context":
        require(argv[2] == context)
        return list(argv)
    return ["docker", "--context", context, *argv[1:]]


def unselected(argv, context):
    require(argv[:3] == ["docker", "--context", context])
    return ["docker", *argv[3:]]

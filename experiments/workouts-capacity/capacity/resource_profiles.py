"""Closed synthetic API budgets; no environment overrides or Render mutations."""

from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType


class ProfileId(StrEnum):
    STARTER = "render-0.5c-512mb"
    STANDARD = "render-1c-2g"


@dataclass(frozen=True)
class ResourceProfile:
    id: ProfileId
    memory_mib: int
    cpu_millicores: int
    pass_peak_mib: int
    stop_mib: int

    @property
    def memory_bytes(self):
        return self.memory_mib * 2**20

    @property
    def pass_bytes(self):
        return self.pass_peak_mib * 2**20

    @property
    def stop_bytes(self):
        return self.stop_mib * 2**20

    @property
    def cpus(self):
        return self.cpu_millicores / 1000

    def metadata(self):
        return {
            "id": self.id.value,
            "memory_limit_bytes": self.memory_bytes,
            "memory_swap_bytes": self.memory_bytes,
            "cpu_millicores": self.cpu_millicores,
            "pass_peak_bytes": self.pass_bytes,
            "stop_bytes": self.stop_bytes,
        }


PROFILES = MappingProxyType(
    {
        ProfileId.STARTER: ResourceProfile(ProfileId.STARTER, 512, 500, 410, 460),
        ProfileId.STANDARD: ResourceProfile(ProfileId.STANDARD, 2048, 1000, 1640, 1840),
    }
)


def resolve(name=None):
    """None preserves the historical budget; arbitrary instances are refused."""
    if name is not None and not isinstance(name, str):
        raise ValueError("invalid_resource_profile")
    try:
        return PROFILES[ProfileId(ProfileId.STARTER if name is None else name)]
    except (ValueError, KeyError):
        raise ValueError("invalid_resource_profile") from None


def checked_metadata(value):
    if not isinstance(value, dict):
        raise TypeError("invalid_resource_profile")
    expected = resolve(value.get("id")).metadata()
    if set(value) != set(expected) or any(
        type(value[key]) is not type(item) or value[key] != item
        for key, item in expected.items()
    ):
        raise ValueError("invalid_resource_profile")
    return expected


def same_profile_evidence(name, report, samples, baseline=None):
    expected = resolve(name).metadata()
    try:
        records = [report, *samples] + ([baseline] if baseline is not None else [])
        return bool(samples) and all(
            checked_metadata(row.get("resource_profile")) == expected for row in records
        )
    except (ValueError, TypeError, AttributeError):
        return False


def cpu_matches(value, profile):
    """Verify observed Docker CPU quota, refusing conflicting or absent limits."""
    nano, quota, period = (
        value.get(key) for key in ("nano_cpus", "cpu_quota", "cpu_period")
    )
    if any(type(item) is not int for item in (nano, quota, period)):
        return False
    expected = profile.cpu_millicores * 1_000_000
    quota_matches = (
        quota > 0 and period > 0 and quota * 1000 == period * profile.cpu_millicores
    )
    if nano > 0:
        return nano == expected and (quota in (0, -1) or quota_matches)
    return nano == 0 and quota_matches

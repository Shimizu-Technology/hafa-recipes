"""Inspectable owned045 seed plan. Never starts/builds Docker or sends traffic."""

from capacity.plan import build_plan
from capacity.resource_profiles import resolve


def build_jobs_plan(
    repository, output, run_id, *, owner="capacity_ci", resource_profile=None
):
    return build_plan(
        repository,
        output,
        run_id,
        resolve(resource_profile).cpus,
        owner=owner,
        resource_profile=resource_profile,
        fixture_overrides={"WORKOUTS_EXPORT_JOBS_ENABLED": "true"},
    )

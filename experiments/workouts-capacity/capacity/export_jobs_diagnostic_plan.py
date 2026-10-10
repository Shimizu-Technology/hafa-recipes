"""Inspectable owned045 seed plan. Never starts/builds Docker or sends traffic."""

from capacity.plan import build_plan


def build_jobs_plan(repository, output, run_id, *, owner="capacity_ci"):
    return build_plan(
        repository,
        output,
        run_id,
        0.5,
        owner=owner,
        fixture_overrides={"WORKOUTS_EXPORT_JOBS_ENABLED": "true"},
    )

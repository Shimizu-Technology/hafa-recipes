"""Unit contracts for the legacy thumbnail backfill command."""

from uuid import UUID

import httpx
import pytest

from app.thumbnail_backfill import (
    BackfillPlan,
    PlanItem,
    ThumbnailBackfillBlocked,
    _build_parser,
    _failure_code,
    _validate_apply_arguments,
    _validate_plan_expectations,
)


def _item(recipe_id: str, *, source_bytes: int) -> PlanItem:
    """Build one deterministic eligible plan item."""
    return PlanItem(
        recipe_id=UUID(recipe_id),
        content_revision=1,
        source_url="https://images.example/secret-path.jpg?token=private",
        source_url_hash="a" * 64,
        classification="eligible",
        source_kind="external",
        source_bytes=source_bytes,
        source_sha256="b" * 64,
    )


def test_plan_digest_is_deterministic_and_summary_never_exposes_urls():
    plan = BackfillPlan(
        after_recipe_id=None,
        batch_size=50,
        destination_fingerprint="e" * 64,
        transform_version="test-transform-v1",
        release_id="test-release",
        items=(
            _item("10000000-0000-4000-8000-000000000001", source_bytes=123),
        ),
    )

    assert plan.digest == plan.digest
    assert plan.source_bytes == 123
    summary = plan.summary()
    assert summary["status"] == "would_apply"
    assert summary["inventory"] == {"eligible": 1}
    assert summary["origins"] == {"external": 1}
    assert "images.example" not in str(summary)
    assert "private" not in str(summary)


@pytest.mark.parametrize(
    "missing",
    [
        "backfill_id",
        "restore_point",
        "expected_rows",
        "expected_source_bytes",
        "expected_destination_fingerprint",
        "expected_plan_digest",
        "expected_release_id",
    ],
)
def test_apply_requires_every_expectation_lock(missing):
    values = {
        "backfill_id": "legacy-images-2026-09-06-batch-1",
        "restore_point": "verified-neon-restore-point",
        "expected_rows": 5,
        "expected_source_bytes": 1_024,
        "expected_destination_fingerprint": "e" * 64,
        "expected_plan_digest": "c" * 64,
        "expected_release_id": "render-commit-abc123",
        "max_attempts": 3,
    }
    values[missing] = None

    with pytest.raises(ThumbnailBackfillBlocked, match="requires"):
        _validate_apply_arguments(**values)


def test_cli_is_dry_run_by_default_and_bounds_scope():
    parser = _build_parser()

    dry_run = parser.parse_args([])
    apply = parser.parse_args(
        [
            "--apply",
            "--backfill-id",
            "batch-1",
            "--restore-point",
            "backup-1",
            "--expected-rows",
            "20",
            "--expected-source-bytes",
            "4096",
            "--expected-plan-digest",
            "d" * 64,
            "--batch-size",
            "20",
        ]
    )

    assert dry_run.apply is False
    assert dry_run.batch_size == 50
    assert apply.apply is True
    assert apply.batch_size == 20


def test_failure_codes_distinguish_missing_and_oversized_sources():
    request = httpx.Request("GET", "https://images.example/missing.png")
    response = httpx.Response(404, request=request)
    missing = httpx.HTTPStatusError(
        "not found",
        request=request,
        response=response,
    )

    assert _failure_code(missing) == "missing_object"
    assert _failure_code(ValueError("Thumbnail exceeds maximum size")) == "oversized"


def test_apply_plan_is_bound_to_destination_and_transform_contract():
    plan = BackfillPlan(
        after_recipe_id=None,
        batch_size=1,
        destination_fingerprint="e" * 64,
        transform_version="test-transform-v1",
        release_id="test-release",
        items=(_item("10000000-0000-4000-8000-000000000001", source_bytes=123),),
    )

    with pytest.raises(ThumbnailBackfillBlocked, match="destination or transform"):
        _validate_plan_expectations(
            plan,
            expected_rows=1,
            expected_source_bytes=123,
            expected_destination_fingerprint="f" * 64,
            expected_plan_digest=plan.digest,
        )


@pytest.mark.parametrize(
    "restore_point",
    [None, "", "   ", "backup\nname", "https://backup.example"],
)
def test_apply_rejects_unsafe_restore_point_labels(restore_point):
    with pytest.raises(ThumbnailBackfillBlocked, match="restore-point"):
        _validate_apply_arguments(
            backfill_id="batch-1",
            restore_point=restore_point,
            expected_rows=1,
            expected_source_bytes=100,
            expected_destination_fingerprint="e" * 64,
            expected_plan_digest="d" * 64,
            expected_release_id="render-commit-abc123",
            max_attempts=3,
        )

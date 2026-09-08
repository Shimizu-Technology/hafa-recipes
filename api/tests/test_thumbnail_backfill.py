"""Unit contracts for the legacy thumbnail backfill command."""

from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest

from app.thumbnail_backfill import (
    MAX_ATTEMPTS,
    MAX_BATCH_SIZE,
    BackfillPlan,
    PlanItem,
    ThumbnailBackfillBlocked,
    _build_parser,
    _failure_code,
    _release_backfill_lock,
    _try_acquire_backfill_lock,
    _validate_apply_arguments,
    _validate_plan_expectations,
    _validate_scope,
)


class _LockResult:
    def __init__(self, *, acquired: bool, backend_pid: int) -> None:
        self.row = SimpleNamespace(acquired=acquired, backend_pid=backend_pid)

    def one(self):
        return self.row


class _LockConnection:
    def __init__(self, *, acquired: bool = True, backend_pid: int = 1234) -> None:
        self.acquired = acquired
        self.backend_pid = backend_pid
        self.statements: list[str] = []
        self.commit_count = 0

    async def execute(self, statement, _parameters=None):
        self.statements.append(str(statement))
        return _LockResult(acquired=self.acquired, backend_pid=self.backend_pid)

    async def commit(self) -> None:
        self.commit_count += 1


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


@pytest.mark.asyncio
async def test_global_lock_keeps_transaction_open_for_transaction_pooler():
    connection = _LockConnection()

    backend_pid = await _try_acquire_backfill_lock(connection)  # type: ignore[arg-type]

    assert backend_pid == 1234
    assert "pg_try_advisory_xact_lock" in connection.statements[0]
    assert "pg_try_advisory_lock(" not in connection.statements[0]
    assert connection.commit_count == 0

    await _release_backfill_lock(connection)  # type: ignore[arg-type]

    assert connection.commit_count == 1
    assert len(connection.statements) == 1


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
        "expected_plan_release_id": None,
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


@pytest.mark.parametrize("batch_size", [0, MAX_BATCH_SIZE + 1])
def test_scope_rejects_out_of_bounds_batch_size(batch_size):
    with pytest.raises(ThumbnailBackfillBlocked, match="batch_size must be between"):
        _validate_scope(batch_size=batch_size, after_recipe_id=None)


def test_apply_rejects_out_of_bounds_attempt_limit():
    with pytest.raises(ThumbnailBackfillBlocked, match="max_attempts must be between"):
        _validate_apply_arguments(
            backfill_id="legacy-images-batch-1",
            restore_point="verified-restore-point",
            expected_rows=1,
            expected_source_bytes=1,
            expected_destination_fingerprint="e" * 64,
            expected_plan_digest="d" * 64,
            expected_release_id="release-1",
            expected_plan_release_id=None,
            max_attempts=MAX_ATTEMPTS + 1,
        )


@pytest.mark.parametrize("plan_release_id", ["", "   ", "release\nname"])
def test_apply_rejects_unsafe_plan_release_id(plan_release_id):
    with pytest.raises(ThumbnailBackfillBlocked, match="plan-release-id"):
        _validate_apply_arguments(
            backfill_id="legacy-images-batch-1",
            restore_point="verified-restore-point",
            expected_rows=1,
            expected_source_bytes=1,
            expected_destination_fingerprint="e" * 64,
            expected_plan_digest="d" * 64,
            expected_release_id="current-release",
            expected_plan_release_id=plan_release_id,
            max_attempts=3,
        )


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
            expected_plan_release_id=None,
            max_attempts=3,
        )

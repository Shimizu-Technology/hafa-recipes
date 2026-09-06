"""PostgreSQL coverage for the resumable legacy thumbnail backfill."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Awaitable, Callable
from importlib import import_module
from urllib.parse import urlparse

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.image_validation import ValidatedImage
from app.thumbnail_backfill import (
    BACKFILL_LOCK_NAME,
    ThumbnailBackfillBlocked,
    run_backfill,
)
from tests.database_safety import require_disposable_test_database

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
DESTRUCTIVE_TEST_ENABLED = (
    os.environ.get("THUMBNAIL_BACKFILL_DESTRUCTIVE_TEST") == "1"
)
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or not DESTRUCTIVE_TEST_ENABLED,
    reason=(
        "A disposable TEST_DATABASE_URL and "
        "THUMBNAIL_BACKFILL_DESTRUCTIVE_TEST=1 are required"
    ),
)


class SyntheticInterruption(BaseException):
    """Interrupt apply mode without being collapsed into a retryable failure."""


class FakeThumbnailStorage:
    """Deterministic storage double with optional concurrency/interruption hooks."""

    is_enabled = True

    def __init__(self, sources: dict[str, bytes | Exception]):
        self.sources = sources
        self.fetch_calls: list[str] = []
        self.store_calls: list[str] = []
        self.prepare_hook: Callable[[], Awaitable[None]] | None = None
        self.interrupt_store_call: int | None = None
        self.did_interrupt = False
        self.destination_fingerprint = "e" * 64
        self.transform_version = "test-transform-v1"
        self.release_id = "integration-test-release"

    def thumbnail_origin(self, image_url: str) -> str:
        return "app_owned" if self._is_owned_host(image_url) else "external"

    @staticmethod
    def _is_owned_host(image_url: str) -> bool:
        return urlparse(image_url).hostname in {
            "recipe-images.s3.us-west-2.amazonaws.com",
            "media.example",
        }

    def is_owned_versioned_thumbnail_url(
        self,
        image_url: str | None,
        recipe_id,
    ) -> bool:
        return bool(
            image_url
            and self._is_owned_host(image_url)
            and f"/thumbnails/{recipe_id}/" in image_url
            and image_url.endswith(("/list.webp", "/hero.webp"))
        )

    def thumbnail_backfill_contract(self) -> dict[str, str]:
        return {
            "destination_fingerprint": self.destination_fingerprint,
            "transform_version": self.transform_version,
            "release_id": self.release_id,
        }

    async def fetch_thumbnail_source(self, image_url: str, _recipe_id) -> ValidatedImage:
        self.fetch_calls.append(image_url)
        result = self.sources[image_url]
        if isinstance(result, Exception):
            raise result
        return ValidatedImage(
            data=result,
            content_type="image/png",
            width=2,
            height=2,
        )

    async def prepare_thumbnail_variants(
        self,
        image: ValidatedImage,
    ) -> dict[str, ValidatedImage]:
        if self.prepare_hook is not None:
            hook = self.prepare_hook
            self.prepare_hook = None
            await hook()
        return {
            "list": ValidatedImage(
                data=b"list:" + image.data,
                content_type="image/webp",
                width=2,
                height=2,
            ),
            "hero": ValidatedImage(
                data=b"hero:" + image.data,
                content_type="image/webp",
                width=2,
                height=2,
            ),
        }

    async def store_prepared_thumbnail_variants_locked(
        self,
        variants: dict[str, ValidatedImage],
        recipe_id,
    ) -> str:
        self.store_calls.append(str(recipe_id))
        if (
            self.interrupt_store_call == len(self.store_calls)
            and not self.did_interrupt
        ):
            self.did_interrupt = True
            raise SyntheticInterruption()
        digest = hashlib.sha256()
        for name in sorted(variants):
            digest.update(name.encode())
            digest.update(b"\0")
            digest.update(variants[name].data)
        return (
            "https://recipe-images.s3.us-west-2.amazonaws.com/"
            f"thumbnails/{recipe_id}/{digest.hexdigest()}/hero.webp"
        )


async def _reset_schema(database_engine: AsyncEngine) -> None:
    """Reset only the disposable integration-test database schema."""
    require_disposable_test_database(TEST_DATABASE_URL)
    parsed = make_url(TEST_DATABASE_URL or "")
    if parsed.host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Thumbnail backfill destructive tests require local PostgreSQL")
    if not DESTRUCTIVE_TEST_ENABLED:
        raise RuntimeError("Thumbnail backfill destructive test opt-in is required")
    async with database_engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))


async def _create_recipe_schema(database_engine: AsyncEngine) -> None:
    """Create the minimal recipe projection used by the operational command."""
    async with database_engine.begin() as connection:
        await connection.execute(text("""
            CREATE TABLE recipes (
                id UUID PRIMARY KEY,
                thumbnail_url TEXT,
                content_revision INTEGER NOT NULL DEFAULT 1,
                is_public BOOLEAN NOT NULL DEFAULT TRUE,
                extracted JSONB NOT NULL DEFAULT '{}'::jsonb
            )
        """))
        audit_migration = import_module(
            "migrations.028_add_thumbnail_backfill_audit"
        )
        await audit_migration.install_thumbnail_backfill_audit_schema(connection)


async def _insert_recipe(
    database_engine: AsyncEngine,
    *,
    recipe_id: str,
    thumbnail_url: str | None,
    content_revision: int = 1,
    is_public: bool = True,
) -> None:
    """Insert one synthetic recipe without production user data."""
    async with database_engine.begin() as connection:
        await connection.execute(
            text("""
                INSERT INTO recipes (
                    id, thumbnail_url, content_revision, is_public, extracted
                )
                VALUES (
                    CAST(:recipe_id AS UUID), :thumbnail_url, :content_revision,
                    :is_public,
                    CAST(:extracted AS JSONB)
                )
            """),
            {
                "recipe_id": recipe_id,
                "thumbnail_url": thumbnail_url,
                "content_revision": content_revision,
                "is_public": is_public,
                "extracted": json.dumps({"title": "Synthetic", "media": {}}),
            },
        )


def _apply_kwargs(plan: dict, *, backfill_id: str) -> dict:
    """Convert a dry-run result into the explicit apply expectation locks."""
    return {
        "apply": True,
        "backfill_id": backfill_id,
        "restore_point": "verified-disposable-test-restore-point",
        "expected_rows": plan["scanned_rows"],
        "expected_source_bytes": plan["expected_source_bytes"],
        "expected_destination_fingerprint": plan["destination_fingerprint"],
        "expected_plan_digest": plan["plan_digest"],
        "expected_release_id": plan["release_id"],
        "batch_size": plan["batch_size"],
    }


@pytest.mark.asyncio
async def test_backfill_is_dry_run_audited_retryable_and_idempotent():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    ready_hash = "a" * 64
    ready_recipe_id = "10000000-0000-4000-8000-000000000002"
    eligible_url = "https://images.example/eligible.png?token=not-audited"
    failed_url = "https://images.example/temporarily-unavailable.png"
    private_url = "https://images.example/private.png"
    storage = FakeThumbnailStorage(
        {
            eligible_url: b"eligible-source",
            failed_url: ValueError("synthetic unavailable source"),
            private_url: b"private-source",
        }
    )
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        await _insert_recipe(
            database_engine,
            recipe_id="10000000-0000-4000-8000-000000000001",
            thumbnail_url=None,
        )
        await _insert_recipe(
            database_engine,
            recipe_id=ready_recipe_id,
            thumbnail_url=(
                f"https://media.example/thumbnails/{ready_recipe_id}/"
                f"{ready_hash}/hero.webp"
            ),
        )
        await _insert_recipe(
            database_engine,
            recipe_id="10000000-0000-4000-8000-000000000003",
            thumbnail_url=eligible_url,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="10000000-0000-4000-8000-000000000004",
            thumbnail_url=failed_url,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="10000000-0000-4000-8000-000000000005",
            thumbnail_url=private_url,
            is_public=False,
        )

        first_plan = await run_backfill(
            database_engine=database_engine,
            storage=storage,
        )
        second_plan = await run_backfill(
            database_engine=database_engine,
            storage=storage,
        )
        assert first_plan == second_plan
        assert first_plan["inventory"] == {
            "eligible": 1,
            "failed": 1,
            "missing": 1,
            "ready": 1,
        }
        assert first_plan["expected_source_bytes"] == len(b"eligible-source")
        assert first_plan["origins"] == {"app_owned": 1, "external": 2}
        assert private_url not in storage.fetch_calls
        assert "not-audited" not in str(first_plan)
        async with database_engine.connect() as connection:
            assert await connection.scalar(
                text("SELECT COUNT(*) FROM thumbnail_backfill_runs")
            ) == 0

        applied = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **_apply_kwargs(first_plan, backfill_id="integration-batch-1"),
        )
        assert applied["status"] == "retryable_failures"
        assert applied["processed"] == {"failed": 1, "succeeded": 1}
        assert len(storage.store_calls) == 1

        storage.sources[failed_url] = b"recovered-source"
        resumed = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **_apply_kwargs(first_plan, backfill_id="integration-batch-1"),
        )
        assert resumed["status"] == "completed"
        assert resumed["processed"] == {"already_terminal": 1, "succeeded": 1}
        assert len(storage.store_calls) == 2

        repeated = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **_apply_kwargs(first_plan, backfill_id="integration-batch-1"),
        )
        assert repeated["status"] == "completed"
        assert repeated["processed"] == {"already_terminal": 2}
        assert len(storage.store_calls) == 2

        async with database_engine.connect() as connection:
            repaired = (
                await connection.execute(
                    text("""
                        SELECT thumbnail_url, extracted
                        FROM recipes
                        WHERE id = '10000000-0000-4000-8000-000000000003'
                    """)
                )
            ).mappings().one()
            events = (
                await connection.execute(
                    text("""
                        SELECT outcome, failure_code
                        FROM thumbnail_backfill_events
                        ORDER BY created_at, recipe_id, attempt
                    """)
                )
            ).all()
            audited_values = (
                await connection.execute(
                    text("""
                        SELECT source_url_hash, source_sha256
                        FROM thumbnail_backfill_items
                    """)
                )
            ).all()
            planned_count = await connection.scalar(
                text("SELECT COUNT(*) FROM thumbnail_backfill_items")
            )
        assert repaired.thumbnail_url.endswith("/hero.webp")
        assert repaired.extracted["media"]["thumbnail"] == repaired.thumbnail_url
        assert [event.outcome for event in events] == [
            "succeeded",
            "failed",
            "succeeded",
        ]
        assert all("images.example" not in str(row) for row in audited_values)
        assert planned_count == 4

        with pytest.raises(DBAPIError, match="append-only"):
            async with database_engine.begin() as connection:
                await connection.execute(
                    text("""
                        UPDATE thumbnail_backfill_runs
                        SET restore_point = 'changed'
                    """)
                )
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_malformed_legacy_urls_do_not_abort_a_valid_batch():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    valid_url = "https://images.example/valid.png"
    invalid_port = "https://images.example:broken/image.png"
    invalid_ipv6 = "https://[broken/image.png"
    storage = FakeThumbnailStorage(
        {
            valid_url: b"valid-source",
            invalid_port: ValueError("malformed source"),
        }
    )
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        await _insert_recipe(
            database_engine,
            recipe_id="15000000-0000-4000-8000-000000000001",
            thumbnail_url=valid_url,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="15000000-0000-4000-8000-000000000002",
            thumbnail_url=invalid_port,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="15000000-0000-4000-8000-000000000003",
            thumbnail_url=invalid_ipv6,
        )

        plan = await run_backfill(database_engine=database_engine, storage=storage)

        assert plan["inventory"] == {"eligible": 1, "failed": 2}
        assert plan["failures"] == {"invalid_source": 2}
        assert plan["planned_items"] == 3
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_clean_page_apply_is_persisted_and_resumes_unchanged():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    ready_recipe_id = "17500000-0000-4000-8000-000000000001"
    ready_url = (
        "https://media.example/thumbnails/"
        f"{ready_recipe_id}/{'a' * 64}/hero.webp"
    )
    storage = FakeThumbnailStorage({})
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        await _insert_recipe(
            database_engine,
            recipe_id=ready_recipe_id,
            thumbnail_url=ready_url,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="17500000-0000-4000-8000-000000000002",
            thumbnail_url=None,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)
        apply_kwargs = _apply_kwargs(plan, backfill_id="clean-inventory-batch")

        applied = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **apply_kwargs,
        )
        resumed = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **apply_kwargs,
        )

        assert applied["status"] == "unchanged"
        assert resumed["status"] == "unchanged"
        assert applied["backfill_id"] == resumed["backfill_id"]
        async with database_engine.connect() as connection:
            assert await connection.scalar(
                text("SELECT COUNT(*) FROM thumbnail_backfill_runs")
            ) == 1
            assert await connection.scalar(
                text("SELECT COUNT(*) FROM thumbnail_backfill_items")
            ) == 2
        with pytest.raises(ThumbnailBackfillBlocked, match="restore_point"):
            await run_backfill(
                database_engine=database_engine,
                storage=storage,
                **{**apply_kwargs, "restore_point": "different-backup"},
            )
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_recipe_edit_wins_without_upload():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    source_url = "https://images.example/original.png"
    replacement_url = "https://images.example/user-selected.png"
    storage = FakeThumbnailStorage({source_url: b"original-source"})
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        recipe_id = "20000000-0000-4000-8000-000000000001"
        await _insert_recipe(
            database_engine,
            recipe_id=recipe_id,
            thumbnail_url=source_url,
            content_revision=4,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)

        async def concurrent_edit() -> None:
            async with database_engine.begin() as connection:
                await connection.execute(
                    text("""
                        UPDATE recipes
                        SET thumbnail_url = :replacement_url,
                            content_revision = content_revision + 1
                        WHERE id = CAST(:recipe_id AS UUID)
                    """),
                    {"replacement_url": replacement_url, "recipe_id": recipe_id},
                )

        storage.prepare_hook = concurrent_edit
        applied = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **_apply_kwargs(plan, backfill_id="concurrent-edit-batch"),
        )

        assert applied["status"] == "completed_with_exceptions"
        assert applied["processed"] == {"conflict": 1}
        assert applied["final_outcomes"] == {"conflict": 1}
        assert storage.store_calls == []
        async with database_engine.connect() as connection:
            current = await connection.execute(
                text("""
                    SELECT thumbnail_url, content_revision
                    FROM recipes
                    WHERE id = CAST(:recipe_id AS UUID)
                """),
                {"recipe_id": recipe_id},
            )
            row = current.one()
        assert row == (replacement_url, 5)
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_recipe_made_private_during_preparation_is_not_uploaded():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    source_url = "https://images.example/public-before-plan.png"
    storage = FakeThumbnailStorage({source_url: b"public-source"})
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        recipe_id = "25000000-0000-4000-8000-000000000001"
        await _insert_recipe(
            database_engine,
            recipe_id=recipe_id,
            thumbnail_url=source_url,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)

        async def make_private() -> None:
            async with database_engine.begin() as connection:
                await connection.execute(
                    text("""
                        UPDATE recipes
                        SET is_public = FALSE
                        WHERE id = CAST(:recipe_id AS UUID)
                    """),
                    {"recipe_id": recipe_id},
                )

        storage.prepare_hook = make_private
        applied = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **_apply_kwargs(plan, backfill_id="visibility-change-batch"),
        )

        assert applied["status"] == "completed_with_exceptions"
        assert applied["processed"] == {"conflict": 1}
        assert storage.store_calls == []
        async with database_engine.connect() as connection:
            assert await connection.scalar(
                text("""
                    SELECT is_public
                    FROM recipes
                    WHERE id = CAST(:recipe_id AS UUID)
                """),
                {"recipe_id": recipe_id},
            ) is False
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_interrupted_run_resumes_without_reprocessing_successes():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    first_url = "https://images.example/first.png"
    second_url = "https://images.example/second.png"
    storage = FakeThumbnailStorage(
        {first_url: b"first-source", second_url: b"second-source"}
    )
    storage.interrupt_store_call = 2
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        await _insert_recipe(
            database_engine,
            recipe_id="30000000-0000-4000-8000-000000000001",
            thumbnail_url=first_url,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="30000000-0000-4000-8000-000000000002",
            thumbnail_url=second_url,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)
        apply_kwargs = _apply_kwargs(plan, backfill_id="interrupted-batch")

        with pytest.raises(SyntheticInterruption):
            await run_backfill(
                database_engine=database_engine,
                storage=storage,
                **apply_kwargs,
            )

        resumed = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **apply_kwargs,
        )
        assert resumed["status"] == "completed"
        assert resumed["processed"] == {"already_terminal": 1, "succeeded": 1}
        assert storage.store_calls == [
            "30000000-0000-4000-8000-000000000001",
            "30000000-0000-4000-8000-000000000002",
            "30000000-0000-4000-8000-000000000002",
        ]
        async with database_engine.connect() as connection:
            assert await connection.scalar(
                text("""
                    SELECT COUNT(*)
                    FROM thumbnail_backfill_events
                    WHERE outcome = 'succeeded'
                """)
            ) == 2
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_resume_refuses_destination_or_transform_drift():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    source_url = "https://images.example/destination-bound.png"
    storage = FakeThumbnailStorage({source_url: b"source"})
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        await _insert_recipe(
            database_engine,
            recipe_id="35000000-0000-4000-8000-000000000001",
            thumbnail_url=source_url,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)
        apply_kwargs = _apply_kwargs(plan, backfill_id="destination-bound-batch")
        applied = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **apply_kwargs,
        )
        assert applied["status"] == "completed"

        storage.destination_fingerprint = "f" * 64
        with pytest.raises(
            ThumbnailBackfillBlocked,
            match="destination or transform contract changed",
        ):
            await run_backfill(
                database_engine=database_engine,
                storage=storage,
                **apply_kwargs,
            )
        assert len(storage.store_calls) == 1

        storage.destination_fingerprint = plan["destination_fingerprint"]
        storage.release_id = "different-runtime-release"
        with pytest.raises(ThumbnailBackfillBlocked, match="runtime release changed"):
            await run_backfill(
                database_engine=database_engine,
                storage=storage,
                **apply_kwargs,
            )
        assert len(storage.store_calls) == 1
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_lost_global_lock_session_stops_and_resumes_safely():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    first_url = "https://images.example/lock-first.png"
    second_url = "https://images.example/lock-second.png"
    storage = FakeThumbnailStorage(
        {first_url: b"first-source", second_url: b"second-source"}
    )
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        await _insert_recipe(
            database_engine,
            recipe_id="37500000-0000-4000-8000-000000000001",
            thumbnail_url=first_url,
        )
        await _insert_recipe(
            database_engine,
            recipe_id="37500000-0000-4000-8000-000000000002",
            thumbnail_url=second_url,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)
        apply_kwargs = _apply_kwargs(plan, backfill_id="lost-lock-batch")

        async def terminate_global_lock_session() -> None:
            async with database_engine.begin() as connection:
                lock_pid = await connection.scalar(
                    text("""
                        SELECT locks.pid
                        FROM pg_locks AS locks
                        JOIN pg_stat_activity AS activity
                          ON activity.pid = locks.pid
                        WHERE locks.locktype = 'advisory'
                          AND locks.granted
                          AND activity.datname = current_database()
                          AND locks.pid <> pg_backend_pid()
                          AND locks.classid = (
                              (hashtext(:lock_name)::bigint >> 32)
                              & 4294967295
                          )::oid
                          AND locks.objid = (
                              hashtext(:lock_name)::bigint & 4294967295
                          )::oid
                        LIMIT 1
                    """),
                    {"lock_name": BACKFILL_LOCK_NAME},
                )
                assert lock_pid is not None
                assert await connection.scalar(
                    text("SELECT pg_terminate_backend(:pid)"),
                    {"pid": lock_pid},
                )

        storage.prepare_hook = terminate_global_lock_session
        with pytest.raises(ThumbnailBackfillBlocked, match="lock connection was lost"):
            await run_backfill(
                database_engine=database_engine,
                storage=storage,
                **apply_kwargs,
            )
        assert len(storage.store_calls) == 1

        resumed = await run_backfill(
            database_engine=database_engine,
            storage=storage,
            **apply_kwargs,
        )
        assert resumed["status"] == "completed"
        assert resumed["processed"] == {"already_terminal": 1, "succeeded": 1}
        assert len(storage.store_calls) == 2
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_apply_stops_before_audit_writes_when_plan_drifted():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    source_url = "https://images.example/planned.png"
    changed_url = "https://images.example/changed.png"
    storage = FakeThumbnailStorage(
        {source_url: b"planned-source", changed_url: b"changed-source"}
    )
    try:
        await _reset_schema(database_engine)
        await _create_recipe_schema(database_engine)
        recipe_id = "40000000-0000-4000-8000-000000000001"
        await _insert_recipe(
            database_engine,
            recipe_id=recipe_id,
            thumbnail_url=source_url,
        )
        plan = await run_backfill(database_engine=database_engine, storage=storage)
        async with database_engine.begin() as connection:
            await connection.execute(
                text("""
                    UPDATE recipes
                    SET thumbnail_url = :changed_url
                    WHERE id = CAST(:recipe_id AS UUID)
                """),
                {"changed_url": changed_url, "recipe_id": recipe_id},
            )

        with pytest.raises(ThumbnailBackfillBlocked, match="plan digest changed"):
            await run_backfill(
                database_engine=database_engine,
                storage=storage,
                **_apply_kwargs(plan, backfill_id="drifted-batch"),
            )
        async with database_engine.connect() as connection:
            assert await connection.scalar(
                text("SELECT COUNT(*) FROM thumbnail_backfill_runs")
            ) == 0
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()

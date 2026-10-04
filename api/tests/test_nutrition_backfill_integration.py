"""Real PostgreSQL coverage for immutable repair plans, retries and conflicts."""

from __future__ import annotations

import json
import os
from importlib import import_module
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.nutrition_backfill import NutritionBackfillBlocked, run_backfill
from app.services.nutrition import NUTRITION_VERSION
from tests.database_safety import require_disposable_test_database

DATABASE = os.environ.get("TEST_DATABASE_URL")
OPT_IN = os.environ.get("NUTRITION_BACKFILL_DESTRUCTIVE_TEST") == "1"
pytestmark = pytest.mark.skipif(
    not DATABASE or not OPT_IN,
    reason="Disposable local PostgreSQL and nutrition destructive-test opt-in required",
)


@pytest.fixture
async def database():
    require_disposable_test_database(DATABASE)
    if make_url(DATABASE).host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Nutrition destructive tests require local PostgreSQL")
    engine = create_async_engine(DATABASE)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.execute(
            text(
                "CREATE TABLE recipes(id UUID PRIMARY KEY,extracted JSONB NOT NULL,content_revision INTEGER NOT NULL DEFAULT 1,user_id TEXT,extraction_method TEXT)"
            )
        )
        await import_module(
            "migrations.033_add_nutrition_backfill_audit"
        ).install_nutrition_backfill_schema(connection)
    yield engine
    await engine.dispose()


async def seed(engine, *, number=1, incomplete=False):
    recipe_id = UUID(int=number)
    extracted = {
        "title": "Owner's edited rice",
        "servings": 4,
        "notes": "Keep my notes",
        "components": [
            {
                "name": "Rice",
                "ingredients": [{"name": "rice", "quantity": "1", "unit": "cup"}],
                "steps": ["Cook"],
            }
        ],
        "nutrition": {"perServing": {"calories": 150}, "total": {}},
        "sourceIncomplete": incomplete,
    }
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO recipes(id,extracted,user_id) VALUES (:id,CAST(:value AS JSONB),'owner')"
            ),
            {"id": recipe_id, "value": json.dumps(extracted)},
        )
    return recipe_id, extracted


async def fake_calculator(extracted, **kwargs):
    assert kwargs["preserve_source"] is True
    assert kwargs["pinned_model"] == get_settings().enrichment_model
    assert kwargs["allow_canary"] is False
    return {
        **extracted,
        "nutrition": {
            "perServing": {"calories": 150, "protein": 2.5, "carbs": 30, "fat": 1.5},
            "total": {"calories": 600, "protein": 10, "carbs": 120, "fat": 6},
        },
        "derivedData": {
            "nutrition": {
                "status": "current",
                "source": "ai_estimate",
                "model": kwargs["pinned_model"],
                "dataVersion": NUTRITION_VERSION,
            }
        },
    }


def apply_args(plan):
    return {
        "apply": True,
        "backfill_id": "nutrition-test-001",
        "restore_point": "verified-test-restore",
        "expected_plan_digest": plan["plan_digest"],
        "expected_rows": plan["scanned_rows"],
        "expected_release_id": plan["release_id"],
        "expected_database_fingerprint": plan["database_fingerprint"],
        "release_id": "test-release",
        "max_estimates": 10,
    }


async def test_dry_run_does_not_write_or_call_provider_then_apply_is_idempotent(database):
    recipe_id, before = await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")
    assert plan["planned_items"] == 1
    async with database.connect() as connection:
        assert await connection.scalar(text("SELECT COUNT(*) FROM nutrition_backfill_runs")) == 0
    kwargs = apply_args(plan)
    result = await run_backfill(engine=database, calculator=fake_calculator, **kwargs)
    assert result["processed"] == {"succeeded": 1}
    async with database.connect() as connection:
        row = (
            (
                await connection.execute(
                    text("SELECT * FROM recipes WHERE id=:id"), {"id": recipe_id}
                )
            )
            .mappings()
            .one()
        )
        assert row["user_id"] == "owner"
        assert row["content_revision"] == 1
        for field in ("title", "components", "notes", "servings"):
            assert row["extracted"][field] == before[field]
        assert row["extracted"]["nutrition"]["perServing"]["calories"] == 150
    repeated = await run_backfill(engine=database, calculator=fake_calculator, **kwargs)
    assert repeated["provider_calls"] == 0
    assert repeated["processed"] == {"already_terminal": 1}


async def test_edit_during_provider_work_stops_before_overwriting(database):
    recipe_id, _ = await seed(database)
    await seed(database, number=2)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def concurrent_edit(extracted, **kwargs):
        async with database.begin() as connection:
            await connection.execute(
                text(
                    "UPDATE recipes SET extracted=jsonb_set(extracted,'{notes}','\"New owner note\"'),content_revision=2 WHERE id=:id"
                ),
                {"id": recipe_id},
            )
        return await fake_calculator(extracted, **kwargs)

    result = await run_backfill(engine=database, calculator=concurrent_edit, **apply_args(plan))
    assert result["status"] == "blocked_conflict"
    assert result["provider_calls"] == 1
    async with database.connect() as connection:
        row = (
            (
                await connection.execute(
                    text("SELECT * FROM recipes WHERE id=:id"), {"id": recipe_id}
                )
            )
            .mappings()
            .one()
        )
        assert row["extracted"]["notes"] == "New owner note"
        assert row["extracted"]["nutrition"]["perServing"] == {"calories": 150}
    assert (await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan)))[
        "status"
    ] == "blocked_conflict"


async def test_concurrent_nutrition_change_without_revision_is_protected(database):
    recipe_id, _ = await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def concurrent_nutrition(extracted, **kwargs):
        async with database.begin() as connection:
            await connection.execute(
                text(
                    "UPDATE recipes SET extracted=jsonb_set(extracted,'{nutrition,perServing,calories}','400') WHERE id=:id"
                ),
                {"id": recipe_id},
            )
        return await fake_calculator(extracted, **kwargs)

    result = await run_backfill(
        engine=database, calculator=concurrent_nutrition, **apply_args(plan)
    )
    assert result["status"] == "blocked_conflict"


async def test_failed_estimate_is_retryable_and_budget_is_bounded(database):
    await seed(database)
    await seed(database, number=2)
    plan = await run_backfill(engine=database, release_id="test-release")
    kwargs = {**apply_args(plan), "max_estimates": 1}

    async def fail(extracted, **kwargs):
        return {
            **extracted,
            "derivedData": {
                "nutrition": {"status": "unavailable", "errorCode": "provider_unavailable"}
            },
        }

    failed = await run_backfill(engine=database, calculator=fail, **kwargs)
    assert failed["provider_calls"] == 1
    assert failed["processed"]["failed"] == 1
    succeeded = await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    assert succeeded["processed"] == {"succeeded": 2}
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text(
                    "SELECT COUNT(*) FROM nutrition_backfill_events WHERE attempt=2 AND outcome='succeeded'"
                )
            )
            == 1
        )


async def test_interrupted_attempt_is_counted_and_resume_is_safe(database):
    await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")

    class Interruption(BaseException):
        pass

    async def interrupt(*args, **kwargs):
        raise Interruption()

    with pytest.raises(Interruption):
        await run_backfill(engine=database, calculator=interrupt, **apply_args(plan))
    result = await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    assert result["processed"] == {"succeeded": 1}
    async with database.connect() as connection:
        assert (
            await connection.scalar(text("SELECT MAX(attempt) FROM nutrition_backfill_events")) == 2
        )


async def test_plan_drift_restore_and_scope_mismatch_stop_before_write(database):
    await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")
    with pytest.raises(NutritionBackfillBlocked, match="restore-point"):
        await run_backfill(engine=database, **{**apply_args(plan), "restore_point": None})
    with pytest.raises(NutritionBackfillBlocked, match="Recipes changed"):
        await run_backfill(
            engine=database, **{**apply_args(plan), "expected_plan_digest": "f" * 64}
        )
    await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    with pytest.raises(NutritionBackfillBlocked, match="scope or runtime"):
        await run_backfill(
            engine=database, calculator=fake_calculator, **{**apply_args(plan), "batch_size": 11}
        )


async def test_audit_cannot_be_rewritten_and_incomplete_drafts_are_reported(database):
    await seed(database)
    await seed(database, number=2, incomplete=True)
    plan = await run_backfill(engine=database, release_id="test-release")
    assert plan["planned_items"] == 1
    assert plan["ineligible"] == {"incomplete_recipe": 1}
    await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    with pytest.raises(DBAPIError, match="append-only"):
        async with database.begin() as connection:
            await connection.execute(
                text("UPDATE nutrition_backfill_runs SET restore_point='other'")
            )


async def test_migration_requires_restore_point_then_is_idempotent(database, monkeypatch):
    from types import SimpleNamespace

    module = import_module("migrations.033_add_nutrition_backfill_audit")
    settings = SimpleNamespace(environment="production", migration_033_restore_point=None)
    monkeypatch.setattr(module, "engine", database)
    monkeypatch.setattr(module, "get_settings", lambda: settings)
    async with database.begin() as connection:
        await connection.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
        )
        await connection.execute(
            text("INSERT INTO schema_migrations VALUES (31,'test prior version')")
        )
    with pytest.raises(RuntimeError, match="MIGRATION_033_RESTORE_POINT"):
        await module.run_migration()
    settings.migration_033_restore_point = "verified-test-restore"
    await module.run_migration()
    settings.migration_033_restore_point = None
    await module.run_migration()
    async with database.connect() as connection:
        assert (
            await connection.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version=33"))
            == 1
        )


async def test_mismatched_calculation_model_is_audited_and_cannot_write(database):
    recipe_id, before = await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def wrong_model(extracted, **kwargs):
        result = await fake_calculator(extracted, **kwargs)
        result["derivedData"]["nutrition"]["model"] = "unapproved-canary"
        return result

    result = await run_backfill(engine=database, calculator=wrong_model, **apply_args(plan))
    assert result["status"] == "blocked_model"
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT extracted FROM recipes WHERE id=:id"), {"id": recipe_id}
            )
            == before
        )
        assert (
            await connection.scalar(
                text(
                    "SELECT COUNT(*) FROM nutrition_backfill_events WHERE outcome='failed' AND failure_code='model_changed'"
                )
            )
            == 1
        )


@pytest.mark.parametrize("number_of_recipes", [2, 3])
async def test_exhausted_attempts_remain_visible_after_later_failures_or_budget(
    database, number_of_recipes
):
    for number in range(1, number_of_recipes + 1):
        await seed(database, number=number)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def fail(extracted, **kwargs):
        return {
            **extracted,
            "derivedData": {
                "nutrition": {"status": "unavailable", "errorCode": "provider_unavailable"}
            },
        }

    kwargs = {**apply_args(plan), "max_estimates": 1, "max_attempts": 1}
    await run_backfill(engine=database, calculator=fail, **kwargs)
    resumed = await run_backfill(engine=database, calculator=fail, **kwargs)
    assert resumed["status"] == "attempt_limit"
    assert resumed["processed"] == {"attempt_limit": 1, "failed": 1}
    assert resumed["provider_calls"] == 1
    async with database.connect() as connection:
        assert (
            await connection.scalar(text("SELECT MAX(attempt) FROM nutrition_backfill_events")) == 1
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE outcome='failed'")
            )
            == 2
        )


async def test_dry_plan_excludes_legacy_incomplete_source_but_not_manual_notes(database):
    legacy_id, legacy = await seed(database)
    manual_id, manual = await seed(database, number=2)
    diagnostic = "The description does not provide a full ingredient list."
    legacy["notes"] = diagnostic
    manual["notes"] = diagnostic
    async with database.begin() as connection:
        for recipe_id, extracted, method in (
            (legacy_id, legacy, "basic"),
            (manual_id, manual, "manual"),
        ):
            await connection.execute(
                text(
                    "UPDATE recipes SET extracted=CAST(:extracted AS JSONB),extraction_method=:method WHERE id=:id"
                ),
                {"extracted": json.dumps(extracted), "method": method, "id": recipe_id},
            )
    plan = await run_backfill(engine=database, release_id="test-release")
    assert plan["planned_items"] == 1
    assert plan["ineligible"] == {"incomplete_recipe": 1}
    result = await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    assert result["processed"] == {"succeeded": 1}
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT extracted FROM recipes WHERE id=:id"), {"id": legacy_id}
            )
            == legacy
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE recipe_id=:id"),
                {"id": legacy_id},
            )
            == 0
        )
        assert (
            await connection.scalar(
                text("SELECT extracted->>'notes' FROM recipes WHERE id=:id"), {"id": manual_id}
            )
            == diagnostic
        )


async def test_resume_rejects_method_only_changes_without_changing_stored_snapshot(
    database, monkeypatch
):
    from unittest.mock import Mock

    from app.services import nutrition

    recipe_id, original = await seed(database)
    original["notes"] = "The caption does not include the ingredients."
    async with database.begin() as connection:
        await connection.execute(
            text(
                "UPDATE recipes SET extracted=CAST(:extracted AS JSONB),extraction_method='manual' WHERE id=:id"
            ),
            {"extracted": json.dumps(original), "id": recipe_id},
        )
    plan = await run_backfill(engine=database, release_id="test-release")

    class Interruption(BaseException):
        pass

    async def interrupt(*args, **kwargs):
        raise Interruption()

    with pytest.raises(Interruption):
        await run_backfill(engine=database, calculator=interrupt, **apply_args(plan))
    async with database.begin() as connection:
        await connection.execute(
            text("UPDATE recipes SET extraction_method='ocr' WHERE id=:id"), {"id": recipe_id}
        )
    provider = Mock()
    monkeypatch.setattr(nutrition, "AsyncOpenAI", provider)
    basis_seen = []

    async def calculate(extracted, **kwargs):
        basis_seen.append(extracted)
        return await nutrition.enrich_nutrition(extracted, **kwargs)

    resumed = await run_backfill(engine=database, calculator=calculate, **apply_args(plan))
    assert resumed["status"] == "blocked_conflict"
    assert resumed["provider_calls"] == 0
    assert basis_seen == []
    provider.assert_not_called()
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT extracted FROM recipes WHERE id=:id"), {"id": recipe_id}
            )
            == original
        )
        assert (
            await connection.scalar(
                text(
                    "SELECT outcome FROM nutrition_backfill_events ORDER BY attempt DESC,created_at DESC LIMIT 1"
                )
            )
            == "conflict"
        )


async def test_method_only_change_during_calculation_conflicts_before_nutrition_write(database):
    recipe_id, original = await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def concurrent_method_change(extracted, **kwargs):
        async with database.begin() as connection:
            await connection.execute(
                text("UPDATE recipes SET extraction_method='whisper' WHERE id=:id"),
                {"id": recipe_id},
            )
        return await fake_calculator(extracted, **kwargs)

    result = await run_backfill(
        engine=database, calculator=concurrent_method_change, **apply_args(plan)
    )
    assert result["status"] == "blocked_conflict"
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT extracted FROM recipes WHERE id=:id"), {"id": recipe_id}
            )
            == original
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE outcome='succeeded'")
            )
            == 0
        )


async def test_default_repair_paces_eleven_same_owner_estimates_across_resumes_without_open_transaction(
    database, monkeypatch
):
    from app import nutrition_backfill
    from tests.test_nutrition_repair_pacing import configure_virtual_nutrition

    for number in range(1, 12):
        await seed(database, number=number)
    harness = configure_virtual_nutrition(monkeypatch)

    async def sleep_after_commit(seconds):
        async with database.connect() as connection:
            assert (
                await connection.scalar(
                    text(
                        "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
                    )
                )
                == 0
            )
        await harness.clock.sleep(seconds)

    monkeypatch.setattr(
        nutrition_backfill,
        "repair_pacer",
        nutrition_backfill.RepairPacer(
            clock=harness.clock.read,
            sleep=sleep_after_commit,
        ),
    )
    plan = await run_backfill(engine=database, release_id="test-release", batch_size=20)
    assert harness.clock.sleeps == []
    assert harness.create.await_count == 0
    kwargs = {**apply_args(plan), "batch_size": 20, "max_estimates": 5}
    first = await run_backfill(engine=database, **kwargs)
    second = await run_backfill(engine=database, **kwargs)
    final = await run_backfill(engine=database, **kwargs)
    assert [first["status"], second["status"], final["status"]] == [
        "budget_limited",
        "budget_limited",
        "completed",
    ]
    assert [
        first["processed"]["succeeded"],
        second["processed"]["succeeded"],
        final["processed"]["succeeded"],
    ] == [5, 5, 1]
    assert harness.starts == [7.0 * number for number in range(11)]
    assert harness.create.await_count == harness.record.await_count == 11
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE outcome='succeeded'")
            )
            == 11
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE outcome='failed'")
            )
            == 0
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM recipes WHERE user_id='owner' AND content_revision=1")
            )
            == 11
        )


async def test_dry_runs_and_injected_fake_calculators_never_wait(database, monkeypatch):
    from unittest.mock import AsyncMock

    from app import nutrition_backfill

    await seed(database)
    wait = AsyncMock(side_effect=AssertionError("Dry runs and injected calculators must not wait"))
    monkeypatch.setattr(nutrition_backfill.repair_pacer, "wait", wait)
    plan = await run_backfill(engine=database, release_id="test-release")
    result = await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    assert result["processed"] == {"succeeded": 1}
    wait.assert_not_awaited()


async def test_local_limit_stops_invocation_without_burning_following_attempts(database):
    await seed(database)
    await seed(database, number=2)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def denied(extracted, **kwargs):
        return {
            **extracted,
            "derivedData": {
                "nutrition": {"status": "unavailable", "errorCode": "local_rate_limit"}
            },
        }

    result = await run_backfill(engine=database, calculator=denied, **apply_args(plan))
    assert result["status"] == "rate_limited"
    assert result["provider_calls"] == 1
    assert result["processed"] == {"failed": 1, "local_rate_limit": 1}
    async with database.connect() as connection:
        assert await connection.scalar(text("SELECT COUNT(*) FROM nutrition_backfill_events")) == 2
        assert (
            await connection.scalar(
                text("SELECT COUNT(DISTINCT recipe_id) FROM nutrition_backfill_events")
            )
            == 1
        )
        assert (
            await connection.scalar(
                text("SELECT failure_code FROM nutrition_backfill_events WHERE outcome='failed'")
            )
            == "local_rate_limit"
        )


async def test_exhausted_attempts_remain_visible_when_later_item_hits_local_limit(database):
    exhausted_id, _ = await seed(database)
    denied_id, _ = await seed(database, number=2)
    untouched_id, untouched = await seed(database, number=3)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def failure(extracted, **kwargs):
        return {
            **extracted,
            "derivedData": {
                "nutrition": {
                    "status": "unavailable",
                    "errorCode": "provider_unavailable",
                }
            },
        }

    first = await run_backfill(
        engine=database,
        calculator=failure,
        **{**apply_args(plan), "max_estimates": 1, "max_attempts": 1},
    )
    assert first["status"] == "budget_limited"
    calls = []

    async def denied(extracted, **kwargs):
        calls.append(extracted)
        return {
            **extracted,
            "derivedData": {
                "nutrition": {
                    "status": "unavailable",
                    "errorCode": "local_rate_limit",
                }
            },
        }

    resumed = await run_backfill(
        engine=database,
        calculator=denied,
        **{**apply_args(plan), "max_attempts": 1},
    )
    assert resumed["status"] == "attempt_limit"
    assert resumed["processed"] == {"attempt_limit": 1, "failed": 1, "local_rate_limit": 1}
    assert resumed["provider_calls"] == len(calls) == 1
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT MAX(attempt) FROM nutrition_backfill_events WHERE recipe_id=:id"),
                {"id": exhausted_id},
            )
            == 1
        )
        assert (
            await connection.scalar(
                text(
                    "SELECT failure_code FROM nutrition_backfill_events WHERE recipe_id=:id AND outcome='failed'"
                ),
                {"id": denied_id},
            )
            == "local_rate_limit"
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE recipe_id=:id"),
                {"id": untouched_id},
            )
            == 0
        )
        assert (
            await connection.scalar(
                text("SELECT extracted FROM recipes WHERE id=:id"), {"id": untouched_id}
            )
            == untouched
        )


async def nutrition_lock_count(engine):
    from app.nutrition_repair_lock import LOCK_NAME

    async with engine.connect() as connection:
        return await connection.scalar(
            text("""
            SELECT COUNT(*) FROM pg_locks
            WHERE locktype='advisory' AND granted
            AND classid=((hashtext(:name)::bigint >> 32) & 4294967295)
            AND objid=(hashtext(:name)::bigint & 4294967295) AND objsubid=1
        """),
            {"name": LOCK_NAME},
        )


async def test_direct_lock_survives_rotating_data_transactions_and_releases_between_resumes(
    database,
):
    from sqlalchemy.pool import NullPool

    await seed(database)
    await seed(database, number=2)
    rotating = create_async_engine(DATABASE, poolclass=NullPool)
    pids = []

    async def calculate(extracted, **kwargs):
        # Each data transaction gets a fresh physical connection, as through a
        # transaction pooler. The independent session lock stays continuously held.
        for _ in range(2):
            async with rotating.begin() as connection:
                pids.append(await connection.scalar(text("SELECT pg_backend_pid()")))
                assert await nutrition_lock_count(rotating) == 1
        return await fake_calculator(extracted, **kwargs)

    try:
        plan = await run_backfill(engine=rotating, release_id="test-release")
        kwargs = {**apply_args(plan), "max_estimates": 1}
        first = await run_backfill(engine=rotating, calculator=calculate, **kwargs)
        assert first["status"] == "budget_limited"
        assert await nutrition_lock_count(rotating) == 0
        final = await run_backfill(engine=rotating, calculator=calculate, **kwargs)
        assert final["status"] == "completed"
        assert await nutrition_lock_count(rotating) == 0
        assert len(set(pids)) == 4
    finally:
        await rotating.dispose()


async def test_simultaneous_repairs_are_excluded_and_same_run_can_resume_after_release(database):
    import asyncio

    await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")
    entered = asyncio.Event()
    finish = asyncio.Event()
    calls = []

    async def wait_in_provider(extracted, **kwargs):
        calls.append(extracted)
        entered.set()
        await finish.wait()
        return await fake_calculator(extracted, **kwargs)

    first = asyncio.create_task(
        run_backfill(engine=database, calculator=wait_in_provider, **apply_args(plan))
    )
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        assert await nutrition_lock_count(database) == 1
        with pytest.raises(NutritionBackfillBlocked, match="Another nutrition repair"):
            await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
        assert len(calls) == 1
    finally:
        finish.set()
        await first
    assert await nutrition_lock_count(database) == 0
    repeated = await run_backfill(engine=database, calculator=fake_calculator, **apply_args(plan))
    assert repeated["processed"] == {"already_terminal": 1}
    assert repeated["provider_calls"] == 0
    assert await nutrition_lock_count(database) == 0


@pytest.mark.parametrize("outcome", ["raised", "local_limit"])
async def test_direct_session_lock_is_released_on_exception_or_denial(database, outcome):
    await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")

    async def fail(extracted, **kwargs):
        if outcome == "raised":
            raise RuntimeError("test interrupted calculation")
        return {
            **extracted,
            "derivedData": {
                "nutrition": {
                    "status": "unavailable",
                    "errorCode": "local_rate_limit",
                }
            },
        }

    if outcome == "raised":
        with pytest.raises(RuntimeError, match="test interrupted calculation"):
            await run_backfill(engine=database, calculator=fail, **apply_args(plan))
    else:
        result = await run_backfill(engine=database, calculator=fail, **apply_args(plan))
        assert result["status"] == "rate_limited"
    assert await nutrition_lock_count(database) == 0


async def test_changed_backend_cannot_unlock_another_session_holder(database):
    from app.nutrition_repair_lock import LOCK_NAME, dedicated_lock_session

    async with dedicated_lock_session(database) as original:
        await original.acquire()
        original_connection = original.connection
        await original_connection.scalar(
            text("SELECT pg_advisory_unlock(hashtext(:name))"), {"name": LOCK_NAME}
        )
        await original_connection.commit()
        async with dedicated_lock_session(database) as other:
            await other.acquire()
            assert original.pid != other.pid
            original.connection = other.connection
            try:
                with pytest.raises(NutritionBackfillBlocked, match="session changed"):
                    await original.verify()
                with pytest.raises(NutritionBackfillBlocked, match="not released safely"):
                    await original.release()
                await other.verify()
            finally:
                original.connection = original_connection
                original.acquired = False  # This test already released its own original lock.
                await other.release()
    assert await nutrition_lock_count(database) == 0


async def test_lock_lost_during_calculation_stops_before_recipe_write(database, monkeypatch):
    from contextlib import asynccontextmanager

    from app import nutrition_backfill
    from app.nutrition_repair_lock import LOCK_NAME, dedicated_lock_session

    recipe_id, original = await seed(database)
    plan = await run_backfill(engine=database, release_id="test-release")
    held_sessions = []

    @asynccontextmanager
    async def capture_lock(engine):
        async with dedicated_lock_session(engine) as lock:
            held_sessions.append(lock)
            yield lock

    monkeypatch.setattr(nutrition_backfill, "dedicated_lock_session", capture_lock)

    async def lose_own_lock(extracted, **kwargs):
        lock = held_sessions[0]
        assert (
            await lock.connection.scalar(
                text("SELECT pg_advisory_unlock(hashtext(:name))"), {"name": LOCK_NAME}
            )
            is True
        )
        await lock.connection.commit()
        return await fake_calculator(extracted, **kwargs)

    with pytest.raises(NutritionBackfillBlocked):
        await run_backfill(engine=database, calculator=lose_own_lock, **apply_args(plan))
    async with database.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT extracted FROM recipes WHERE id=:id"), {"id": recipe_id}
            )
            == original
        )
        assert (
            await connection.scalar(
                text("SELECT COUNT(*) FROM nutrition_backfill_events WHERE outcome='succeeded'")
            )
            == 0
        )
    assert await nutrition_lock_count(database) == 0

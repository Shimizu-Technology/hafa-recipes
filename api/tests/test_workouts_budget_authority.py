"""Paid paths share an explicit durable authority, with no real provider calls."""

# ruff: noqa: F811 -- reusable isolated PostgreSQL fixtures
import asyncio
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import text

from app import config
from app.config import Settings
from app.domains.workouts import budget_authority
from app.domains.workouts.budget import BudgetError, BudgetGuard, budget_diagnostics
from app.domains.workouts.budget_authority import dispose_budget_authorities
from app.domains.workouts.budget_models import WorkoutsAIAdmission
from app.domains.workouts.extraction import ExtractionFailure, ProductionExtractionProvider
from tests.test_workouts_ai_budget import EXTRACTION, LUNA, budget_api, policy  # noqa: F401
from tests.test_workouts_data_integration import DATABASE_URL, data_api, settings  # noqa: F401
from tests.test_workouts_provider_budgets import (
    install_http,
    provider_environment,  # noqa: F401
    source,
)

DB_REQUIRED = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.mark.parametrize(
    "field", ["workouts_ai_budget_24h_microusd", "workouts_ai_max_attempt_microusd"]
)
def test_config_rejects_above_combined_authorized_ceiling(field):
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql://test:test@localhost/hafa_test",
            openai_api_key="test",
            **{field: 5_000_001},
        )


async def test_positive_budget_without_authority_cannot_dispatch(provider_environment, monkeypatch):
    configured = provider_environment.model_copy(
        update={"workouts_ai_budget_24h_microusd": 5_000_000}
    )
    monkeypatch.setattr(config, "get_settings", lambda: configured)
    calls = install_http(monkeypatch)
    with pytest.raises(ExtractionFailure, match="workouts_ai_budget_authority_unconfigured"):
        await ProductionExtractionProvider(development_api_key="fake").extract(source())
    assert calls == []


async def test_zero_budget_never_constructs_authority_pool(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Zero budget opened an authority pool")

    monkeypatch.setattr(budget_authority, "create_async_engine", forbidden)
    with pytest.raises(BudgetError, match="budget_unconfigured"):
        await BudgetGuard(replace(policy(budget=0), authority_url=SecretStr("secret"))).reserve(
            "workout_extraction", "gpt-5.6-luna", EXTRACTION
        )


@pytest.mark.parametrize(
    "url",
    [
        "private-token",
        "postgresql://u:private-password@/db",
        "postgresql://u:private-password@example.test/db?host=elsewhere",
    ],
)
async def test_invalid_authority_does_not_expose_credentials(url, caplog):
    with pytest.raises(BudgetError) as error:
        await BudgetGuard(replace(policy(), authority_url=SecretStr(url))).reserve(
            "workout_extraction", "gpt-5.6-luna", EXTRACTION
        )
    assert str(error.value) == "workouts_ai_budget_unavailable"
    assert "private-password" not in str(error.value) + caplog.text
    assert url not in repr(replace(policy(), authority_url=SecretStr(url)))


async def seed(api, *, outcome, admitted_hours=30, finished_hours=None, amount=LUNA):
    async with api.sessions() as db:
        current = await db.scalar(text("SELECT clock_timestamp()"))
        db.add(
            WorkoutsAIAdmission(
                attempt_id=uuid4(),
                capability="workout_extraction",
                model="gpt-5.6-luna",
                admitted_microusd=amount,
                admitted_at=current - timedelta(hours=admitted_hours),
                outcome=outcome,
                finished_at=None
                if finished_hours is None
                else current - timedelta(hours=finished_hours),
            )
        )
        await db.commit()


@DB_REQUIRED
@pytest.mark.parametrize("outcome", ["unknown", "failed", "cancelled", "success"])
async def test_old_unresolved_attempt_never_expires_even_after_restart(budget_api, outcome):
    # A success without its durable finish acknowledgement is also unresolved.
    await seed(
        budget_api,
        outcome=outcome,
        finished_hours=None if outcome in {"unknown", "success"} else 29,
    )
    restarted = BudgetGuard(policy(budget=LUNA), session_factory=budget_api.sessions)
    with pytest.raises(BudgetError) as error:
        await restarted.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert error.value.retry_after_seconds is None
    async with budget_api.sessions() as db:
        receipt = await budget_diagnostics(db, policy(budget=LUNA))
    assert receipt["admitted_microusd"] == LUNA
    assert receipt["unresolved_attempts"] == 1 and receipt["unresolved_hold_indefinite"]


@DB_REQUIRED
async def test_late_success_keeps_full_bound_until_finish_plus24h(budget_api):
    await seed(budget_api, outcome="success", admitted_hours=50, finished_hours=23)
    guard = BudgetGuard(policy(budget=LUNA), session_factory=budget_api.sessions)
    with pytest.raises(BudgetError) as error:
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert 3500 <= error.value.retry_after_seconds <= 3600


@DB_REQUIRED
async def test_invalid_early_finish_cannot_release_before_admission_plus24h(budget_api):
    await seed(budget_api, outcome="success", admitted_hours=23, finished_hours=50)
    with pytest.raises(BudgetError) as error:
        await BudgetGuard(policy(budget=LUNA), session_factory=budget_api.sessions).reserve(
            "workout_extraction", "gpt-5.6-luna", EXTRACTION
        )
    assert 3500 <= error.value.retry_after_seconds <= 3600


@DB_REQUIRED
async def test_insufficient_confirmed_releases_cannot_promise_retry(budget_api):
    await seed(budget_api, outcome="unknown", amount=150_000)
    await seed(budget_api, outcome="success", admitted_hours=40, finished_hours=23, amount=100_000)
    with pytest.raises(BudgetError) as error:
        await BudgetGuard(policy(budget=600_000), session_factory=budget_api.sessions).reserve(
            "workout_extraction", "gpt-5.6-luna", EXTRACTION
        )
    # Releasing100k still leaves150k +471800 >600k indefinitely.
    assert error.value.retry_after_seconds is None


@DB_REQUIRED
@pytest.mark.parametrize("exception", [TimeoutError, asyncio.CancelledError])
async def test_local_timeout_and_cancellation_do_not_prove_provider_finished(budget_api, exception):
    guard = BudgetGuard(policy(budget=LUNA), session_factory=budget_api.sessions)
    async with budget_api.sessions() as db:
        old = await db.scalar(text("SELECT clock_timestamp()-INTERVAL '30 hours'"))
    # Inject DB-time only to simulate a request admitted more than24h earlier.
    from app.domains.workouts import budget

    original = budget.database_time

    async def old_clock(db):
        return old

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(budget, "database_time", old_clock)
        with pytest.raises(exception):
            async with guard.attempt(
                capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
            ):
                raise exception()
    assert budget.database_time is original
    with pytest.raises(BudgetError) as error:
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert error.value.retry_after_seconds is None


@DB_REQUIRED
async def test_real_authority_provider_and_admin_share_durable_ledger(
    budget_api, provider_environment, monkeypatch
):
    # The application settings target a DIFFERENT nonexistent local DB. Only the
    # explicit budget authority may be consulted by admission and diagnostics.
    configured = provider_environment.model_copy(
        update={
            "workouts_ai_budget_24h_microusd": LUNA,
            "workouts_ai_budget_database_url": SecretStr(DATABASE_URL),
        }
    )
    monkeypatch.setattr(config, "get_settings", lambda: configured)
    from app.domains.workouts import budget_router

    monkeypatch.setattr(budget_router, "get_settings", lambda: configured)
    # budget_api supplies a synthetic factory; restore the real factory here.
    monkeypatch.setattr(budget_authority, "authority_sessions", ORIGINAL_AUTHORITY_SESSIONS)
    calls = install_http(monkeypatch)
    try:
        await ProductionExtractionProvider(development_api_key="fake").extract(source())
        response = await budget_api.client.get(
            "/api/admin/workouts/ai-budget", headers={"X-Test-Admin": "yes"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["admitted_microusd"] == LUNA
        assert response.json()["unresolved_attempts"] == 0
        assert response.json()["unknown_usage_attempts"] == 1
        with pytest.raises(ExtractionFailure, match="budget_exceeded"):
            await ProductionExtractionProvider(development_api_key="fake").extract(source())
        assert len(calls) == 1
        # Pool disposal/recreation simulates a restarted worker, not a refund.
        await dispose_budget_authorities()
        with pytest.raises(BudgetError, match="budget_exceeded"):
            await BudgetGuard(
                replace(policy(budget=LUNA), authority_url=SecretStr(DATABASE_URL))
            ).reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    finally:
        await dispose_budget_authorities()
    assert not budget_authority._engines


ORIGINAL_AUTHORITY_SESSIONS = budget_authority.authority_sessions


@DB_REQUIRED
@pytest.mark.parametrize(
    "fault", ["table", "version", "column", "extra_column", "foreign_key", "trigger"]
)
async def test_valid_app_schema_cannot_mask_invalid_separate_authority(
    budget_api, provider_environment, monkeypatch, fault
):
    import importlib
    import os

    from sqlalchemy.engine import make_url
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.domains.workouts.budget import verify_budget_schema
    from tests.database_safety import require_disposable_test_database

    authority_url = os.environ.get("TEST_BUDGET_AUTHORITY_DATABASE_URL")
    if not authority_url:
        pytest.skip("Separately named disposable TEST_BUDGET_AUTHORITY_DATABASE_URL required")
    require_disposable_test_database(authority_url)
    assert make_url(authority_url).database != make_url(DATABASE_URL).database, (
        "Authority must use a separately named disposable database"
    )
    authority = create_async_engine(authority_url)
    try:
        async with authority.begin() as db:
            await db.execute(text("DROP SCHEMA public CASCADE"))
            await db.execute(text("CREATE SCHEMA public"))
            await db.execute(
                text("CREATE TABLE workouts_schema_migrations(version INTEGER PRIMARY KEY)")
            )
            await db.execute(text("INSERT INTO workouts_schema_migrations(version) VALUES(40)"))
            await importlib.import_module(
                "migrations.040_add_workouts_ai_admission"
            ).install_budget_schema(db)
            faults = {
                "table": "DROP TABLE workouts_ai_admissions",
                "version": "DELETE FROM workouts_schema_migrations WHERE version=40",
                "column": "ALTER TABLE workouts_ai_admissions DROP COLUMN estimated_cost_microusd CASCADE",
                "extra_column": "ALTER TABLE workouts_ai_admissions ADD COLUMN account_identifier TEXT",
                "trigger": "DROP TRIGGER immutable_workouts_ai_admission ON workouts_ai_admissions",
            }
            if fault == "foreign_key":
                await db.execute(
                    text("CREATE TABLE synthetic_private_record(model TEXT PRIMARY KEY)")
                )
                await db.execute(
                    text(
                        "ALTER TABLE workouts_ai_admissions ADD FOREIGN KEY(model) REFERENCES synthetic_private_record(model)"
                    )
                )
            else:
                await db.execute(text(faults[fault]))
        # The application readiness result is valid but must not authorize a
        # malformed ledger in a different authority database.
        await verify_budget_schema(budget_api.engine, settings())
        configured = provider_environment.model_copy(
            update={
                "workouts_ai_budget_24h_microusd": 5_000_000,
                "workouts_ai_budget_database_url": SecretStr(authority_url),
            }
        )
        monkeypatch.setattr(config, "get_settings", lambda: configured)
        monkeypatch.setattr(budget_authority, "authority_sessions", ORIGINAL_AUTHORITY_SESSIONS)
        calls = install_http(monkeypatch)
        with pytest.raises(ExtractionFailure, match="workouts_ai_budget_unavailable"):
            await ProductionExtractionProvider(development_api_key="fake").extract(source())
        assert calls == []
        await verify_budget_schema(budget_api.engine, settings())
    finally:
        await dispose_budget_authorities()
        async with authority.begin() as db:
            await db.execute(text("DROP SCHEMA public CASCADE"))
            await db.execute(text("CREATE SCHEMA public"))
        await authority.dispose()


@DB_REQUIRED
async def test_role_default_shadow_cannot_split_public_global_capacity_or_diagnostics(
    budget_api, monkeypatch
):
    # PostgreSQL's default "$user",public resolves a same-named user schema
    # before public. A valid public trigger/version must not bless that shadow.

    from app.domains.workouts import budget_router

    async with budget_api.engine.begin() as db:
        role = await db.scalar(text("SELECT current_user"))
        assert role == "postgres", "Synthetic borrowed PostgreSQL fixture role required"
        assert await db.scalar(text("SELECT to_regnamespace('postgres') IS NULL"))
        await db.execute(text("CREATE SCHEMA postgres"))
        await db.execute(
            text(
                "CREATE TABLE postgres.workouts_ai_admissions (LIKE public.workouts_ai_admissions INCLUDING ALL)"
            )
        )
        await db.execute(
            text("CREATE TABLE postgres.workouts_schema_migrations(version INTEGER PRIMARY KEY)")
        )
        # A shadow version table intentionally has NO040 acknowledgement.
        assert await db.scalar(text("SELECT current_schema()")) == "postgres"
    configured = settings().model_copy(
        update={
            "workouts_ai_budget_24h_microusd": LUNA,
            "workouts_ai_budget_database_url": SecretStr(DATABASE_URL),
        }
    )
    monkeypatch.setattr(budget_router, "get_settings", lambda: configured)
    monkeypatch.setattr(budget_authority, "authority_sessions", ORIGINAL_AUTHORITY_SESSIONS)
    guard = BudgetGuard(replace(policy(budget=LUNA), authority_url=SecretStr(DATABASE_URL)))
    try:
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
        async with budget_api.sessions() as db:
            assert await db.scalar(text("SELECT count(*) FROM public.workouts_ai_admissions")) == 1
            assert (
                await db.scalar(text("SELECT count(*) FROM postgres.workouts_ai_admissions")) == 0
            )
        response = await budget_api.client.get(
            "/api/admin/workouts/ai-budget", headers={"X-Test-Admin": "yes"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["admitted_microusd"] == LUNA
        assert response.json()["remaining_admission_microusd"] == 0
        assert response.json()["unresolved_attempts"] == 1
        with pytest.raises(BudgetError, match="budget_exceeded") as error:
            await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
        assert error.value.retry_after_seconds is None
    finally:
        await dispose_budget_authorities()
        async with budget_api.engine.begin() as db:
            await db.execute(text("DROP SCHEMA postgres CASCADE"))

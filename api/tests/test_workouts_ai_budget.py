"""Anonymous durable global admission using injected sessions and no paid calls."""

import asyncio
import importlib
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError

from app.auth import get_current_user
from app.domains.workouts import budget_router, security
from app.domains.workouts.budget import (
    BudgetError,
    BudgetGuard,
    BudgetPolicy,
    ProviderEnvelope,
    admission_upper_bound,
    budget_diagnostics,
    verify_budget_schema,
)
from app.domains.workouts.budget_models import WorkoutsAIAdmission
from app.models.identity import AppUser
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    GENERATION,
    data_api,  # noqa: F401 -- reusable disposable fixture
    enroll,
    settings,
    user,
)

PRICES = {
    "gpt-5.6-luna": {"input_per_million": 0.20, "output_per_million": 1.20},
    "gpt-5.6-terra": {"input_per_million": 2, "output_per_million": 12},
}
LUNA = 471_800
EXTRACTION = ProviderEnvelope(endpoint="chat_completions", max_output_tokens=6000)
DB_REQUIRED = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.040_add_workouts_ai_admission")
automation = importlib.import_module("migrations.035_add_workouts_automation")


def policy(budget=5_000_000, **changes):
    return BudgetPolicy(enabled=True, budget_24h_microusd=budget, model_pricing=PRICES, **changes)


@pytest.fixture
async def budget_api(data_api, monkeypatch):  # noqa: F811 -- imported reusable disposable fixture
    await automation.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration.run_migration(configured=settings(), migration_engine=data_api.engine)
    data_api.app.include_router(budget_router.router)
    configured = SimpleNamespace(
        workouts_api_enabled=True,
        workouts_ai_budget_24h_microusd=5_000_000,
        workouts_ai_max_attempt_microusd=5_000_000,
        ai_model_pricing=PRICES,
    )
    monkeypatch.setattr(budget_router, "get_settings", lambda: configured)
    from app.domains.workouts import budget_authority

    configured.workouts_ai_budget_database_url = "synthetic-test-injection"
    monkeypatch.setattr(budget_authority, "authority_sessions", lambda _: data_api.sessions)

    async def auth(request: Request):
        return user().model_copy(
            update={"role": "admin" if request.headers.get("X-Test-Admin") == "yes" else None}
        )

    data_api.app.dependency_overrides[get_current_user] = auth
    return data_api


def test_documented_worst_bounds_text_vision_tools_long_context_and_audio():
    p = policy()
    assert admission_upper_bound("workout_extraction", "gpt-5.6-luna", EXTRACTION, p) == LUNA
    assert (
        admission_upper_bound(
            "workout_extraction", "gpt-5.6-luna", replace(EXTRACTION, includes_images=True), p
        )
        == LUNA
    )
    assert admission_upper_bound("workout_extraction", "gpt-5.6-terra", EXTRACTION, p) == 4_718_000
    assert (
        admission_upper_bound(
            "workout_coach",
            "gpt-5.6-luna",
            ProviderEnvelope(endpoint="responses", max_output_tokens=1800, function_tools=True),
            p,
        )
        == 464_240
    )
    audio = ProviderEnvelope(
        endpoint="audio_transcriptions", audio_seconds_upper_bound=61, audio_duration_verified=True
    )
    assert admission_upper_bound("workout_transcription", "whisper-1", audio, p) == 12_000


@pytest.mark.parametrize(
    "envelope",
    [
        None,
        replace(EXTRACTION, paid_tools=True),
        replace(EXTRACTION, service_tier="auto"),
        replace(EXTRACTION, processing_region="eu"),
        replace(EXTRACTION, sdk_max_retries=2),
        replace(EXTRACTION, max_output_tokens=0),
        replace(EXTRACTION, max_output_tokens=True),
        replace(EXTRACTION, max_output_tokens=128001),
        replace(EXTRACTION, function_tools=True),
        replace(EXTRACTION, audio_duration_verified=True),
    ],
)
def test_unsupported_shapes_fail_closed(envelope):
    with pytest.raises(BudgetError, match="envelope_unsupported"):
        admission_upper_bound("workout_extraction", "gpt-5.6-luna", envelope, policy())


@pytest.mark.parametrize(
    "rates",
    [
        {},
        {"gpt-5.6-luna": {}},
        {"gpt-5.6-luna": {"input_per_million": 0, "output_per_million": 1}},
        {"gpt-5.6-luna": {"input_per_million": float("nan"), "output_per_million": 1}},
    ],
)
def test_unpriced_or_invalid_rates_never_guess(rates):
    with pytest.raises(BudgetError, match="model_unpriced"):
        admission_upper_bound(
            "workout_extraction", "gpt-5.6-luna", EXTRACTION, replace(policy(), model_pricing=rates)
        )


def test_unknown_model_capability_attempt_cap_and_reference_floor():
    with pytest.raises(BudgetError, match="model_unpriced"):
        admission_upper_bound("workout_extraction", "unknown-price-model", EXTRACTION, policy())
    with pytest.raises(BudgetError, match="capability_unsupported"):
        admission_upper_bound("recipe_extraction", "gpt-5.6-luna", EXTRACTION, policy())
    with pytest.raises(BudgetError, match="attempt_cap_exceeded"):
        admission_upper_bound(
            "workout_extraction",
            "gpt-5.6-terra",
            EXTRACTION,
            policy(max_attempt_microusd=1_000_000),
        )
    lowered = replace(
        policy(),
        model_pricing={"gpt-5.6-luna": {"input_per_million": 0.01, "output_per_million": 0.01}},
    )
    assert admission_upper_bound("workout_extraction", "gpt-5.6-luna", EXTRACTION, lowered) == LUNA


async def test_disabled_unconfigured_or_invalid_admission_never_opens_database():
    def no_sessions():
        raise AssertionError("Admission incorrectly connected")

    for p, code in [
        (replace(policy(), enabled=False), "budget_disabled"),
        (policy(budget=0), "budget_unconfigured"),
        (policy(budget=-1), "configuration_invalid"),
        (policy(budget=5_000_001), "configuration_invalid"),
        (policy(max_attempt_microusd=5_000_001), "configuration_invalid"),
    ]:
        guard = BudgetGuard(p, session_factory=no_sessions)
        with pytest.raises(BudgetError, match=code):
            async with guard.attempt(
                capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
            ):
                raise AssertionError("Provider was admitted")


@DB_REQUIRED
async def test_concurrent_distinct_workers_cannot_overadmit(budget_api):
    api = budget_api
    guards = [BudgetGuard(policy(budget=2 * LUNA), session_factory=api.sessions) for _ in range(2)]

    async def attempt(index):
        try:
            async with guards[index % 2].attempt(
                capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
            ) as paid:
                paid.complete(outcome="success", estimated_cost_microusd=1)
                return "admitted"
        except BudgetError as exc:
            assert (
                exc.code == "workouts_ai_budget_exceeded" and 1 <= exc.retry_after_seconds <= 86400
            )
            return "rejected"

    results = await asyncio.gather(*[attempt(index) for index in range(12)])
    assert results.count("admitted") == 2 and results.count("rejected") == 10
    async with api.sessions() as db:
        assert await db.scalar(select(func.sum(WorkoutsAIAdmission.admitted_microusd))) == 2 * LUNA
        assert await db.scalar(select(func.sum(WorkoutsAIAdmission.estimated_cost_microusd))) == 2


@DB_REQUIRED
async def test_crash_failure_unknown_and_cancellation_consume_full_reservation(budget_api):
    api = budget_api
    guard = BudgetGuard(policy(budget=4 * LUNA), session_factory=api.sessions)
    # Commit a reservation without finalization, representing a killed worker.
    await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    with pytest.raises(RuntimeError):
        async with guard.attempt(
            capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
        ):
            raise RuntimeError("synthetic private prompt must never be persisted")
    async with guard.attempt(
        capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
    ):
        pass  # Missing reliable validation/usage remains unknown.
    with pytest.raises(asyncio.CancelledError):
        async with guard.attempt(
            capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
        ):
            raise asyncio.CancelledError()
    with pytest.raises(BudgetError, match="budget_exceeded"):
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    async with api.sessions() as db:
        rows = (await db.scalars(select(WorkoutsAIAdmission))).all()
        assert sorted(row.outcome for row in rows) == ["cancelled", "failed", "unknown", "unknown"]
        assert sum(row.admitted_microusd for row in rows) == 4 * LUNA
        assert all(row.estimated_cost_microusd is None for row in rows)
        assert not any(
            "private" in str(getattr(row, column.name))
            for row in rows
            for column in WorkoutsAIAdmission.__table__.columns
        )


@DB_REQUIRED
async def test_rolling_window_database_clock_and_retry_capacity(budget_api):
    api = budget_api
    guard = BudgetGuard(policy(budget=LUNA), session_factory=api.sessions)
    async with api.sessions() as db:
        old = await db.scalar(text("SELECT clock_timestamp()-INTERVAL '24 hours 1 second'"))
        recent = await db.scalar(text("SELECT clock_timestamp()-INTERVAL '23 hours'"))
        db.add_all(
            [
                WorkoutsAIAdmission(
                    attempt_id=uuid4(),
                    capability="workout_extraction",
                    model="gpt-5.6-luna",
                    admitted_microusd=LUNA,
                    admitted_at=old,
                    outcome="success",
                    finished_at=old,
                ),
                WorkoutsAIAdmission(
                    attempt_id=uuid4(),
                    capability="workout_extraction",
                    model="gpt-5.6-luna",
                    admitted_microusd=LUNA,
                    admitted_at=recent,
                    finished_at=recent,
                    outcome="success",
                ),
            ]
        )
        await db.commit()
    with pytest.raises(BudgetError) as failure:
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert 3500 <= failure.value.retry_after_seconds <= 3600
    async with api.sessions() as db:
        diagnostics = await budget_diagnostics(db, policy(budget=LUNA))
        assert diagnostics["admitted_microusd"] == LUNA and diagnostics["attempts"] == 1


@DB_REQUIRED
async def test_commit_before_body_and_outcome_failure_never_refunds(budget_api):
    api = budget_api
    guard = BudgetGuard(policy(budget=LUNA), session_factory=api.sessions)
    async with guard.attempt(
        capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
    ) as paid:
        async with api.sessions() as separate_worker:
            assert await separate_worker.get(WorkoutsAIAdmission, paid.attempt_id) is not None
        paid.complete(outcome="success", estimated_cost_microusd=5)

        def broken_sessions():
            raise RuntimeError("private database details")

        guard.session_factory = broken_sessions
    guard.session_factory = api.sessions
    with pytest.raises(BudgetError, match="budget_exceeded"):
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    async with api.sessions() as db:
        assert (await db.scalar(select(WorkoutsAIAdmission))).outcome == "unknown"


@DB_REQUIRED
async def test_no_owner_fields_account_deletion_cannot_reset_budget(budget_api):
    api = budget_api
    await enroll(api)
    guard = BudgetGuard(policy(budget=LUNA), session_factory=api.sessions)
    async with guard.attempt(
        capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
    ) as paid:
        paid.complete(outcome="success", estimated_cost_microusd=LUNA + 1)
    assert set(WorkoutsAIAdmission.__table__.columns.keys()) == {
        "attempt_id",
        "capability",
        "model",
        "admitted_microusd",
        "estimated_cost_microusd",
        "outcome",
        "admitted_at",
        "finished_at",
    }
    assert (await api.client.delete("/api/v1/workouts/data", headers=GENERATION)).status_code == 200
    async with api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(WorkoutsAIAdmission)) == 1
        assert (await budget_diagnostics(db, policy()))["estimated_usage_microusd"] == LUNA + 1
    with pytest.raises(BudgetError, match="budget_exceeded"):
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)


@DB_REQUIRED
async def test_existing_admin_gate_private_bounded_diagnostics_and_disabled404(
    budget_api, monkeypatch
):
    api = budget_api
    guard = BudgetGuard(policy(), session_factory=api.sessions)
    await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    route = "/api/admin/workouts/ai-budget"
    assert (await api.client.get(route)).status_code == 403
    response = await api.client.get(route, headers={"X-Test-Admin": "yes"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admitted_microusd"] == LUNA and not body["provider_bill_limit_guaranteed"]
    assert body["unknown_usage_attempts"] == 1 and response.headers["Cache-Control"] == "no-store"
    assert "owner" not in response.text and "request_id" not in response.text
    assert (
        await api.client.get(route + "?limit=51", headers={"X-Test-Admin": "yes"})
    ).status_code == 422
    monkeypatch.setattr(
        security, "get_settings", lambda: SimpleNamespace(workouts_api_enabled=False)
    )
    assert (await api.client.get(route)).status_code == 404


@DB_REQUIRED
async def test_attempt_identity_immutable_and_missing_db_failclosed(budget_api):
    api = budget_api
    guard = BudgetGuard(policy(), session_factory=api.sessions)
    attempt = guard.attempt(
        capability="workout_extraction", model="gpt-5.6-luna", envelope=EXTRACTION
    )
    async with attempt as admitted:
        admitted.complete(outcome="success")
    with pytest.raises(BudgetError, match="attempt_reused"):
        async with attempt:
            pass
    async with api.sessions() as db:
        row = await db.scalar(select(WorkoutsAIAdmission))
        row.admitted_microusd = 1
        with pytest.raises(DBAPIError, match="immutable"):
            await db.commit()

    def no_database():
        raise RuntimeError("private db credential")

    broken = BudgetGuard(policy(), session_factory=no_database)
    with pytest.raises(BudgetError, match="budget_unavailable") as failure:
        await broken.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert "private" not in str(failure.value)


@DB_REQUIRED
async def test_optional_migration_restore_readiness_and_core_ledger(budget_api, monkeypatch):
    api = budget_api

    class NoDatabase:
        def begin(self):
            raise AssertionError("Disabled migration connected")

        def connect(self):
            raise AssertionError("Disabled readiness connected")

    disabled = SimpleNamespace(workouts_api_enabled=False)
    await migration.run_migration(configured=disabled, migration_engine=NoDatabase())
    await verify_budget_schema(NoDatabase(), disabled)
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await verify_budget_schema(api.engine, settings())
    async with api.engine.begin() as connection:
        assert (
            await connection.execute(text("SELECT version FROM schema_migrations"))
        ).scalars().all() == [33]
        await connection.execute(text("DELETE FROM workouts_schema_migrations WHERE version=40"))
    monkeypatch.delenv("MIGRATION_040_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="verified restore point"):
        await migration.run_migration(
            configured=SimpleNamespace(workouts_api_enabled=True, environment="production"),
            migration_engine=api.engine,
        )


@DB_REQUIRED
async def test_confirmed_success_expiry_does_not_block_new_and_uses_database_time(budget_api):
    api = budget_api
    async with api.sessions() as db:
        old = await db.scalar(text("SELECT clock_timestamp()-INTERVAL '25 hours'"))
        db.add(
            WorkoutsAIAdmission(
                attempt_id=uuid4(),
                capability="workout_extraction",
                model="gpt-5.6-luna",
                admitted_microusd=LUNA,
                admitted_at=old,
                finished_at=old,
                outcome="success",
            )
        )
        await db.commit()
    guard = BudgetGuard(policy(budget=LUNA), session_factory=api.sessions)
    identifier, amount = await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert amount == LUNA
    async with api.sessions() as db:
        new = await db.get(WorkoutsAIAdmission, identifier)
        current = await db.scalar(text("SELECT clock_timestamp()"))
        assert 0 <= (current - new.admitted_at).total_seconds() < 10
        assert (await budget_diagnostics(db, policy(budget=LUNA)))["attempts"] == 1


@DB_REQUIRED
async def test_partial_multi_model_expiry_retry_waits_for_sufficient_capacity(budget_api):
    api = budget_api
    async with api.sessions() as db:
        current = await db.scalar(text("SELECT clock_timestamp()"))
        from datetime import timedelta

        for hours, amount in [(23, 100_000), (22, 400_000)]:
            db.add(
                WorkoutsAIAdmission(
                    attempt_id=uuid4(),
                    capability="workout_extraction",
                    model="gpt-5.6-luna",
                    admitted_microusd=amount,
                    admitted_at=current - timedelta(hours=hours),
                    finished_at=current - timedelta(hours=hours),
                    outcome="success",
                )
            )
        await db.commit()
    guard = BudgetGuard(policy(budget=600_000), session_factory=api.sessions)
    with pytest.raises(BudgetError) as failure:
        await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
    assert 7100 <= failure.value.retry_after_seconds <= 7200


@DB_REQUIRED
async def test_readiness_detects_lost_immutability_trigger(budget_api):
    async with budget_api.engine.begin() as connection:
        await connection.execute(
            text("DROP TRIGGER immutable_workouts_ai_admission ON workouts_ai_admissions")
        )
    with pytest.raises(RuntimeError, match="immutability trigger"):
        await verify_budget_schema(budget_api.engine, settings())


@DB_REQUIRED
async def test_repeatable_read_factory_still_observes_serialized_admissions(budget_api):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    repeated = budget_api.engine.execution_options(isolation_level="REPEATABLE READ")
    factory = async_sessionmaker(repeated, expire_on_commit=False)
    guard = BudgetGuard(policy(budget=LUNA), session_factory=factory)

    async def admission():
        try:
            await guard.reserve("workout_extraction", "gpt-5.6-luna", EXTRACTION)
            return True
        except BudgetError as error:
            assert error.code == "workouts_ai_budget_exceeded"
            return False

    assert sum(await asyncio.gather(*[admission() for _ in range(6)])) == 1


def test_failure_code_is_closed_and_cannot_include_source_contents():
    error = BudgetError("private prompt or health data")
    assert str(error) == "workouts_ai_budget_unavailable"

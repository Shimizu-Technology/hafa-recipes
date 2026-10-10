"""Durable admission upper bounds; these are not provider billing guarantees."""

import logging
import math
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal, InvalidOperation
from typing import Literal, Mapping
from uuid import uuid4

from pydantic import SecretStr
from sqlalchemy import and_, func, not_, or_, select, text

from app.domains.workouts.budget_models import WorkoutsAIAdmission

logger = logging.getLogger("hafa.workouts.budget")
LOCK_ID = 7340040
WINDOW = timedelta(hours=24)
AUTHORIZED_CAP_MICROUSD = 5_000_000
CAPABILITIES = frozenset({"workout_extraction", "workout_coach", "workout_transcription"})
MAX_MONEY = 9_000_000_000_000_000
# Official exact snapshot/model and standard pricing/vision docs checked2026-10-10.
# Both text and billable image tokens fit this documented model input ceiling.
MODEL_MAX_INPUT = 922_000
MODEL_MAX_OUTPUT = 128_000
STANDARD_TOKEN_PRICES = {
    "gpt-5.6-luna": (Decimal("0.20"), Decimal("1.20")),
    "gpt-5.6-terra": (Decimal("2.00"), Decimal("12.00")),
}
OUTCOMES = frozenset({"unknown", "success", "failed", "cancelled"})


FAILURE_CODES = (
    "workouts_ai_budget_disabled",
    "workouts_ai_budget_configuration_invalid",
    "workouts_ai_budget_unconfigured",
    "workouts_ai_budget_authority_unconfigured",
    "workouts_ai_capability_unsupported",
    "workouts_ai_model_unpriced",
    "workouts_ai_envelope_unsupported",
    "workouts_ai_attempt_cap_exceeded",
    "workouts_ai_budget_exceeded",
    "workouts_ai_budget_unavailable",
    "workouts_ai_attempt_reused",
    "workouts_ai_usage_invalid",
    "workouts_ai_diagnostics_invalid",
)


class BudgetError(Exception):
    """Privacy-safe failure code; never contain prompt, owner or provider body."""

    def __init__(self, code, *, retry_after_seconds=None):
        code = (
            code
            if type(code) is str and code in FAILURE_CODES
            else "workouts_ai_budget_unavailable"
        )
        super().__init__(code)
        self.code = code
        self.retry_after_seconds = retry_after_seconds
        self.status_code = 429 if code == "workouts_ai_budget_exceeded" else 503


@dataclass(frozen=True)
class BudgetPolicy:
    enabled: bool
    budget_24h_microusd: int = 0
    max_attempt_microusd: int = 5_000_000
    model_pricing: Mapping = field(default_factory=dict)
    authority_url: SecretStr | None = field(default=None, repr=False)

    @classmethod
    def from_settings(cls, settings):
        return cls(
            enabled=settings.workouts_api_enabled,
            budget_24h_microusd=getattr(settings, "workouts_ai_budget_24h_microusd", 0),
            max_attempt_microusd=getattr(settings, "workouts_ai_max_attempt_microusd", 5_000_000),
            model_pricing=getattr(settings, "ai_model_pricing", {}),
            authority_url=getattr(settings, "workouts_ai_budget_database_url", None),
        )


@dataclass(frozen=True)
class ProviderEnvelope:
    """Server-derived provider shape; never accepts or retains source contents.

    Input uses the full documented model ceiling instead of a text/image token
    estimate. An exact output limit must be enforced on the actual provider call.
    Function schemas are input tokens; paid hosted tools and alternate tiers are
    deliberately unsupported. Audio must be independently probed and bounded.
    """

    endpoint: Literal["chat_completions", "responses", "audio_transcriptions"]
    max_output_tokens: int | None = None
    audio_seconds_upper_bound: float | None = None
    audio_duration_verified: bool = False
    includes_images: bool = False
    function_tools: bool = False
    paid_tools: bool = False
    service_tier: str = "default"
    processing_region: str = "global"
    sdk_max_retries: int = 0


def validate_policy(policy):
    if not policy.enabled:
        raise BudgetError("workouts_ai_budget_disabled")
    if (
        type(policy.budget_24h_microusd) is not int
        or not 0 <= policy.budget_24h_microusd <= AUTHORIZED_CAP_MICROUSD
    ):
        raise BudgetError("workouts_ai_budget_configuration_invalid")
    if policy.budget_24h_microusd == 0:
        raise BudgetError("workouts_ai_budget_unconfigured")
    if (
        type(policy.max_attempt_microusd) is not int
        or not 1 <= policy.max_attempt_microusd <= AUTHORIZED_CAP_MICROUSD
    ):
        raise BudgetError("workouts_ai_budget_configuration_invalid")


def positive_rate(value):
    try:
        if isinstance(value, bool):
            raise ValueError()
        number = Decimal(str(value))
        if not number.is_finite() or number <= 0:
            raise ValueError()
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BudgetError("workouts_ai_model_unpriced") from exc
    return number


def admission_upper_bound(capability, model, envelope, policy):
    validate_policy(policy)
    if type(capability) is not str or capability not in CAPABILITIES:
        raise BudgetError("workouts_ai_capability_unsupported")
    if type(model) is not str:
        raise BudgetError("workouts_ai_model_unpriced")
    if not isinstance(envelope, ProviderEnvelope):
        raise BudgetError("workouts_ai_envelope_unsupported")
    if (
        envelope.paid_tools
        or envelope.service_tier != "default"
        or envelope.processing_region != "global"
        or type(envelope.sdk_max_retries) is not int
        or envelope.sdk_max_retries != 0
        or any(
            type(getattr(envelope, key)) is not bool
            for key in (
                "paid_tools",
                "audio_duration_verified",
                "includes_images",
                "function_tools",
            )
        )
    ):
        raise BudgetError("workouts_ai_envelope_unsupported")
    if capability == "workout_transcription":
        if model != "whisper-1":
            raise BudgetError("workouts_ai_model_unpriced")
        seconds = envelope.audio_seconds_upper_bound
        if (
            envelope.endpoint != "audio_transcriptions"
            or not envelope.audio_duration_verified
            or envelope.max_output_tokens is not None
            or envelope.includes_images
            or envelope.function_tools
            or type(seconds) not in {int, float}
            or not math.isfinite(seconds)
            or not 0 < seconds <= 1800
        ):
            raise BudgetError("workouts_ai_envelope_unsupported")
        # Verified official Whisper rate0.006USD/min; round up to whole minutes.
        amount = math.ceil(seconds / 60) * 6000
    else:
        if model not in STANDARD_TOKEN_PRICES:
            raise BudgetError("workouts_ai_model_unpriced")
        output = envelope.max_output_tokens
        expected_endpoint = (
            "chat_completions" if capability == "workout_extraction" else "responses"
        )
        if (
            envelope.endpoint != expected_endpoint
            or type(output) is not int
            or not 1 <= output <= MODEL_MAX_OUTPUT
            or envelope.audio_seconds_upper_bound is not None
            or envelope.audio_duration_verified
            or (envelope.includes_images and capability != "workout_extraction")
            or (envelope.function_tools and capability != "workout_coach")
        ):
            raise BudgetError("workouts_ai_envelope_unsupported")
        prices = policy.model_pricing.get(model)
        if not isinstance(prices, Mapping):
            raise BudgetError("workouts_ai_model_unpriced")
        input_rate = positive_rate(prices.get("input_per_million"))
        if prices.get("cached_input_per_million") is not None:
            cached_rate = prices["cached_input_per_million"]
            if cached_rate != 0:
                input_rate = max(input_rate, positive_rate(cached_rate))
        output_rate = positive_rate(prices.get("output_per_million"))
        reference_input, reference_output = STANDARD_TOKEN_PRICES[model]
        # Full max input is long context: input2x, cache writes1.25x, output1.5x.
        # Reference floors prevent a stale/low operator quote lowering admission.
        input_upper_rate = max(input_rate, reference_input) * Decimal("2.5")
        output_upper_rate = max(output_rate, reference_output) * Decimal("1.5")
        amount = int(
            (MODEL_MAX_INPUT * input_upper_rate + output * output_upper_rate).to_integral_value(
                rounding=ROUND_CEILING
            )
        )
    if amount > policy.max_attempt_microusd:
        raise BudgetError("workouts_ai_attempt_cap_exceeded")
    if amount > policy.budget_24h_microusd:
        raise BudgetError("workouts_ai_budget_exceeded", retry_after_seconds=None)
    return amount


async def database_time(db):
    # Capture after obtaining the lock; process clocks cannot shorten the window.
    return await db.scalar(text("SELECT clock_timestamp()"))


def confirmed_admission():
    # A local exception/cancellation is not evidence the provider stopped billing.
    return and_(
        WorkoutsAIAdmission.outcome == "success", WorkoutsAIAdmission.finished_at.is_not(None)
    )


def confirmation_time():
    return func.greatest(WorkoutsAIAdmission.admitted_at, WorkoutsAIAdmission.finished_at)


def charged_admission(current):
    return or_(not_(confirmed_admission()), confirmation_time() > current - WINDOW)


class BudgetGuard:
    def __init__(self, policy, *, session_factory=None):
        self.policy = policy
        self.session_factory = session_factory

    def sessions(self):
        if self.session_factory is not None:
            return self.session_factory  # Trusted, explicit synthetic test injection only.
        if self.policy.authority_url is None:
            raise BudgetError("workouts_ai_budget_authority_unconfigured")
        from app.domains.workouts.budget_authority import authority_sessions

        return authority_sessions(self.policy.authority_url)

    async def diagnostics(self, *, limit=50):
        validate_policy(self.policy)
        async with self.sessions()() as db:
            if self.session_factory is None:
                await verify_budget_connection(db)
            return await budget_diagnostics(db, self.policy, limit=limit)

    def attempt(self, *, capability, model, envelope):
        return BudgetAttempt(self, capability, model, envelope)

    async def reserve(self, capability, model, envelope):
        amount = admission_upper_bound(capability, model, envelope, self.policy)
        try:
            async with self.sessions()() as db:
                async with db.begin():
                    # Refresh the view after a waiting lock even if the injected
                    # engine defaults to REPEATABLE READ. This transaction is
                    # independent and has not performed any prior query.
                    await db.execute(text("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"))
                    await db.execute(text("SELECT pg_advisory_xact_lock(:lock)"), {"lock": LOCK_ID})
                    if self.session_factory is None:
                        await verify_budget_connection(db)
                    current = await database_time(db)
                    total = await db.scalar(
                        select(
                            func.coalesce(func.sum(WorkoutsAIAdmission.admitted_microusd), 0)
                        ).where(charged_admission(current))
                    )
                    if total + amount > self.policy.budget_24h_microusd:
                        releases = (
                            select(
                                confirmation_time().label("confirmed_at"),
                                func.sum(WorkoutsAIAdmission.admitted_microusd)
                                .over(
                                    order_by=(
                                        confirmation_time(),
                                        WorkoutsAIAdmission.attempt_id,
                                    ),
                                    rows=(None, 0),
                                )
                                .label("released"),
                            )
                            .where(confirmed_admission(), confirmation_time() > current - WINDOW)
                            .subquery()
                        )
                        sufficient = await db.scalar(
                            select(releases.c.confirmed_at)
                            .where(
                                releases.c.released
                                >= total + amount - self.policy.budget_24h_microusd
                            )
                            .order_by(releases.c.confirmed_at)
                            .limit(1)
                        )
                        retry = (
                            max(
                                1,
                                min(
                                    86400,
                                    math.ceil((sufficient + WINDOW - current).total_seconds()),
                                ),
                            )
                            if sufficient
                            else None
                        )
                        raise BudgetError("workouts_ai_budget_exceeded", retry_after_seconds=retry)
                    identifier = uuid4()
                    db.add(
                        WorkoutsAIAdmission(
                            attempt_id=identifier,
                            capability=capability,
                            model=model,
                            admitted_microusd=amount,
                            outcome="unknown",
                            admitted_at=current,
                        )
                    )
                # Transaction commits before provider code is admitted to the body.
                return identifier, amount
        except BudgetError:
            raise
        except Exception:
            logger.warning("workouts_ai_budget_admission_unavailable")
            raise BudgetError("workouts_ai_budget_unavailable") from None

    async def finish(self, identifier, outcome, estimated_cost):
        try:
            async with self.sessions()() as db:
                async with db.begin():
                    row = await db.scalar(
                        select(WorkoutsAIAdmission)
                        .where(WorkoutsAIAdmission.attempt_id == identifier)
                        .with_for_update()
                    )
                    if row is None or row.finished_at is not None:
                        return
                    row.outcome = outcome
                    row.estimated_cost_microusd = estimated_cost
                    row.finished_at = await database_time(db)
        except Exception:
            # The committed unknown reservation remains consumed. Outcome logging
            # failure cannot refund capacity or hide the provider's original error.
            logger.warning("workouts_ai_budget_outcome_unavailable")


class BudgetAttempt:
    def __init__(self, guard, capability, model, envelope):
        self.guard, self.capability, self.model, self.envelope = guard, capability, model, envelope
        self.attempt_id = None
        self.admitted_microusd = None
        self._used = False
        self._outcome = "unknown"
        self._estimated_cost = None

    async def __aenter__(self):
        if self._used:
            raise BudgetError("workouts_ai_attempt_reused")
        self._used = True
        self.attempt_id, self.admitted_microusd = await self.guard.reserve(
            self.capability, self.model, self.envelope
        )
        return self

    def complete(self, *, outcome, estimated_cost_microusd=None):
        if (
            self.attempt_id is None
            or type(outcome) is not str
            or outcome not in OUTCOMES
            or (
                estimated_cost_microusd is not None
                and (
                    type(estimated_cost_microusd) is not int
                    or not 0 <= estimated_cost_microusd <= MAX_MONEY
                )
            )
        ):
            raise BudgetError("workouts_ai_usage_invalid")
        self._outcome, self._estimated_cost = outcome, estimated_cost_microusd

    async def __aexit__(self, exc_type, exc, traceback):
        if exc is not None:
            import asyncio

            self._outcome = "cancelled" if isinstance(exc, asyncio.CancelledError) else "failed"
        if self.attempt_id is not None:
            await self.guard.finish(self.attempt_id, self._outcome, self._estimated_cost)
        return False


async def budget_diagnostics(db, policy, *, limit=50):
    if not 1 <= limit <= 50:
        raise BudgetError("workouts_ai_diagnostics_invalid")
    current = await database_time(db)
    active = charged_admission(current)
    totals = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(WorkoutsAIAdmission.admitted_microusd), 0),
                func.coalesce(func.sum(WorkoutsAIAdmission.estimated_cost_microusd), 0),
                func.count().filter(WorkoutsAIAdmission.estimated_cost_microusd.is_(None)),
            ).where(active)
        )
    ).one()
    rows = (
        await db.execute(
            select(
                WorkoutsAIAdmission.capability,
                WorkoutsAIAdmission.model,
                WorkoutsAIAdmission.outcome,
                func.count().label("attempts"),
                func.sum(WorkoutsAIAdmission.admitted_microusd).label("admitted_microusd"),
                func.coalesce(func.sum(WorkoutsAIAdmission.estimated_cost_microusd), 0).label(
                    "estimated_usage_microusd"
                ),
                func.count()
                .filter(WorkoutsAIAdmission.estimated_cost_microusd.is_(None))
                .label("unknown_usage_attempts"),
                func.count()
                .filter(
                    WorkoutsAIAdmission.estimated_cost_microusd
                    > WorkoutsAIAdmission.admitted_microusd
                )
                .label("estimated_over_bound_attempts"),
            )
            .where(active)
            .group_by(
                WorkoutsAIAdmission.capability,
                WorkoutsAIAdmission.model,
                WorkoutsAIAdmission.outcome,
            )
            .order_by(
                WorkoutsAIAdmission.capability,
                WorkoutsAIAdmission.model,
                WorkoutsAIAdmission.outcome,
            )
            .limit(limit + 1)
        )
    ).all()
    return {
        "window_hours": 24,
        "window_starts_at": "verified_success_finish_or_admission_whichever_is_later",
        "unresolved_hold_indefinite": True,
        "unresolved_attempts": await db.scalar(
            select(func.count()).select_from(WorkoutsAIAdmission).where(not_(confirmed_admission()))
        ),
        "generated_at": current,
        "configured": policy.budget_24h_microusd > 0,
        "budget_24h_microusd": policy.budget_24h_microusd,
        "max_attempt_microusd": policy.max_attempt_microusd,
        "admitted_microusd": totals[1],
        "remaining_admission_microusd": max(0, policy.budget_24h_microusd - totals[1]),
        "attempts": totals[0],
        "estimated_usage_microusd": totals[2],
        "unknown_usage_attempts": totals[3],
        "groups": [dict(row._mapping) for row in rows[:limit]],
        "has_more": len(rows) > limit,
        "limit": limit,
        "provider_bill_limit_guaranteed": False,
        "failure_codes": list(FAILURE_CODES),
    }


async def verify_budget_schema(engine, settings):
    if not settings.workouts_api_enabled:
        return
    async with engine.connect() as connection:
        await verify_budget_connection(connection)


async def verify_budget_connection(connection):
    if not await connection.scalar(
        text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
    ) or not await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM public.workouts_schema_migrations WHERE version=40)")
    ):
        raise RuntimeError("Workouts AI admission migration040 is required")
    columns = set(
        (
            await connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='workouts_ai_admissions'"
                )
            )
        ).scalars()
    )
    if columns != set(WorkoutsAIAdmission.__table__.columns.keys()):
        raise RuntimeError(
            "Workouts AI admission schema is incomplete or contains unexpected fields"
        )
    if await connection.scalar(
        text(
            "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.workouts_ai_admissions'::regclass AND contype='f')"
        )
    ):
        raise RuntimeError("Anonymous Workouts AI admissions must not reference account tables")
    if not await connection.scalar(
        text("""SELECT EXISTS(SELECT 1 FROM pg_trigger
        WHERE tgrelid='public.workouts_ai_admissions'::regclass
        AND tgname='immutable_workouts_ai_admission'
        AND tgfoid='public.protect_workouts_ai_admission'::regproc
        AND tgenabled IN ('O','A') AND NOT tgisinternal)""")
    ):
        raise RuntimeError("Workouts AI admission immutability trigger is missing")

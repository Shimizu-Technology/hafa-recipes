"""Content-free durable paid admission; no provider retry can evade the ceiling."""

from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal
from typing import NamedTuple

from sqlalchemy import func, select, text

from app.ai_governance import current_ai_context
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.baby.lifecycle import membership_for, now
from app.domains.baby.models import BabyAIAdmission
from app.domains.workouts.budget import (
    AUTHORIZED_CAP_MICROUSD,
    BudgetError,
    BudgetPolicy,
    ProviderEnvelope,
    admission_upper_bound,
)

GLOBAL_DAILY_CAP = 10_000_000
OWNER_DAILY_CAP = 6_000_000
MAX_ATTEMPTS = 100
LOCK_ID = 7340052
LEGACY_MAX_OUTPUT = 2400


class ModelPrice(NamedTuple):
    """USD per million tokens at standard short-context rates."""

    input: Decimal
    cache_write: Decimal
    output: Decimal


# Provider pricing pages, checked 2026-11-05. A model missing here fails closed.
BABY_MODEL_PRICES = {
    "gpt-6-luna": ModelPrice(Decimal("0.10"), Decimal("0.125"), Decimal("0.50")),
    "gpt-6.1-terra": ModelPrice(Decimal("1.00"), Decimal("1.25"), Decimal("5.00")),
    "gpt-6-astra": ModelPrice(Decimal("10.00"), Decimal("12.50"), Decimal("50.00")),
    "claude-haiku-5-5": ModelPrice(Decimal("0.10"), Decimal("0.125"), Decimal("0.50")),
}
# Priced so an evaluation can state its cost. It has no adapter or consent text in production.
EVAL_ONLY_MODELS = frozenset({"claude-haiku-5-5"})
ASK_CAPABILITIES = ("baby_ask", "baby_research")
# Dollars are one ceiling across every Baby capability. Attempts are counted apart, since an Ask
# question is several small calls and shouldn't use up the attempts imports count on.
ASK_MAX_ATTEMPTS = 300  # 50 questions a day, each up to 5 tool rounds and a final answer.
MAX_TOOL_ROUNDS = 5
MAX_RESEARCH_CALLS = 1
SEARCH_CALL_MICROUSD = 10_000  # $10 per 1,000 calls; content tokens are billed as input.
MAX_SEARCHES_PER_CALL = 2
SEARCH_CONTEXT_TOKENS = 128_000  # The provider's web search context limit.
LONG_CONTEXT_TOKENS = 272_000  # Past this the provider charges 2x input and 1.5x output.
ASK_MAX_OUTPUT = 8_000
FRAMING_TOKENS = 2_000


@dataclass(frozen=True)
class AskCall:
    """One Responses call, described by the server before it is sent.

    A token is at least one UTF-8 byte, so the request's own size bounds its input.
    """

    model: str
    input_bytes: int
    max_output_tokens: int
    searches: int = 0
    endpoint: str = "responses"
    service_tier: str = "default"
    sdk_max_retries: int = 0


def ask_upper_bound(call):
    if call.model not in BABY_MODEL_PRICES or call.model in EVAL_ONLY_MODELS:
        raise BudgetError("workouts_ai_model_unpriced")
    if (
        call.endpoint != "responses"
        or call.service_tier != "default"
        or call.sdk_max_retries != 0
        or type(call.input_bytes) is not int
        or call.input_bytes < 0
        or type(call.max_output_tokens) is not int
        or not 1 <= call.max_output_tokens <= ASK_MAX_OUTPUT
        or type(call.searches) is not int
        or not 0 <= call.searches <= MAX_SEARCHES_PER_CALL
    ):
        raise BudgetError("workouts_ai_envelope_unsupported")
    tokens = call.input_bytes + FRAMING_TOKENS
    if call.searches:
        # Each search can add a full context of results, billed again on the next model turn.
        tokens = max(tokens, SEARCH_CONTEXT_TOKENS) * (call.searches + 1)
    # Past the long-context line the rates below would no longer bound the bill.
    if max(call.input_bytes + FRAMING_TOKENS, SEARCH_CONTEXT_TOKENS if call.searches else 0) > LONG_CONTEXT_TOKENS:
        raise BudgetError("workouts_ai_envelope_unsupported")
    price = BABY_MODEL_PRICES[call.model]
    tokens_cost = tokens * max(price.input, price.cache_write) + call.max_output_tokens * price.output
    return int(tokens_cost.to_integral_value(rounding=ROUND_CEILING)) + call.searches * SEARCH_CALL_MICROUSD


class QuestionBudget:
    """One question's paid calls, counted before each reservation so a tool loop has to stop."""

    def __init__(self):
        self.rounds = 0
        self.research_calls = 0

    @property
    def tools_allowed(self):
        return self.rounds < MAX_TOOL_ROUNDS

    def start_round(self):
        # Five rounds that may use tools, then one that must answer.
        if self.rounds > MAX_TOOL_ROUNDS:
            raise BudgetError("workouts_ai_attempt_cap_exceeded")
        self.rounds += 1

    def start_research(self):
        if self.research_calls >= MAX_RESEARCH_CALLS:
            raise BudgetError("workouts_ai_attempt_cap_exceeded")
        self.research_calls += 1


def upper_bound(capability, model, *, images=False, duration=None):
    # Reuse the platform's verified conservative model/endpoint envelope
    # calculation, without borrowing Workouts' permissions, data or ledger.
    if capability == "baby_transcription":
        envelope = ProviderEnvelope(
            endpoint="audio_transcriptions",
            audio_seconds_upper_bound=duration,
            audio_duration_verified=True,
            sdk_max_retries=0,
        )
        platform_capability = "workout_transcription"
    else:
        envelope = ProviderEnvelope(
            endpoint="chat_completions",
            max_output_tokens=LEGACY_MAX_OUTPUT,
            includes_images=images,
            service_tier="default",
            sdk_max_retries=0,
        )
        platform_capability = "workout_extraction"
    # Default policy supplies immutable supported-model pricing and an attempt
    # ceiling. Budget admission fails closed for unpriced custom models.
    return admission_upper_bound(
        platform_capability,
        model,
        envelope,
        BudgetPolicy(
            enabled=True,
            # Only here to reuse the pricing check. Baby's own ceilings are enforced in reserve, on its own ledger.
            budget_24h_microusd=min(GLOBAL_DAILY_CAP, AUTHORIZED_CAP_MICROUSD),
            model_pricing=get_settings().ai_model_pricing,
        ),
    )


async def spent(db, owner, attempts_counted):
    """Last 24 hours: everyone's dollars, this person's dollars, and this person's matching attempts."""
    window = BabyAIAdmission.created_at > now() - timedelta(days=1)
    dollars = func.coalesce(func.sum(BabyAIAdmission.reserved_microusd), 0)
    total = await db.scalar(select(dollars).where(window))
    owner_total = await db.scalar(select(dollars).where(window, BabyAIAdmission.app_user_id == owner))
    count = await db.scalar(
        select(func.count()).select_from(BabyAIAdmission).where(window, BabyAIAdmission.app_user_id == owner, attempts_counted)
    )
    return total, owner_total, count


async def reserve(capability, model, *, images=False, duration=None, sessions=None):
    context = current_ai_context()
    if not context.user_id:
        raise BudgetError("workouts_ai_budget_unavailable")
    amount = upper_bound(capability, model, images=images, duration=duration)
    async with (sessions or AsyncSessionLocal)() as db:
        member = await membership_for(db, context.user_id, write=True)
        if not member.profile.get("ai_consent"):
            raise BudgetError("workouts_ai_budget_unavailable")
        # Account-first ordering matches every private mutation/deletion. This
        # global lock serializes budget reservations across server replicas.
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
        total, owner_total, owner_count = await spent(db, context.user_id, BabyAIAdmission.capability.not_in(ASK_CAPABILITIES))
        if (
            total + amount > GLOBAL_DAILY_CAP
            or owner_total + amount > OWNER_DAILY_CAP
            or owner_count >= MAX_ATTEMPTS
        ):
            raise BudgetError("workouts_ai_budget_exceeded")
        db.add(
            BabyAIAdmission(
                app_user_id=context.user_id,
                generation=member.generation,
                capability=capability,
                reserved_microusd=amount,
                created_at=now(),
            )
        )
        await db.commit()


async def reserve_ask(capability, call, *, sessions=None):
    """Reserve one Ask call on its own ledger: same ceilings, per actor and global."""
    context = current_ai_context()
    if not context.user_id or capability not in ASK_CAPABILITIES:
        raise BudgetError("workouts_ai_budget_unavailable")
    amount = ask_upper_bound(call)
    async with (sessions or AsyncSessionLocal)() as db:
        member = await membership_for(db, context.user_id, write=True)
        if not member.profile.get("ai_consent"):
            raise BudgetError("workouts_ai_budget_unavailable")
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
        total, owner_total, owner_count = await spent(db, context.user_id, BabyAIAdmission.capability.in_(ASK_CAPABILITIES))
        if (
            total + amount > GLOBAL_DAILY_CAP
            or owner_total + amount > OWNER_DAILY_CAP
            or owner_count >= ASK_MAX_ATTEMPTS
        ):
            raise BudgetError("workouts_ai_budget_exceeded")
        db.add(
            BabyAIAdmission(
                app_user_id=context.user_id,
                generation=member.generation,
                capability=capability,
                reserved_microusd=amount,
                created_at=now(),
            )
        )
        await db.commit()

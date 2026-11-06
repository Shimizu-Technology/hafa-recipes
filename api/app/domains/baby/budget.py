"""Content-free durable paid admission; no provider retry can evade the ceiling."""

from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal
from typing import NamedTuple
from uuid import uuid4

from sqlalchemy import func, select, text, update
from sqlalchemy.exc import SQLAlchemyError

from app.ai_governance import current_ai_context, extract_token_usage
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.baby.ask_gate import ask_v2_allowed
from app.domains.baby.lifecycle import membership_for, now
from app.domains.baby.models import BabyAIAdmission
from app.domains.workouts.budget import (
    AUTHORIZED_CAP_MICROUSD,
    STANDARD_TOKEN_PRICES,
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
CACHED_INPUT_FLOORS = {"gpt-5.6-luna": Decimal("0.02"), "gpt-5.6-terra": Decimal("0.20"),
                       "gpt-6-luna": Decimal("0.01"), "gpt-6.1-terra": Decimal("0.05"), "gpt-6-astra": Decimal("1.00")}
# Priced so an evaluation can state its cost. It has no adapter or consent text in production.
EVAL_ONLY_MODELS = frozenset({"claude-haiku-5-5"})
ASK_CAPABILITIES = ("baby_ask", "baby_research", "baby_safety")
# Dollars are one ceiling across every Baby capability. Attempts are counted apart, since an Ask
# question is several small calls and shouldn't use up the attempts imports count on.
ASK_MAX_ATTEMPTS = 400  # 50 questions a day, each up to 5 tool rounds, a final answer and 2 safety checks.
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


def ask_upper_bound(call, *, evaluating=False):
    if call.model not in BABY_MODEL_PRICES or (call.model in EVAL_ONLY_MODELS and not evaluating):
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
    configured = get_settings().ai_model_pricing.get(call.model, {})
    input_rate = max(price.input, Decimal(str(configured.get("input_per_million", 0))),
                     Decimal(str(configured.get("cached_input_per_million", 0))))
    write_rate = max(price.cache_write, input_rate * Decimal("1.25"))
    output_rate = max(price.output, Decimal(str(configured.get("output_per_million", 0))))
    long = tokens > LONG_CONTEXT_TOKENS
    tokens_cost = (tokens * write_rate * (2 if long else 1)
                   + call.max_output_tokens * output_rate * (Decimal("1.5") if long else 1))
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


def upper_bound(capability, model, *, images=False, duration=None, max_output_tokens=LEGACY_MAX_OUTPUT,
                input_bytes=None, image_count=0):
    if capability != "baby_transcription" and input_bytes is not None:
        if model not in STANDARD_TOKEN_PRICES:
            raise BudgetError("workouts_ai_model_unpriced")
        if (type(input_bytes) is not int or input_bytes < 0 or type(image_count) is not int
                or not 0 <= image_count <= 35 or type(max_output_tokens) is not int
                or not 1 <= max_output_tokens <= 16000):
            raise BudgetError("workouts_ai_envelope_unsupported")
        # Official images-vision high-detail sizing: <=2500 patches * 1.2,
        # plus one rounding token. Base64 is transport, not text input tokens.
        # Only the explicitly priced GPT-5.6 adapters use this envelope.
        tokens = input_bytes + FRAMING_TOKENS + image_count * 3001
        if tokens > 1_050_000:
            raise BudgetError("workouts_ai_envelope_unsupported")
        configured = get_settings().ai_model_pricing.get(model, {})
        floor_input, floor_output = STANDARD_TOKEN_PRICES[model]
        input_rate = max(floor_input, Decimal(str(configured.get("input_per_million", 0))),
                         Decimal(str(configured.get("cached_input_per_million", 0))))
        output_rate = max(floor_output, Decimal(str(configured.get("output_per_million", 0))))
        # Keep the existing long-context/cache-write headroom and price floors.
        return int((tokens * input_rate * Decimal("2.5")
                    + max_output_tokens * output_rate * Decimal("1.5")).to_integral_value(rounding=ROUND_CEILING))
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
            max_output_tokens=max_output_tokens,
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


@dataclass(frozen=True)
class Reservation:
    id: object
    owner: str
    amount: int
    model: str


async def settle(reservation, response, *, extra_cost=0, sessions=None):
    """Release unused reservation only for validated, metered usage.

    Unknown usage, a cancelled request or a failed settlement keeps the whole
    reservation. The same global lock serializes settlement with admissions.
    """
    if not isinstance(reservation, Reservation) or response is None:
        return
    usage = extract_token_usage(response)
    incoming, outgoing = usage["input_tokens"], usage["output_tokens"]
    cached = usage["cached_input_tokens"] if usage["cached_input_tokens"] is not None else 0
    if (any(type(n) is not int or n < 0 for n in (incoming, outgoing, cached, extra_cost))
            or cached > incoming):
        return
    def value(item, key, default=None):
        return item.get(key, default) if isinstance(item, dict) else getattr(item, key, default)
    raw_usage = value(response, "usage")
    details = value(raw_usage, "prompt_tokens_details") or value(raw_usage, "input_tokens_details")
    written = value(details, "cache_write_tokens")
    # Older providers omit this breakdown. Price the unknown portion at the
    # maximum supported default (30m) write rate rather than release it as free.
    written = incoming - cached if written is None else written
    if type(written) is not int or not 0 <= written <= incoming - cached:
        return
    write_details = value(details, "cache_write_tokens_details")
    long_writes = value(write_details, "ttl_12h_tokens", 0)
    if type(long_writes) is not int or not 0 <= long_writes <= written:
        return
    prices = get_settings().ai_model_pricing.get(reservation.model)
    if not prices or reservation.model not in CACHED_INPUT_FLOORS:
        return
    if reservation.model in STANDARD_TOKEN_PRICES:
        input_floor, output_floor = STANDARD_TOKEN_PRICES[reservation.model]
    else:
        input_floor, _, output_floor = BABY_MODEL_PRICES[reservation.model]
    input_rate = max(input_floor, Decimal(str(prices["input_per_million"])))
    cache_rate = max(CACHED_INPUT_FLOORS[reservation.model], Decimal(str(prices.get("cached_input_per_million", prices["input_per_million"]))))
    output_rate = max(output_floor, Decimal(str(prices["output_per_million"])))
    if incoming > LONG_CONTEXT_TOKENS:
        input_rate, cache_rate, output_rate = input_rate * 2, cache_rate * 2, output_rate * Decimal("1.5")
    amount = max(1, int(((incoming - cached - written) * input_rate
                        + cached * cache_rate
                        + (written - long_writes) * input_rate * Decimal("1.25")
                        + long_writes * input_rate * Decimal("2.5")
                        + outgoing * output_rate
                        + extra_cost).to_integral_value(rounding=ROUND_CEILING)))
    try:
        async with (sessions or AsyncSessionLocal)() as db:
            await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
            await db.execute(update(BabyAIAdmission).where(
                BabyAIAdmission.id == reservation.id,
                BabyAIAdmission.app_user_id == reservation.owner,
                BabyAIAdmission.reserved_microusd == reservation.amount,
            ).values(reserved_microusd=amount))
            await db.commit()
    except (SQLAlchemyError, OSError, TimeoutError):
        pass  # The original reservation remains; keep the completed result.
    if amount > reservation.amount:
        raise BudgetError("workouts_ai_usage_invalid")


async def reserve(capability, model, *, images=False, duration=None, max_output_tokens=LEGACY_MAX_OUTPUT,
                  input_bytes=None, image_count=0, sessions=None):
    context = current_ai_context()
    if not context.user_id:
        raise BudgetError("workouts_ai_budget_unavailable")
    amount = upper_bound(capability, model, images=images, duration=duration, max_output_tokens=max_output_tokens,
                         input_bytes=input_bytes, image_count=image_count)
    reservation = Reservation(uuid4(), context.user_id, amount, model)
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
                id=reservation.id,
                app_user_id=context.user_id,
                generation=member.generation,
                capability=capability,
                reserved_microusd=amount,
                created_at=now(),
            )
        )
        await db.commit()
    return reservation


async def reserve_ask(capability, call, *, sessions=None, consent_only=False):
    """Reserve one Ask call on its own ledger: same ceilings, per actor and global.

    consent_only is the old path's question check. It goes to the provider her AI permission already covers, so it needs no flag.
    """
    context = current_ai_context()
    if not context.user_id or capability not in ASK_CAPABILITIES:
        raise BudgetError("workouts_ai_budget_unavailable")
    amount = ask_upper_bound(call)
    reservation = Reservation(uuid4(), context.user_id, amount, call.model)
    async with (sessions or AsyncSessionLocal)() as db:
        member = await membership_for(db, context.user_id, write=True)
        old_path_check = consent_only and capability == "baby_safety" and member.profile.get("ai_consent")
        if not old_path_check and not ask_v2_allowed(member.profile):
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
                id=reservation.id,
                app_user_id=context.user_id,
                generation=member.generation,
                capability=capability,
                reserved_microusd=amount,
                created_at=now(),
            )
        )
        await db.commit()
    return reservation

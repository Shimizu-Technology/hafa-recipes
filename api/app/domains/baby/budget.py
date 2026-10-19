"""Content-free durable paid admission; no provider retry can evade the ceiling."""

from datetime import timedelta

from sqlalchemy import func, select, text

from app.ai_governance import current_ai_context
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.baby.lifecycle import membership_for, now
from app.domains.baby.models import BabyAIAdmission
from app.domains.workouts.budget import (
    BudgetError,
    BudgetPolicy,
    ProviderEnvelope,
    admission_upper_bound,
)

GLOBAL_DAILY_CAP = 5_000_000
OWNER_DAILY_CAP = 3_000_000
MAX_ATTEMPTS = 100
LOCK_ID = 7340052


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
            max_output_tokens=2400,
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
            budget_24h_microusd=GLOBAL_DAILY_CAP,
            model_pricing=get_settings().ai_model_pricing,
        ),
    )


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
        window = BabyAIAdmission.created_at > now() - timedelta(days=1)
        total = await db.scalar(
            select(func.coalesce(func.sum(BabyAIAdmission.reserved_microusd), 0)).where(window)
        )
        owner_total, owner_count = (
            await db.execute(
                select(
                    func.coalesce(func.sum(BabyAIAdmission.reserved_microusd), 0), func.count()
                ).where(window, BabyAIAdmission.app_user_id == context.user_id)
            )
        ).one()
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

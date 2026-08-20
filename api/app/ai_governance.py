"""Model rollout, privacy-bounded provenance, and AI usage accounting."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Any, Iterator
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.public_identity import public_contributor_id

logger = logging.getLogger("hafa.ai")

PROMPT_VERSIONS = {
    "recipe_extraction": "recipe-extraction-v1",
    "ocr": "recipe-ocr-v1",
    "recipe_chat": "recipe-chat-safety-v2",
    "cooking_chat": "cooking-chat-safety-v2",
    "enrichment_tags": "recipe-tags-v1",
    "enrichment_nutrition": "recipe-nutrition-v1",
    "enrichment": "recipe-enrichment-v1",
    "transcription": "audio-transcription-v1",
    "tts": "cook-mode-tts-v1",
}
RECIPE_SCHEMA_VERSION = "recipe-components-v1"


@dataclass(frozen=True)
class AIRequestContext:
    request_id: str
    user_id: str | None = None
    job_id: str | None = None
    route: str | None = None


@dataclass(frozen=True)
class ModelSelection:
    model: str
    variant: str
    rollout_percentage: int


_context: ContextVar[AIRequestContext | None] = ContextVar(
    "ai_request_context",
    default=None,
)


def current_ai_context() -> AIRequestContext:
    return _context.get() or AIRequestContext(request_id=uuid4().hex)


@contextmanager
def ai_request_context(
    *,
    request_id: str | None = None,
    user_id: str | None = None,
    job_id: str | None = None,
    route: str | None = None,
) -> Iterator[AIRequestContext]:
    """Add safe request/job identity to all nested AI calls."""

    existing = current_ai_context()
    merged = replace(
        existing,
        request_id=request_id or existing.request_id,
        user_id=user_id if user_id is not None else existing.user_id,
        job_id=job_id if job_id is not None else existing.job_id,
        route=route if route is not None else existing.route,
    )
    token = _context.set(merged)
    try:
        yield merged
    finally:
        _context.reset(token)


def select_ai_model(capability: str, primary_model: str) -> ModelSelection:
    """Deterministically route a configured percentage to a capability canary."""

    settings = get_settings()
    canary_model = settings.ai_canary_models.get(capability, "").strip()
    percentage = settings.ai_canary_percentages.get(capability, 0)
    if not canary_model or percentage <= 0:
        return ModelSelection(primary_model, "primary", 0)

    context = current_ai_context()
    stable_seed = context.job_id or context.request_id
    digest = hashlib.sha256(f"{capability}:{stable_seed}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    if bucket < percentage:
        return ModelSelection(canary_model, "canary", percentage)
    return ModelSelection(primary_model, "primary", percentage)


def _value(value: Any, key: str) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def extract_token_usage(response: Any) -> dict[str, int | None]:
    """Normalize Chat Completions SDK or HTTP usage without response content."""

    usage = _value(response, "usage")
    prompt_details = _value(usage, "prompt_tokens_details")
    completion_details = _value(usage, "completion_tokens_details")
    return {
        "input_tokens": _value(usage, "prompt_tokens"),
        "cached_input_tokens": _value(prompt_details, "cached_tokens"),
        "output_tokens": _value(usage, "completion_tokens"),
        "reasoning_tokens": _value(completion_details, "reasoning_tokens"),
    }


def estimate_cost_microusd(
    model: str,
    *,
    input_tokens: int | None,
    cached_input_tokens: int | None,
    output_tokens: int | None,
) -> int | None:
    """Estimate cost from explicit configuration; unknown models stay unknown."""

    settings = get_settings()
    prices = settings.ai_model_pricing.get(model)
    if not prices or input_tokens is None or output_tokens is None:
        return None
    cached = min(cached_input_tokens or 0, input_tokens)
    uncached = input_tokens - cached
    input_cost = uncached * prices["input_per_million"]
    cached_cost = cached * prices.get(
        "cached_input_per_million",
        prices["input_per_million"],
    )
    output_cost = output_tokens * prices["output_per_million"]
    return round(input_cost + cached_cost + output_cost)


def _safe_job_id(value: str | None) -> UUID | None:
    try:
        return UUID(value) if value else None
    except ValueError:
        return None


async def record_ai_invocation(
    *,
    capability: str,
    model: str,
    prompt_version: str,
    schema_version: str | None,
    rollout_variant: str,
    fallback_reason: str | None,
    status: str,
    error_code: str | None,
    latency_ms: int,
    response: Any = None,
) -> None:
    """Persist and log only allowlisted operational metadata."""

    from app.db import AsyncSessionLocal
    from app.models.ai import AIInvocation

    context = current_ai_context()
    usage = extract_token_usage(response)
    cost = estimate_cost_microusd(
        model,
        **{
            "input_tokens": usage["input_tokens"],
            "cached_input_tokens": usage["cached_input_tokens"],
            "output_tokens": usage["output_tokens"],
        },
    )
    provider_request_id = _value(response, "id")
    record = AIInvocation(
        request_id=context.request_id,
        user_id=context.user_id,
        job_id=_safe_job_id(context.job_id),
        capability=capability,
        provider="openai",
        model=model,
        prompt_version=prompt_version,
        schema_version=schema_version,
        rollout_variant=rollout_variant,
        fallback_reason=fallback_reason,
        status=status,
        error_code=error_code,
        provider_request_id=str(provider_request_id)[:128] if provider_request_id else None,
        latency_ms=max(0, latency_ms),
        estimated_cost_microusd=cost,
        **usage,
    )
    safe_log = {
        "event": "ai_invocation",
        "request_id": context.request_id,
        "user": public_contributor_id(context.user_id),
        "job_id": context.job_id,
        "route": context.route,
        "capability": capability,
        "provider": "openai",
        "model": model,
        "prompt_version": prompt_version,
        "schema_version": schema_version,
        "rollout_variant": rollout_variant,
        "fallback_reason": fallback_reason,
        "status": status,
        "error_code": error_code,
        "latency_ms": max(0, latency_ms),
        **usage,
        "estimated_cost_microusd": cost,
    }
    logger.info(json.dumps(safe_log, separators=(",", ":"), sort_keys=True))
    try:
        async with AsyncSessionLocal() as db:
            db.add(record)
            await db.commit()
    except Exception as exc:
        logger.warning(
            json.dumps(
                {
                    "event": "ai_provenance_write_failed",
                    "request_id": context.request_id,
                    "error_code": type(exc).__name__,
                },
                separators=(",", ":"),
                sort_keys=True,
            )
        )


class AIInvocationTracker:
    """Record exactly one provider attempt after the caller validates its result."""

    def __init__(
        self,
        *,
        capability: str,
        primary_model: str,
        prompt_version: str,
        schema_version: str | None = None,
        fallback_reason: str | None = None,
        allow_canary: bool = True,
        rollout_variant: str | None = None,
    ):
        selection = (
            select_ai_model(capability, primary_model)
            if allow_canary
            else ModelSelection(primary_model, rollout_variant or "fallback", 0)
        )
        self.capability = capability
        self.model = selection.model
        self.rollout_variant = rollout_variant or selection.variant
        self.prompt_version = prompt_version
        self.schema_version = schema_version
        self.fallback_reason = fallback_reason
        self.status = "provider_error"
        self.error_code: str | None = "unclassified_provider_error"
        self.response: Any = None
        self._started = 0.0

    async def __aenter__(self) -> "AIInvocationTracker":
        self._started = time.perf_counter()
        return self

    def succeed(self, response: Any = None) -> None:
        self.response = response
        self.status = "success"
        self.error_code = None

    def fail(self, error_code: str, response: Any = None) -> None:
        self.response = response
        self.status = "failed"
        self.error_code = error_code[:64]

    def outcome(self, status: str, error_code: str | None, response: Any = None) -> None:
        self.response = response
        self.status = status[:32]
        self.error_code = error_code[:64] if error_code else None

    async def __aexit__(self, exc_type, exc, traceback) -> bool:
        if exc is not None and self.error_code == "unclassified_provider_error":
            self.status = "provider_error"
            self.error_code = type(exc).__name__[:64]
        latency_ms = round((time.perf_counter() - self._started) * 1000)
        await record_ai_invocation(
            capability=self.capability,
            model=self.model,
            prompt_version=self.prompt_version,
            schema_version=self.schema_version,
            rollout_variant=self.rollout_variant,
            fallback_reason=self.fallback_reason,
            status=self.status,
            error_code=self.error_code,
            latency_ms=latency_ms,
            response=self.response,
        )
        return False


async def ai_usage_metrics(db: AsyncSession) -> dict[str, int]:
    """Return an admin-safe 24-hour usage summary."""

    row = (
        (
            await db.execute(
                text("""
            SELECT
                COUNT(*)::bigint AS attempts,
                COUNT(*) FILTER (WHERE status IN ('success', 'repaired'))::bigint AS successes,
                COUNT(*) FILTER (WHERE status = 'repaired')::bigint AS repaired,
                COUNT(*) FILTER (WHERE status NOT IN ('success', 'repaired'))::bigint AS failures,
                COUNT(*) FILTER (WHERE rollout_variant = 'fallback')::bigint AS fallbacks,
                COUNT(*) FILTER (WHERE estimated_cost_microusd IS NULL)::bigint AS unknown_costs,
                COALESCE(SUM(estimated_cost_microusd), 0)::bigint AS estimated_cost_microusd
            FROM ai_invocations
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        """)
            )
        )
        .mappings()
        .one()
    )
    return {key: int(value or 0) for key, value in row.items()}


async def verify_ai_governance_schema(session_factory=None) -> None:
    """Fail startup if migration 021 did not install the provenance boundary."""

    if session_factory is None:
        from app.db import AsyncSessionLocal

        session_factory = AsyncSessionLocal
    async with session_factory() as db:
        ready = await db.scalar(
            text("""
            SELECT
                EXISTS (SELECT 1 FROM schema_migrations WHERE version = 21)
                AND to_regclass('public.ai_invocations') IS NOT NULL
                AND (
                    SELECT COUNT(*) = 21
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'ai_invocations'
                      AND column_name = ANY (ARRAY[
                          'id', 'request_id', 'user_id', 'job_id', 'capability',
                          'provider', 'model', 'prompt_version', 'schema_version',
                          'rollout_variant', 'fallback_reason', 'status',
                          'error_code', 'provider_request_id', 'latency_ms',
                          'input_tokens', 'cached_input_tokens', 'output_tokens',
                          'reasoning_tokens', 'estimated_cost_microusd', 'created_at'
                      ])
                )
                AND EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[1]
                    WHERE c.conrelid = to_regclass('public.ai_invocations')
                      AND c.contype = 'p'
                      AND cardinality(c.conkey) = 1
                      AND a.attname = 'id'
                )
                AND EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[1]
                    WHERE c.conrelid = to_regclass('public.ai_invocations')
                      AND c.contype = 'f'
                      AND cardinality(c.conkey) = 1
                      AND a.attname = 'user_id'
                      AND c.confrelid = to_regclass('public.app_users')
                      AND c.confdeltype = 'c'
                      AND c.convalidated
                )
                AND EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[1]
                    WHERE c.conrelid = to_regclass('public.ai_invocations')
                      AND c.contype = 'f'
                      AND cardinality(c.conkey) = 1
                      AND a.attname = 'job_id'
                      AND c.confrelid = to_regclass('public.extraction_jobs')
                      AND c.confdeltype = 'n'
                      AND c.convalidated
                )
        """)
        )
        if not ready:
            raise RuntimeError("Database migration 021 is missing or incomplete")

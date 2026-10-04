"""Dry-run-first, resumable nutrition repair; never re-extract or change ownership."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
from copy import deepcopy
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine as default_engine
from app.services.nutrition import (
    NUTRITION_VERSION,
    enrich_nutrition,
    has_complete_nutrition,
    ingredients_for_nutrition,
)

LOCK_NAME = "hafa:nutrition-backfill:v2"
_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")


class NutritionBackfillBlocked(RuntimeError):
    pass


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False
        ).encode()
    ).hexdigest()


def state_fingerprint(row: Any) -> str:
    """Protect all content and ownership, including concurrent nutrition-only edits."""
    return digest(
        {
            "extracted": row["extracted"],
            "revision": row["content_revision"],
            "owner": row["user_id"],
        }
    )


def database_fingerprint(engine) -> str:
    url = engine.url
    return digest({"host": url.host, "port": url.port, "database": url.database})


def validate_scope(batch_size: int, max_attempts: int) -> None:
    if not 1 <= batch_size <= 100 or not 1 <= max_attempts <= 5:
        raise NutritionBackfillBlocked("Use batch-size 1..100 and max-attempts 1..5")


async def build_plan(
    engine, *, after_recipe_id: UUID | None, batch_size: int, release_id: str
) -> dict:
    async with engine.connect() as connection:
        rows = (
            (
                await connection.execute(
                    text("""
            SELECT id, extracted, content_revision, user_id FROM recipes
            WHERE (CAST(:after_id AS UUID) IS NULL OR id > CAST(:after_id AS UUID))
            ORDER BY id LIMIT :batch_size
        """),
                    {
                        "after_id": str(after_recipe_id) if after_recipe_id else None,
                        "batch_size": batch_size,
                    },
                )
            )
            .mappings()
            .all()
        )
    ineligible: dict[str, int] = {}
    eligible = []
    for row in rows:
        extracted = row["extracted"] or {}
        if has_complete_nutrition(extracted):
            continue
        reason = (
            "incomplete_recipe"
            if extracted.get("sourceIncomplete") is True
            else ("missing_ingredients" if not ingredients_for_nutrition(extracted) else None)
        )
        if reason:
            ineligible[reason] = ineligible.get(reason, 0) + 1
        else:
            eligible.append(row)
    items = [
        {
            "recipe_id": str(row["id"]),
            "content_revision": row["content_revision"],
            "state_fingerprint": state_fingerprint(row),
        }
        for row in eligible
    ]
    plan = {
        "after_recipe_id": str(after_recipe_id) if after_recipe_id else None,
        "batch_size": batch_size,
        "scanned_rows": len(rows),
        "planned_items": items,
        "ineligible": ineligible,
        "database_fingerprint": database_fingerprint(engine),
        "release_id": release_id,
        "version": NUTRITION_VERSION,
        "model": get_settings().enrichment_model,
        "next_after_recipe_id": str(rows[-1]["id"]) if rows else None,
    }
    return plan


def summary(plan: dict, *, apply: bool, **extra) -> dict:
    return {
        "apply": apply,
        "scanned_rows": plan["scanned_rows"],
        "planned_items": len(plan["planned_items"]),
        "next_after_recipe_id": plan["next_after_recipe_id"],
        "database_fingerprint": plan["database_fingerprint"],
        "release_id": plan["release_id"],
        "model": plan["model"],
        "version": plan["version"],
        "plan_digest": digest(plan),
        "ineligible": plan.get("ineligible", {}),
        **extra,
    }


async def _event(
    connection,
    run_id: str,
    recipe_id: str,
    attempt: int,
    outcome: str,
    *,
    failure_code: str | None = None,
    result_digest: str | None = None,
) -> None:
    await connection.execute(
        text("""
        INSERT INTO nutrition_backfill_events(id,backfill_id,recipe_id,attempt,outcome,failure_code,result_digest)
        VALUES (:id,:run,CAST(:recipe AS UUID),:attempt,:outcome,:code,:digest)
    """),
        {
            "id": uuid4(),
            "run": run_id,
            "recipe": recipe_id,
            "attempt": attempt,
            "outcome": outcome,
            "code": failure_code,
            "digest": result_digest,
        },
    )


async def run_backfill(
    *,
    engine=None,
    apply: bool = False,
    after_recipe_id: UUID | None = None,
    batch_size: int = 10,
    max_attempts: int = 3,
    backfill_id: str | None = None,
    restore_point: str | None = None,
    expected_plan_digest: str | None = None,
    expected_database_fingerprint: str | None = None,
    expected_rows: int | None = None,
    expected_release_id: str | None = None,
    release_id: str | None = None,
    max_estimates: int | None = None,
    calculator=enrich_nutrition,
) -> dict:
    """Apply a pinned plan once; retry failed items and stop on concurrent changes."""
    engine = engine or default_engine
    validate_scope(batch_size, max_attempts)
    release_id = (
        release_id
        or os.environ.get("APP_RELEASE_ID")
        or os.environ.get("RENDER_GIT_COMMIT")
        or "local-development"
    )
    if not apply:
        plan = await build_plan(
            engine, after_recipe_id=after_recipe_id, batch_size=batch_size, release_id=release_id
        )
        return summary(
            plan, apply=False, status="would_apply" if plan["planned_items"] else "unchanged"
        )
    if not backfill_id or len(backfill_id) > 96 or not _LABEL.fullmatch(backfill_id):
        raise NutritionBackfillBlocked("Apply requires a safe --backfill-id")
    if not restore_point or not _LABEL.fullmatch(restore_point):
        raise NutritionBackfillBlocked("Apply requires --restore-point naming a verified backup")
    if (
        not expected_plan_digest
        or not expected_database_fingerprint
        or expected_rows is None
        or not expected_release_id
    ):
        raise NutritionBackfillBlocked(
            "Apply requires the exact dry-run plan, database, row count and release expectations"
        )
    if expected_release_id != release_id or (
        get_settings().environment == "production" and release_id == "local-development"
    ):
        raise NutritionBackfillBlocked("Runtime release differs from the approved plan")
    if expected_database_fingerprint != database_fingerprint(engine):
        raise NutritionBackfillBlocked("Database differs from the approved plan")
    if max_estimates is None or not 1 <= max_estimates <= 100:
        raise NutritionBackfillBlocked(
            "Apply requires a bounded --max-estimates 1..100 provider-call budget"
        )
    # One session-level lock prevents simultaneous repair runs and billable duplicate work.
    async with engine.connect() as lock:
        acquired = await lock.scalar(
            text("SELECT pg_try_advisory_lock(hashtext(:name))"), {"name": LOCK_NAME}
        )
        await lock.commit()
        if not acquired:
            raise NutritionBackfillBlocked("Another nutrition repair is running")
        try:
            async with engine.begin() as connection:
                existing = (
                    (
                        await connection.execute(
                            text("SELECT * FROM nutrition_backfill_runs WHERE backfill_id=:run"),
                            {"run": backfill_id},
                        )
                    )
                    .mappings()
                    .first()
                )
            if existing:
                plan = existing["plan"]
                if (
                    existing["restore_point"] != restore_point
                    or existing["plan_digest"] != expected_plan_digest
                ):
                    raise NutritionBackfillBlocked("Resume arguments differ from the immutable run")
                if (
                    plan["release_id"] != release_id
                    or plan["version"] != NUTRITION_VERSION
                    or plan["model"] != get_settings().enrichment_model
                    or plan["database_fingerprint"] != expected_database_fingerprint
                    or plan["after_recipe_id"]
                    != (str(after_recipe_id) if after_recipe_id else None)
                    or plan["batch_size"] != batch_size
                    or plan["scanned_rows"] != expected_rows
                ):
                    raise NutritionBackfillBlocked(
                        "Resume scope or runtime differs from the immutable plan"
                    )
            else:
                plan = await build_plan(
                    engine,
                    after_recipe_id=after_recipe_id,
                    batch_size=batch_size,
                    release_id=release_id,
                )
                if digest(plan) != expected_plan_digest or plan["scanned_rows"] != expected_rows:
                    raise NutritionBackfillBlocked(
                        "Recipes changed since dry run; inspect a new plan"
                    )
                async with engine.begin() as connection:
                    await connection.execute(
                        text("""
                        INSERT INTO nutrition_backfill_runs(backfill_id,restore_point,database_fingerprint,release_id,plan_digest,plan)
                        VALUES (:run,:restore,:database,:release,:digest,CAST(:plan AS JSONB))
                    """),
                        {
                            "run": backfill_id,
                            "restore": restore_point,
                            "database": expected_database_fingerprint,
                            "release": release_id,
                            "digest": expected_plan_digest,
                            "plan": json.dumps(plan),
                        },
                    )
            processed: dict[str, int] = {}
            calls = 0
            status = "completed"
            for item in plan["planned_items"]:
                recipe_id = item["recipe_id"]
                async with engine.begin() as connection:
                    events = (
                        (
                            await connection.execute(
                                text("""
                        SELECT attempt,outcome FROM nutrition_backfill_events WHERE backfill_id=:run AND recipe_id=CAST(:recipe AS UUID)
                        ORDER BY attempt, created_at
                    """),
                                {"run": backfill_id, "recipe": recipe_id},
                            )
                        )
                        .mappings()
                        .all()
                    )
                    if any(event["outcome"] in ("succeeded", "not_found") for event in events):
                        processed["already_terminal"] = processed.get("already_terminal", 0) + 1
                        continue
                    if any(event["outcome"] == "conflict" for event in events):
                        status = "blocked_conflict"
                        break
                    attempt = max([event["attempt"] for event in events] or [0]) + 1
                    if attempt > max_attempts:
                        processed["attempt_limit"] = processed.get("attempt_limit", 0) + 1
                        status = "attempt_limit"
                        continue
                    if calls >= max_estimates:
                        status = "budget_limited"
                        break
                    row = (
                        (
                            await connection.execute(
                                text(
                                    "SELECT id,extracted,content_revision,user_id FROM recipes WHERE id=CAST(:id AS UUID)"
                                ),
                                {"id": recipe_id},
                            )
                        )
                        .mappings()
                        .first()
                    )
                    if row is None:
                        await _event(connection, backfill_id, recipe_id, attempt, "not_found")
                        processed["not_found"] = processed.get("not_found", 0) + 1
                        continue
                    if state_fingerprint(row) != item["state_fingerprint"]:
                        await _event(connection, backfill_id, recipe_id, attempt, "conflict")
                        status = "blocked_conflict"
                        break
                    await _event(connection, backfill_id, recipe_id, attempt, "started")
                    snapshot = deepcopy(row["extracted"] or {})
                    owner_id = row["user_id"]
                calls += 1
                updated = await calculator(
                    snapshot,
                    user_id=owner_id,
                    pinned_model=plan["model"],
                    allow_canary=False,
                    preserve_source=(
                        (snapshot.get("derivedData") or {}).get("nutrition") or {}
                    ).get("status")
                    != "stale",
                )
                metadata = updated["derivedData"]["nutrition"]
                if metadata.get("errorCode") == "model_changed" or (
                    metadata["status"] == "current" and metadata.get("model") != plan["model"]
                ):
                    async with engine.begin() as connection:
                        await _event(
                            connection,
                            backfill_id,
                            recipe_id,
                            attempt,
                            "failed",
                            failure_code="model_changed",
                        )
                    status = "blocked_model"
                    break
                if metadata["status"] != "current" or not has_complete_nutrition(updated):
                    async with engine.begin() as connection:
                        await _event(
                            connection,
                            backfill_id,
                            recipe_id,
                            attempt,
                            "failed",
                            failure_code=metadata.get("errorCode") or "unavailable",
                        )
                    processed["failed"] = processed.get("failed", 0) + 1
                    status = "retryable_failures"
                    continue
                async with engine.begin() as connection:
                    current = (
                        (
                            await connection.execute(
                                text(
                                    "SELECT id,extracted,content_revision,user_id FROM recipes WHERE id=CAST(:id AS UUID) FOR UPDATE"
                                ),
                                {"id": recipe_id},
                            )
                        )
                        .mappings()
                        .first()
                    )
                    if current is None:
                        await _event(connection, backfill_id, recipe_id, attempt, "not_found")
                        continue
                    if state_fingerprint(current) != item["state_fingerprint"]:
                        await _event(connection, backfill_id, recipe_id, attempt, "conflict")
                        status = "blocked_conflict"
                        break
                    replacement = deepcopy(current["extracted"] or {})
                    replacement["nutrition"] = updated["nutrition"]
                    replacement.setdefault("derivedData", {})["nutrition"] = metadata
                    await connection.execute(
                        text(
                            "UPDATE recipes SET extracted=CAST(:extracted AS JSONB) WHERE id=CAST(:id AS UUID)"
                        ),
                        {"id": recipe_id, "extracted": json.dumps(replacement, allow_nan=False)},
                    )
                    await _event(
                        connection,
                        backfill_id,
                        recipe_id,
                        attempt,
                        "succeeded",
                        result_digest=digest(replacement["nutrition"]),
                    )
                    processed["succeeded"] = processed.get("succeeded", 0) + 1
            return summary(
                plan,
                apply=True,
                backfill_id=backfill_id,
                status=status,
                processed=processed,
                provider_calls=calls,
            )
        finally:
            await lock.execute(
                text("SELECT pg_advisory_unlock(hashtext(:name))"), {"name": LOCK_NAME}
            )
            await lock.commit()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect or repair missing recipe nutrition in bounded batches"
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--after-recipe-id", type=UUID)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--max-attempts", type=int, default=3)
    for option in (
        "backfill-id",
        "restore-point",
        "expected-plan-digest",
        "expected-database-fingerprint",
        "expected-release-id",
    ):
        parser.add_argument("--" + option)
    parser.add_argument("--expected-rows", type=int)
    parser.add_argument("--max-estimates", type=int)
    return parser


async def _main() -> None:
    try:
        print(json.dumps(await run_backfill(**vars(_build_parser().parse_args())), sort_keys=True))
    finally:
        await default_engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())

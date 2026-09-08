"""Dry-run-first, resumable repair for legacy recipe thumbnails.

The command never deletes legacy objects. Apply mode persists an immutable plan,
records append-only outcomes, and swaps a recipe URL only while its planned URL
and content revision still match.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID, uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.db.database import engine
from app.image_validation import ImageValidationError, ValidatedImage
from app.media_lifecycle import recipe_media_lock_key
from app.services.storage import (
    storage_service,
)

BACKFILL_LOCK_NAME = "hafa:legacy-thumbnail-backfill:v1"
MAX_BATCH_SIZE = 100
MAX_ATTEMPTS = 10
_SAFE_BACKFILL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
_SAFE_OPERATOR_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,159}$")
_TERMINAL_OUTCOMES = frozenset({"succeeded", "conflict", "not_found", "source_changed"})


class ThumbnailBackfillBlocked(RuntimeError):
    """Raised when a backfill cannot prove that the requested plan is safe."""


class ThumbnailStorage(Protocol):
    """Storage operations required by the repair workflow."""

    @property
    def is_enabled(self) -> bool: ...

    def thumbnail_origin(self, image_url: str) -> str: ...

    def is_owned_versioned_thumbnail_url(
        self,
        image_url: str | None,
        recipe_id: str | UUID,
    ) -> bool: ...

    def thumbnail_backfill_contract(self) -> dict[str, str]: ...

    async def fetch_thumbnail_source(
        self,
        image_url: str,
        recipe_id: str | UUID,
    ) -> ValidatedImage: ...

    async def prepare_thumbnail_variants(
        self,
        image: ValidatedImage,
    ) -> dict[str, ValidatedImage]: ...

    async def store_prepared_thumbnail_variants_locked(
        self,
        variants: dict[str, ValidatedImage],
        recipe_id: str | UUID,
    ) -> str: ...


@dataclass(frozen=True)
class RecipeSnapshot:
    """Concurrency-sensitive recipe fields used by one repair plan."""

    recipe_id: UUID
    thumbnail_url: str | None
    content_revision: int
    is_public: bool
    extracted: dict[str, Any]


@dataclass(frozen=True)
class PlanItem:
    """Privacy-minimized plan entry plus its transient source URL."""

    recipe_id: UUID
    content_revision: int
    source_url: str | None
    source_url_hash: str | None
    classification: str
    source_kind: str | None = None
    source_bytes: int | None = None
    source_sha256: str | None = None
    failure_code: str | None = None

    def digest_payload(self) -> dict[str, Any]:
        """Return stable plan facts without exposing the source URL."""
        return {
            "recipe_id": str(self.recipe_id),
            "content_revision": self.content_revision,
            "source_url_hash": self.source_url_hash,
            "classification": self.classification,
            "source_kind": self.source_kind,
            "source_bytes": self.source_bytes,
            "source_sha256": self.source_sha256,
            "failure_code": self.failure_code,
        }


@dataclass(frozen=True)
class BackfillPlan:
    """One bounded, deterministic page of recipe thumbnail inspections."""

    after_recipe_id: UUID | None
    batch_size: int
    destination_fingerprint: str
    transform_version: str
    release_id: str
    items: tuple[PlanItem, ...]

    @property
    def digest(self) -> str:
        """Hash every safe plan fact so apply mode can reject drift."""
        payload = {
            "visibility_scope": "public",
            "destination_fingerprint": self.destination_fingerprint,
            "transform_version": self.transform_version,
            "release_id": self.release_id,
            "items": [item.digest_payload() for item in self.items],
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    @property
    def planned_items(self) -> tuple[PlanItem, ...]:
        """Return legacy rows that need either repair or a visible failure."""
        return tuple(
            item for item in self.items if item.classification in {"eligible", "failed"}
        )

    @property
    def source_bytes(self) -> int:
        """Return the exact bytes successfully inspected for eligible sources."""
        return sum(item.source_bytes or 0 for item in self.items if item.classification == "eligible")

    @property
    def next_after_recipe_id(self) -> str | None:
        """Return the keyset cursor for the next bounded page."""
        return str(self.items[-1].recipe_id) if self.items else None

    def summary(self) -> dict[str, Any]:
        """Return an operator-safe dry-run summary."""
        classifications = Counter(item.classification for item in self.items)
        failures = Counter(
            item.failure_code for item in self.items if item.failure_code is not None
        )
        origins = Counter(
            item.source_kind for item in self.items if item.source_kind is not None
        )
        return {
            "status": "would_apply" if self.planned_items else "unchanged",
            "apply": False,
            "visibility_scope": "public",
            "after_recipe_id": str(self.after_recipe_id) if self.after_recipe_id else None,
            "next_after_recipe_id": self.next_after_recipe_id,
            "batch_size": self.batch_size,
            "scanned_rows": len(self.items),
            "planned_items": len(self.planned_items),
            "expected_source_bytes": self.source_bytes,
            "destination_fingerprint": self.destination_fingerprint,
            "transform_version": self.transform_version,
            "release_id": self.release_id,
            "plan_digest": self.digest,
            "inventory": dict(sorted(classifications.items())),
            "origins": dict(sorted(origins.items())),
            "failures": dict(sorted(failures.items())),
        }


def _url_hash(value: str) -> str:
    """Hash a URL so audit records never retain provider tokens or paths."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _failure_code(error: Exception) -> str:
    """Collapse download/validation failures into bounded, non-sensitive labels."""
    if isinstance(error, ImageValidationError):
        return "invalid_image"
    if isinstance(error, httpx.TimeoutException):
        return "timeout"
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status == 404:
            return "missing_object"
        return "http_4xx" if 400 <= status < 500 else "http_5xx"
    if isinstance(error, ValueError):
        if str(error) == "Thumbnail exceeds maximum size":
            return "oversized"
        return "invalid_source"
    return "unavailable"


def _validate_scope(*, batch_size: int, after_recipe_id: UUID | None) -> None:
    """Validate the bounded keyset scope shared by dry-run and apply."""
    if batch_size < 1 or batch_size > MAX_BATCH_SIZE:
        raise ThumbnailBackfillBlocked(
            f"batch_size must be between 1 and {MAX_BATCH_SIZE}"
        )
    if after_recipe_id is not None:
        UUID(str(after_recipe_id))


async def _load_recipe_batch(
    connection: AsyncConnection,
    *,
    after_recipe_id: UUID | None,
    batch_size: int,
) -> list[RecipeSnapshot]:
    """Load one stable UUID-keyset page without hydrating unrelated columns."""
    rows = (
        await connection.execute(
            text(f"""
                SELECT id, thumbnail_url, content_revision, is_public, extracted
                FROM recipes
                WHERE is_public IS TRUE
                {"AND id > CAST(:after_recipe_id AS UUID)" if after_recipe_id else ""}
                ORDER BY id
                LIMIT :batch_size
            """),
            {
                "after_recipe_id": str(after_recipe_id) if after_recipe_id else None,
                "batch_size": batch_size,
            },
        )
    ).mappings()
    return [
        RecipeSnapshot(
            recipe_id=row["id"],
            thumbnail_url=row["thumbnail_url"],
            content_revision=int(row["content_revision"] or 1),
            is_public=bool(row["is_public"]),
            extracted=row["extracted"] if isinstance(row["extracted"], dict) else {},
        )
        for row in rows
    ]


async def _inspect_recipe(
    snapshot: RecipeSnapshot,
    *,
    storage: ThumbnailStorage,
) -> PlanItem:
    """Classify one row and measure legacy bytes without persisting anything."""
    source_url = snapshot.thumbnail_url
    if not source_url:
        return PlanItem(
            recipe_id=snapshot.recipe_id,
            content_revision=snapshot.content_revision,
            source_url=None,
            source_url_hash=None,
            classification="missing",
        )
    source_url_hash = _url_hash(source_url)
    source_kind = None
    try:
        if storage.is_owned_versioned_thumbnail_url(
            source_url,
            snapshot.recipe_id,
        ):
            return PlanItem(
                recipe_id=snapshot.recipe_id,
                content_revision=snapshot.content_revision,
                source_url=source_url,
                source_url_hash=source_url_hash,
                classification="ready",
                source_kind="app_owned",
            )
        source_kind = storage.thumbnail_origin(source_url)
        source = await storage.fetch_thumbnail_source(
            source_url,
            snapshot.recipe_id,
        )
    except Exception as error:
        return PlanItem(
            recipe_id=snapshot.recipe_id,
            content_revision=snapshot.content_revision,
            source_url=source_url,
            source_url_hash=source_url_hash,
            classification="failed",
            source_kind=source_kind,
            failure_code=_failure_code(error),
        )
    return PlanItem(
        recipe_id=snapshot.recipe_id,
        content_revision=snapshot.content_revision,
        source_url=source_url,
        source_url_hash=source_url_hash,
        classification="eligible",
        source_kind=source_kind,
        source_bytes=len(source.data),
        source_sha256=hashlib.sha256(source.data).hexdigest(),
    )


async def build_backfill_plan(
    *,
    database_engine: AsyncEngine = engine,
    storage: ThumbnailStorage = storage_service,
    after_recipe_id: UUID | None = None,
    batch_size: int = 50,
) -> BackfillPlan:
    """Inspect one bounded page and return a deterministic, read-only plan."""
    _validate_scope(batch_size=batch_size, after_recipe_id=after_recipe_id)
    async with database_engine.connect() as connection:
        snapshots = await _load_recipe_batch(
            connection,
            after_recipe_id=after_recipe_id,
            batch_size=batch_size,
        )
    items = []
    for snapshot in snapshots:
        items.append(await _inspect_recipe(snapshot, storage=storage))
    contract = storage.thumbnail_backfill_contract()
    return BackfillPlan(
        after_recipe_id=after_recipe_id,
        batch_size=batch_size,
        destination_fingerprint=contract["destination_fingerprint"],
        transform_version=contract["transform_version"],
        release_id=contract["release_id"],
        items=tuple(items),
    )


async def _audit_schema_exists(connection: AsyncConnection) -> bool:
    """Return whether an apply-mode run table has already been installed."""
    return bool(
        await connection.scalar(
            text("SELECT to_regclass('public.thumbnail_backfill_runs') IS NOT NULL")
        )
    )


async def _load_run(
    connection: AsyncConnection,
    backfill_id: str,
) -> dict[str, Any] | None:
    """Load one immutable run definition when it already exists."""
    if not await _audit_schema_exists(connection):
        return None
    row = (
        await connection.execute(
            text("""
                SELECT backfill_id, restore_point, after_recipe_id, batch_size,
                       scanned_rows, planned_items, expected_source_bytes,
                       destination_fingerprint, transform_version, release_id,
                       visibility_scope, next_after_recipe_id, plan_digest
                FROM thumbnail_backfill_runs
                WHERE backfill_id = :backfill_id
            """),
            {"backfill_id": backfill_id},
        )
    ).mappings().one_or_none()
    return dict(row) if row else None


def _validate_apply_arguments(
    *,
    backfill_id: str | None,
    restore_point: str | None,
    expected_rows: int | None,
    expected_source_bytes: int | None,
    expected_destination_fingerprint: str | None,
    expected_plan_digest: str | None,
    expected_release_id: str | None,
    max_attempts: int,
) -> None:
    """Require explicit, bounded write intent and expectation locks."""
    if not backfill_id or not _SAFE_BACKFILL_ID.fullmatch(backfill_id):
        raise ThumbnailBackfillBlocked(
            "Apply mode requires a safe --backfill-id of 1 to 96 characters"
        )
    normalized_restore_point = (restore_point or "").strip()
    if not _SAFE_OPERATOR_LABEL.fullmatch(normalized_restore_point):
        raise ThumbnailBackfillBlocked(
            "Apply mode requires a safe --restore-point naming a verified backup"
        )
    if expected_rows is None or expected_rows < 0:
        raise ThumbnailBackfillBlocked("Apply mode requires --expected-rows")
    if expected_source_bytes is None or expected_source_bytes < 0:
        raise ThumbnailBackfillBlocked("Apply mode requires --expected-source-bytes")
    if not expected_destination_fingerprint or not re.fullmatch(
        r"[0-9a-f]{64}", expected_destination_fingerprint
    ):
        raise ThumbnailBackfillBlocked(
            "Apply mode requires --expected-destination-fingerprint"
        )
    if not expected_plan_digest or not re.fullmatch(r"[0-9a-f]{64}", expected_plan_digest):
        raise ThumbnailBackfillBlocked("Apply mode requires --expected-plan-digest")
    if not _SAFE_OPERATOR_LABEL.fullmatch((expected_release_id or "").strip()):
        raise ThumbnailBackfillBlocked(
            "Apply mode requires --expected-release-id from the dry run"
        )
    if max_attempts < 1 or max_attempts > MAX_ATTEMPTS:
        raise ThumbnailBackfillBlocked(
            f"max_attempts must be between 1 and {MAX_ATTEMPTS}"
        )


def _validate_plan_expectations(
    plan: BackfillPlan,
    *,
    expected_rows: int,
    expected_source_bytes: int,
    expected_destination_fingerprint: str,
    expected_plan_digest: str,
) -> None:
    """Stop before writes when a repeated dry run no longer matches."""
    if len(plan.items) != expected_rows:
        raise ThumbnailBackfillBlocked(
            f"Backfill stopped: expected {expected_rows} rows, found {len(plan.items)}"
        )
    if plan.source_bytes != expected_source_bytes:
        raise ThumbnailBackfillBlocked(
            "Backfill stopped: inspected source byte total changed "
            f"(expected {expected_source_bytes}, found {plan.source_bytes})"
        )
    if plan.destination_fingerprint != expected_destination_fingerprint:
        raise ThumbnailBackfillBlocked(
            "Backfill stopped: destination or transform contract changed"
        )
    if plan.digest != expected_plan_digest:
        raise ThumbnailBackfillBlocked("Backfill stopped: plan digest changed")


def _validate_existing_run(
    run: dict[str, Any],
    *,
    restore_point: str,
    after_recipe_id: UUID | None,
    batch_size: int,
    expected_rows: int,
    expected_source_bytes: int,
    expected_destination_fingerprint: str,
    expected_plan_digest: str,
    expected_release_id: str,
) -> None:
    """Require resumed commands to identify the exact immutable run."""
    expected = {
        "restore_point": restore_point.strip(),
        "after_recipe_id": after_recipe_id,
        "batch_size": batch_size,
        "scanned_rows": expected_rows,
        "expected_source_bytes": expected_source_bytes,
        "destination_fingerprint": expected_destination_fingerprint,
        "plan_digest": expected_plan_digest,
        "release_id": expected_release_id.strip(),
        "visibility_scope": "public",
    }
    for key, value in expected.items():
        if run[key] != value:
            raise ThumbnailBackfillBlocked(
                f"Backfill stopped: {key} does not match immutable run {run['backfill_id']}"
            )


async def _persist_plan(
    connection: AsyncConnection,
    *,
    backfill_id: str,
    restore_point: str,
    plan: BackfillPlan,
) -> None:
    """Persist an immutable run and its privacy-minimized legacy items."""
    await connection.execute(
        text("""
            INSERT INTO thumbnail_backfill_runs (
                backfill_id, restore_point, after_recipe_id, batch_size,
                scanned_rows, planned_items, expected_source_bytes,
                destination_fingerprint, transform_version, release_id,
                visibility_scope, next_after_recipe_id, plan_digest
            ) VALUES (
                :backfill_id, :restore_point, :after_recipe_id, :batch_size,
                :scanned_rows, :planned_items, :expected_source_bytes,
                :destination_fingerprint, :transform_version, :release_id,
                :visibility_scope, :next_after_recipe_id, :plan_digest
            )
        """),
        {
            "backfill_id": backfill_id,
            "restore_point": restore_point.strip(),
            "after_recipe_id": plan.after_recipe_id,
            "batch_size": plan.batch_size,
            "scanned_rows": len(plan.items),
            "planned_items": len(plan.planned_items),
            "expected_source_bytes": plan.source_bytes,
            "destination_fingerprint": plan.destination_fingerprint,
            "transform_version": plan.transform_version,
            "release_id": plan.release_id,
            "visibility_scope": "public",
            "next_after_recipe_id": plan.next_after_recipe_id,
            "plan_digest": plan.digest,
        },
    )
    item_parameters = [
        {
            "backfill_id": backfill_id,
            "recipe_id": item.recipe_id,
            "source_url_hash": item.source_url_hash,
            "source_kind": item.source_kind,
            "source_content_revision": item.content_revision,
            "source_bytes": item.source_bytes,
            "source_sha256": item.source_sha256,
            "preflight_status": item.classification,
            "failure_code": item.failure_code,
        }
        for item in plan.items
    ]
    if item_parameters:
        await connection.execute(
            text("""
                INSERT INTO thumbnail_backfill_items (
                    backfill_id, recipe_id, source_url_hash,
                    source_kind, source_content_revision, source_bytes, source_sha256,
                    preflight_status, failure_code
                ) VALUES (
                    :backfill_id, :recipe_id, :source_url_hash,
                    :source_kind, :source_content_revision, :source_bytes, :source_sha256,
                    :preflight_status, :failure_code
                )
            """),
            item_parameters,
        )


async def _load_run_items(
    connection: AsyncConnection,
    backfill_id: str,
) -> list[dict[str, Any]]:
    """Load planned legacy rows with their latest append-only outcome."""
    rows = (
        await connection.execute(
            text("""
                SELECT item.backfill_id, item.recipe_id, item.source_url_hash,
                       item.source_kind, item.source_content_revision, item.source_bytes,
                       item.source_sha256, item.preflight_status, item.failure_code,
                       latest.attempt, latest.outcome,
                       latest.failure_code AS latest_failure_code
                FROM thumbnail_backfill_items item
                LEFT JOIN LATERAL (
                    SELECT attempt, outcome, failure_code
                    FROM thumbnail_backfill_events event
                    WHERE event.backfill_id = item.backfill_id
                      AND event.recipe_id = item.recipe_id
                    ORDER BY attempt DESC
                    LIMIT 1
                ) latest ON TRUE
                WHERE item.backfill_id = :backfill_id
                  AND item.preflight_status IN ('eligible', 'failed')
                ORDER BY item.recipe_id
            """),
            {"backfill_id": backfill_id},
        )
    ).mappings()
    return [dict(row) for row in rows]


async def _load_current_recipe(
    connection: AsyncConnection,
    recipe_id: UUID,
    *,
    for_update: bool = False,
) -> RecipeSnapshot | None:
    """Load the current repair-sensitive fields, optionally locking the row."""
    lock = "FOR UPDATE" if for_update else ""
    row = (
        await connection.execute(
            text(f"""
                SELECT id, thumbnail_url, content_revision, is_public, extracted
                FROM recipes
                WHERE id = :recipe_id
                {lock}
            """),
            {"recipe_id": recipe_id},
        )
    ).mappings().one_or_none()
    if not row:
        return None
    return RecipeSnapshot(
        recipe_id=row["id"],
        thumbnail_url=row["thumbnail_url"],
        content_revision=int(row["content_revision"] or 1),
        is_public=bool(row["is_public"]),
        extracted=row["extracted"] if isinstance(row["extracted"], dict) else {},
    )


def _matches_plan(
    snapshot: RecipeSnapshot,
    item: dict[str, Any],
    storage: ThumbnailStorage,
) -> bool:
    """Return whether a live row still matches the privacy-minimized plan."""
    return bool(
        snapshot.thumbnail_url
        and _url_hash(snapshot.thumbnail_url) == item["source_url_hash"]
        and snapshot.content_revision == item["source_content_revision"]
        and snapshot.is_public
        and not storage.is_owned_versioned_thumbnail_url(
            snapshot.thumbnail_url,
            snapshot.recipe_id,
        )
    )


async def _record_event(
    connection: AsyncConnection,
    *,
    item: dict[str, Any],
    outcome: str,
    failure_code: str | None = None,
    source_bytes: int | None = None,
    list_bytes: int | None = None,
    hero_bytes: int | None = None,
    result_url_hash: str | None = None,
) -> None:
    """Append one bounded, privacy-minimized attempt outcome."""
    attempt = int(item.get("attempt") or 0) + 1
    await connection.execute(
        text("""
            INSERT INTO thumbnail_backfill_events (
                id, backfill_id, recipe_id, attempt, outcome, failure_code,
                source_bytes, list_bytes, hero_bytes, result_url_hash
            ) VALUES (
                :id, :backfill_id, :recipe_id, :attempt, :outcome, :failure_code,
                :source_bytes, :list_bytes, :hero_bytes, :result_url_hash
            )
        """),
        {
            "id": uuid4(),
            "backfill_id": item["backfill_id"],
            "recipe_id": item["recipe_id"],
            "attempt": attempt,
            "outcome": outcome,
            "failure_code": failure_code,
            "source_bytes": source_bytes,
            "list_bytes": list_bytes,
            "hero_bytes": hero_bytes,
            "result_url_hash": result_url_hash,
        },
    )


async def _record_simple_event(
    database_engine: AsyncEngine,
    *,
    item: dict[str, Any],
    outcome: str,
    failure_code: str | None = None,
) -> None:
    """Record an outcome that does not accompany a recipe mutation."""
    async with database_engine.begin() as connection:
        await _record_event(
            connection,
            item=item,
            outcome=outcome,
            failure_code=failure_code,
        )


def _updated_extracted(
    extracted: dict[str, Any],
    *,
    thumbnail_url: str,
) -> dict[str, Any]:
    """Keep the canonical image URL aligned inside recipe media metadata."""
    updated = copy.deepcopy(extracted)
    media = updated.get("media")
    if not isinstance(media, dict):
        media = {}
    media["thumbnail"] = thumbnail_url
    updated["media"] = media
    return updated


async def _process_item(
    *,
    database_engine: AsyncEngine,
    storage: ThumbnailStorage,
    item: dict[str, Any],
    max_attempts: int,
) -> str:
    """Repair one planned row or append a precise non-mutating outcome."""
    latest_outcome = item.get("outcome")
    attempt = int(item.get("attempt") or 0)
    if latest_outcome in _TERMINAL_OUTCOMES:
        return "already_terminal"
    if attempt >= max_attempts:
        return "attempt_limit"
    if item["preflight_status"] == "failed" and attempt == 0:
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="failed",
            failure_code=item["failure_code"],
        )
        return "failed"

    async with database_engine.connect() as connection:
        current = await _load_current_recipe(connection, item["recipe_id"])
    if current is None:
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="not_found",
            failure_code="recipe_missing",
        )
        return "not_found"
    if not _matches_plan(current, item, storage):
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="conflict",
            failure_code="recipe_changed",
        )
        return "conflict"

    try:
        source = await storage.fetch_thumbnail_source(
            current.thumbnail_url or "",
            item["recipe_id"],
        )
    except Exception as error:
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="failed",
            failure_code=_failure_code(error),
        )
        return "failed"

    source_sha256 = hashlib.sha256(source.data).hexdigest()
    if item["source_bytes"] is not None and (
        len(source.data) != item["source_bytes"]
        or source_sha256 != item["source_sha256"]
    ):
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="source_changed",
            failure_code="source_changed",
        )
        return "source_changed"

    try:
        variants = await storage.prepare_thumbnail_variants(source)
    except Exception as error:
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="failed",
            failure_code=_failure_code(error),
        )
        return "failed"

    try:
        async with database_engine.begin() as connection:
            await connection.execute(
                text("SELECT pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": recipe_media_lock_key(item["recipe_id"])},
            )
            locked = await _load_current_recipe(
                connection,
                item["recipe_id"],
                for_update=True,
            )
            if locked is None:
                await _record_event(
                    connection,
                    item=item,
                    outcome="not_found",
                    failure_code="recipe_missing",
                )
                return "not_found"
            if not _matches_plan(locked, item, storage):
                await _record_event(
                    connection,
                    item=item,
                    outcome="conflict",
                    failure_code="recipe_changed",
                )
                return "conflict"

            result_url = await storage.store_prepared_thumbnail_variants_locked(
                variants,
                item["recipe_id"],
            )
            update_result = await connection.execute(
                text("""
                    UPDATE recipes
                    SET thumbnail_url = :result_url,
                        extracted = CAST(:extracted AS JSONB)
                    WHERE id = :recipe_id
                      AND thumbnail_url = :source_url
                      AND content_revision = :content_revision
                """),
                {
                    "result_url": result_url,
                    "extracted": json.dumps(
                        _updated_extracted(locked.extracted, thumbnail_url=result_url),
                        sort_keys=True,
                    ),
                    "recipe_id": item["recipe_id"],
                    "source_url": locked.thumbnail_url,
                    "content_revision": item["source_content_revision"],
                },
            )
            if update_result.rowcount != 1:
                raise ThumbnailBackfillBlocked(
                    "Backfill stopped: locked recipe update did not match one row"
                )
            await _record_event(
                connection,
                item=item,
                outcome="succeeded",
                source_bytes=len(source.data),
                list_bytes=len(variants["list"].data),
                hero_bytes=len(variants["hero"].data),
                result_url_hash=_url_hash(result_url),
            )
        return "succeeded"
    except ThumbnailBackfillBlocked:
        raise
    except Exception as error:
        await _record_simple_event(
            database_engine,
            item=item,
            outcome="failed",
            failure_code=_failure_code(error),
        )
        return "failed"


async def _try_acquire_backfill_lock(connection: AsyncConnection) -> int | None:
    """Acquire a transaction lock and return its physical PostgreSQL backend ID.

    Production uses Neon's transaction pooler. Keeping this transaction open
    pins the dedicated connection to one PostgreSQL backend for the full run;
    a session advisory lock followed by commit would instead leak the lock on
    one pooled backend while later checks could execute on another.
    """
    row = (
        await connection.execute(
            text("""
                SELECT pg_try_advisory_xact_lock(hashtext(:lock_name)) AS acquired,
                       pg_backend_pid() AS backend_pid
            """),
            {"lock_name": BACKFILL_LOCK_NAME},
        )
    ).one()
    return int(row.backend_pid) if row.acquired else None


async def _assert_backfill_lock_session(
    connection: AsyncConnection,
    expected_backend_pid: int,
) -> None:
    """Stop if the dedicated lock connection was lost or transparently replaced."""
    try:
        current_backend_pid = await connection.scalar(text("SELECT pg_backend_pid()"))
    except Exception as error:
        raise ThumbnailBackfillBlocked(
            "Backfill stopped: global lock connection was lost"
        ) from error
    if current_backend_pid != expected_backend_pid:
        raise ThumbnailBackfillBlocked(
            "Backfill stopped: global lock session changed"
        )


async def _release_backfill_lock(connection: AsyncConnection) -> None:
    """Commit the dedicated transaction, releasing its advisory lock."""
    await connection.commit()


async def run_backfill(
    *,
    apply: bool = False,
    backfill_id: str | None = None,
    restore_point: str | None = None,
    expected_rows: int | None = None,
    expected_source_bytes: int | None = None,
    expected_destination_fingerprint: str | None = None,
    expected_plan_digest: str | None = None,
    expected_release_id: str | None = None,
    after_recipe_id: UUID | None = None,
    batch_size: int = 50,
    max_attempts: int = 3,
    database_engine: AsyncEngine = engine,
    storage: ThumbnailStorage = storage_service,
) -> dict[str, Any]:
    """Inspect or safely repair one bounded keyset page of recipe images."""
    _validate_scope(batch_size=batch_size, after_recipe_id=after_recipe_id)
    if not apply:
        plan = await build_backfill_plan(
            database_engine=database_engine,
            storage=storage,
            after_recipe_id=after_recipe_id,
            batch_size=batch_size,
        )
        return plan.summary()

    _validate_apply_arguments(
        backfill_id=backfill_id,
        restore_point=restore_point,
        expected_rows=expected_rows,
        expected_source_bytes=expected_source_bytes,
        expected_destination_fingerprint=expected_destination_fingerprint,
        expected_plan_digest=expected_plan_digest,
        expected_release_id=expected_release_id,
        max_attempts=max_attempts,
    )
    assert backfill_id is not None
    assert restore_point is not None
    assert expected_rows is not None
    assert expected_source_bytes is not None
    assert expected_destination_fingerprint is not None
    assert expected_plan_digest is not None
    assert expected_release_id is not None
    if not storage.is_enabled:
        raise ThumbnailBackfillBlocked("Apply mode requires configured thumbnail storage")
    current_contract = storage.thumbnail_backfill_contract()
    if (
        current_contract["destination_fingerprint"]
        != expected_destination_fingerprint
    ):
        raise ThumbnailBackfillBlocked(
            "Backfill stopped: destination or transform contract changed"
        )
    if current_contract["release_id"] != expected_release_id:
        raise ThumbnailBackfillBlocked(
            "Backfill stopped: runtime release changed"
        )

    lock_connection = await database_engine.connect()
    lock_backend_pid: int | None = None
    try:
        lock_backend_pid = await _try_acquire_backfill_lock(lock_connection)
        if lock_backend_pid is None:
            raise ThumbnailBackfillBlocked("Another thumbnail backfill is already running")

        async with database_engine.connect() as connection:
            if not await _audit_schema_exists(connection):
                raise ThumbnailBackfillBlocked(
                    "Migration 028 must install the thumbnail backfill audit schema"
                )
            existing_run = await _load_run(connection, backfill_id)
        if existing_run is None:
            plan = await build_backfill_plan(
                database_engine=database_engine,
                storage=storage,
                after_recipe_id=after_recipe_id,
                batch_size=batch_size,
            )
            _validate_plan_expectations(
                plan,
                expected_rows=expected_rows,
                expected_source_bytes=expected_source_bytes,
                expected_destination_fingerprint=expected_destination_fingerprint,
                expected_plan_digest=expected_plan_digest,
            )
            async with database_engine.begin() as connection:
                await _persist_plan(
                    connection,
                    backfill_id=backfill_id,
                    restore_point=restore_point,
                    plan=plan,
                )
            if not plan.planned_items:
                return {
                    **plan.summary(),
                    "apply": True,
                    "backfill_id": backfill_id,
                    "status": "unchanged",
                }
        else:
            _validate_existing_run(
                existing_run,
                restore_point=restore_point,
                after_recipe_id=after_recipe_id,
                batch_size=batch_size,
                expected_rows=expected_rows,
                expected_source_bytes=expected_source_bytes,
                expected_destination_fingerprint=expected_destination_fingerprint,
                expected_plan_digest=expected_plan_digest,
                expected_release_id=expected_release_id,
            )
            if existing_run["planned_items"] == 0:
                return {
                    "status": "unchanged",
                    "apply": True,
                    "backfill_id": backfill_id,
                    "visibility_scope": existing_run["visibility_scope"],
                    "scanned_rows": existing_run["scanned_rows"],
                    "planned_items": 0,
                    "destination_fingerprint": existing_run[
                        "destination_fingerprint"
                    ],
                    "transform_version": existing_run["transform_version"],
                    "release_id": existing_run["release_id"],
                    "plan_digest": existing_run["plan_digest"],
                    "next_after_recipe_id": (
                        str(existing_run["next_after_recipe_id"])
                        if existing_run["next_after_recipe_id"]
                        else None
                    ),
                }

        async with database_engine.connect() as connection:
            items = await _load_run_items(connection, backfill_id)
        outcomes = Counter()
        for item in items:
            await _assert_backfill_lock_session(
                lock_connection,
                lock_backend_pid,
            )
            outcome = await _process_item(
                database_engine=database_engine,
                storage=storage,
                item=item,
                max_attempts=max_attempts,
            )
            outcomes[outcome] += 1

        async with database_engine.connect() as connection:
            current_items = await _load_run_items(connection, backfill_id)
        remaining_retryable = sum(
            1
            for item in current_items
            if item.get("outcome") == "failed"
            and int(item.get("attempt") or 0) < max_attempts
        )
        final_outcomes = Counter(
            str(item.get("outcome") or "pending") for item in current_items
        )
        if remaining_retryable:
            status = "retryable_failures"
        elif final_outcomes == {"succeeded": len(current_items)}:
            status = "completed"
        else:
            status = "completed_with_exceptions"
        return {
            "status": status,
            "apply": True,
            "backfill_id": backfill_id,
            "processed": dict(sorted(outcomes.items())),
            "final_outcomes": dict(sorted(final_outcomes.items())),
            "planned_items": len(items),
            "remaining_retryable": remaining_retryable,
        }
    finally:
        active_exception = sys.exc_info()[0] is not None
        try:
            if lock_backend_pid is not None:
                await _release_backfill_lock(lock_connection)
        except Exception:
            if not active_exception:
                raise
        finally:
            await lock_connection.close()


def _build_parser() -> argparse.ArgumentParser:
    """Build the explicit dry-run/apply command-line contract."""
    parser = argparse.ArgumentParser(
        description="Inspect or repair legacy recipe thumbnails in bounded batches"
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backfill-id")
    parser.add_argument("--restore-point")
    parser.add_argument("--expected-rows", type=int)
    parser.add_argument("--expected-source-bytes", type=int)
    parser.add_argument("--expected-destination-fingerprint")
    parser.add_argument("--expected-plan-digest")
    parser.add_argument("--expected-release-id")
    parser.add_argument("--after-recipe-id", type=UUID)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--max-attempts", type=int, default=3)
    return parser


async def _main() -> None:
    """Run the command and print only its privacy-minimized result."""
    args = _build_parser().parse_args()
    result = await run_backfill(
        apply=args.apply,
        backfill_id=args.backfill_id,
        restore_point=args.restore_point,
        expected_rows=args.expected_rows,
        expected_source_bytes=args.expected_source_bytes,
        expected_destination_fingerprint=args.expected_destination_fingerprint,
        expected_plan_digest=args.expected_plan_digest,
        expected_release_id=args.expected_release_id,
        after_recipe_id=args.after_recipe_id,
        batch_size=args.batch_size,
        max_attempts=args.max_attempts,
    )
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(_main())

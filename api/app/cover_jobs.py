"""Optional, durable recipe-photo enhancement without changing recipe readiness.

Cover jobs use the existing leased queue with a separate worker and never appear
in the consumer extraction inbox. Candidate bytes are a bounded process-local
optimization only; every persisted job can reacquire its source after restart.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections import OrderedDict
from contextlib import suppress
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.ai_governance import ai_request_context
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.image_validation import validate_image_bytes
from app.job_worker import DurableJobWorker, apply_recovered_completion, unclaimable_job_query
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.recipe import ExtractionJob, Recipe
from app.recipe_estimates import source_is_incomplete
from app.services.cover_selection import (
    MAX_IMAGE_BYTES,
    MAX_TOTAL_BYTES,
    CoverCandidate,
    cover_selection_service,
)
from app.services.storage import storage_service
from app.services.video import video_service

settings = get_settings()
MAX_CACHED_BYTES = 32 * 1024 * 1024
MAX_JOB_AGE_SECONDS = 300


def cover_pending_until(recipe: Recipe, *, now: datetime | None = None) -> datetime | None:
    """Project bounded pending state without exposing selection provenance."""
    media = (recipe.extracted or {}).get("media") or {}
    selection = media.get("coverSelection") if isinstance(media, dict) else None
    if not isinstance(selection, dict) or selection.get("status") != "pending":
        return None
    if selection.get("contentRevision") != int(recipe.content_revision or 1):
        return None
    try:
        deadline = datetime.fromisoformat(selection["deadline"])
        if deadline.tzinfo is None:
            return None
        current = now or datetime.now(timezone.utc)
        return (
            deadline
            if current < deadline <= current + timedelta(seconds=MAX_JOB_AGE_SECONDS)
            else None
        )
    except (KeyError, TypeError, ValueError):
        return None


def _selection_metadata(recipe: Recipe, metadata: dict) -> None:
    extracted = deepcopy(recipe.extracted or {})
    media = extracted.get("media")
    extracted["media"] = dict(media) if isinstance(media, dict) else {}
    extracted["media"]["coverSelection"] = metadata
    recipe.extracted = extracted
    flag_modified(recipe, "extracted")


class CandidateCache:
    """A byte/time-bounded optimization; persisted jobs never depend on it."""

    def __init__(self) -> None:
        self._entries: OrderedDict[UUID, tuple[float, list[CoverCandidate], int]] = OrderedDict()

    def remember(self, job_id: UUID, candidates: list[CoverCandidate]) -> None:
        now = time.monotonic()
        self._prune(now)
        size = sum(len(candidate.image_data) for candidate in candidates)
        if not candidates or size > MAX_CACHED_BYTES:
            return
        self._entries.pop(job_id, None)
        while (
            self._entries
            and sum(entry[2] for entry in self._entries.values()) + size > MAX_CACHED_BYTES
        ):
            self._entries.popitem(last=False)
        self._entries[job_id] = (now, candidates[:32], size)

    def take(self, job_id: UUID) -> list[CoverCandidate]:
        self._prune(time.monotonic())
        entry = self._entries.pop(job_id, None)
        return entry[1] if entry else []

    def _prune(self, now: float) -> None:
        for key, entry in list(self._entries.items()):
            if now - entry[0] >= MAX_JOB_AGE_SECONDS:
                self._entries.pop(key, None)


candidate_cache = CandidateCache()


def should_enhance_cover(recipe: Recipe) -> bool:
    return bool(
        settings.recipe_cover_selection_enabled
        and settings.job_worker_enabled
        and storage_service.is_enabled
        and recipe.user_id
        and video_service.detect_platform(recipe.source_url) in video_service.SUPPORTED_PLATFORMS
        and not source_is_incomplete(
            recipe.extracted or {}, extraction_method=recipe.extraction_method
        )
    )


def enqueue_cover_job(
    db, recipe: Recipe, extraction_result, *, parent_job_id: UUID | str | None = None
) -> ExtractionJob | None:
    """Queue atomically with the recipe; a crash cannot lose the image stage."""
    if not should_enhance_cover(recipe):
        return None
    now = datetime.now(timezone.utc)
    revision = int(recipe.content_revision or 1)
    deadline = now + timedelta(seconds=MAX_JOB_AGE_SECONDS)
    source_thumbnail = getattr(extraction_result, "thumbnail_url", None)
    if not isinstance(source_thumbnail, str) or len(source_thumbnail) > 4096:
        source_thumbnail = None
    job = ExtractionJob(
        id=uuid4(),
        job_kind="cover",
        url=recipe.source_url,
        user_id=recipe.user_id,
        target_recipe_id=recipe.id,
        recipe_id=recipe.id,
        notes=json.dumps(
            {
                "version": 1,
                "revision": revision,
                "sourceThumbnail": source_thumbnail,
                "parentJob": str(parent_job_id) if parent_job_id else None,
            }
        ),
        idempotency_key=f"cover:{recipe.id}:{revision}",
        status="queued",
        current_step="choosing_photo",
        message="Choosing recipe photo",
        expires_at=deadline,
        max_attempts=2,
    )
    _selection_metadata(
        recipe, {"status": "pending", "contentRevision": revision, "deadline": deadline.isoformat()}
    )
    db.add(job)
    candidates = []
    total_bytes = 0
    for index, frame in enumerate(getattr(extraction_result, "cover_frames", None) or []):
        try:
            if len(frame.image_base64) > MAX_IMAGE_BYTES * 4 // 3 + 4:
                continue
            data = base64.b64decode(frame.image_base64, validate=True)
            total_bytes += len(data)
            if total_bytes > MAX_TOTAL_BYTES:
                break
            candidates.append(
                CoverCandidate(
                    f"frame-{index}",
                    data,
                    "video_frame",
                    timestamp_seconds=frame.timestamp_seconds,
                )
            )
        except (TypeError, ValueError):
            continue
    for index, encoded in enumerate(getattr(extraction_result, "cover_images", None) or []):
        try:
            if len(encoded) > MAX_IMAGE_BYTES * 4 // 3 + 4:
                continue
            data = base64.b64decode(encoded, validate=True)
            total_bytes += len(data)
            if total_bytes > MAX_TOTAL_BYTES:
                break
            candidates.append(
                CoverCandidate(
                    f"slide-{index}",
                    data,
                    "slideshow",
                    slide_index=index,
                )
            )
        except (TypeError, ValueError):
            continue
    candidate_cache.remember(job.id, candidates)
    return job


def _job_matches_recipe(job: ExtractionJob, recipe: Recipe | None, revision: int) -> bool:
    return bool(
        recipe
        and recipe.user_id == job.user_id
        and recipe.source_url == job.url
        and int(recipe.content_revision or 1) == revision
        and not source_is_incomplete(
            recipe.extracted or {}, extraction_method=recipe.extraction_method
        )
    )


class CoverJobWorker(DurableJobWorker):
    def __init__(self) -> None:
        super().__init__(job_kinds=("cover",))

    async def start(self) -> None:
        if settings.recipe_cover_selection_enabled:
            await super().start()

    async def _expire_unclaimable_jobs(self, db, now: datetime) -> None:
        result = await db.execute(unclaimable_job_query(now, self.job_kinds))
        jobs = list(result.scalars().all())
        await super()._expire_unclaimable_jobs(db, now)
        for job in jobs:
            job.notes = "{}"
            candidate_cache.take(job.id)

    async def execute_claimed_job(self, job_id: UUID) -> None:
        async with AsyncSessionLocal() as db:
            job = await db.scalar(
                select(ExtractionJob).where(ExtractionJob.id == job_id).with_for_update()
            )
            if not job or job.status != "claimed" or job.job_kind != "cover":
                return
            token = job.lease_token
            job.status = "processing"
            job.current_step = "choosing_photo"
            job.message = "Choosing recipe photo"
            job.leased_until = datetime.now(timezone.utc) + timedelta(
                seconds=settings.job_lease_seconds
            )
            await db.commit()
            remaining = (
                (job.expires_at - datetime.now(timezone.utc)).total_seconds()
                if job.expires_at
                else MAX_JOB_AGE_SECONDS
            )

        heartbeat = asyncio.create_task(self._heartbeat_loop(job_id, token))
        try:
            await asyncio.wait_for(
                self._enhance(job_id, token),
                timeout=max(0.01, min(remaining, settings.recipe_cover_job_timeout_seconds)),
            )
        except asyncio.CancelledError:
            raise  # The lease and persisted request permit restart recovery.
        except Exception as exc:
            # Provider/media failures never fail the already-saved recipe.
            await self.retry_or_fail(job_id, type(exc).__name__, expected_lease_token=token)
            await self._clear_terminal_pending(job_id)
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat

    async def _enhance(self, job_id: UUID, token: str) -> None:
        async with AsyncSessionLocal() as db:
            job = await db.get(ExtractionJob, job_id)
            if not job or job.lease_token != token or job.status != "processing":
                return
            payload = json.loads(job.notes)
            revision = int(payload["revision"])
            if payload.get("parentJob"):
                parent = await db.get(ExtractionJob, UUID(payload["parentJob"]))
                if (
                    not parent
                    or parent.user_id != job.user_id
                    or parent.status in {"failed", "expired", "cancelled"}
                ):
                    await self._finish(job_id, token, "superseded")
                    return
                if parent.status != "completed":
                    await self._postpone_for_parent(job_id, token)
                    return
            recipe = await db.get(Recipe, job.target_recipe_id) if job.target_recipe_id else None
            if not _job_matches_recipe(job, recipe, revision):
                await self._finish(job_id, token, "superseded")
                return
            recipe_data = deepcopy(recipe.extracted)
            source_url, owner, recipe_id = job.url, job.user_id, recipe.id
            incumbent_url = recipe.thumbnail_url
            source_thumbnail = payload.get("sourceThumbnail")

        candidates = candidate_cache.take(job_id)
        incumbent = None
        if incumbent_url or source_thumbnail:
            try:
                image = await storage_service.fetch_thumbnail_source(
                    incumbent_url or source_thumbnail, recipe_id
                )
                incumbent = CoverCandidate("incumbent", image.data, "platform_thumbnail")
            except Exception:
                pass
        if not incumbent:
            metadata = await video_service.get_video_metadata_ytdlp(source_url)
            if metadata.thumbnail:
                try:
                    image = await storage_service.fetch_thumbnail_source(
                        metadata.thumbnail, recipe_id
                    )
                    incumbent = CoverCandidate("incumbent", image.data, "platform_thumbnail")
                except Exception:
                    pass
        if incumbent:
            candidates.insert(0, incumbent)
            # Deliver the durable original photo promptly while ranking runs.
            if not incumbent_url:
                incumbent_url = await self._store_candidate(
                    job_id, token, incumbent, revision, expected_thumbnail=None
                )

        if not candidates or not any(
            candidate.source_kind != "platform_thumbnail" for candidate in candidates
        ):
            if video_service.is_tiktok_photo_post(source_url):
                image_urls = await video_service.fetch_tiktok_photo_images(source_url)
                # The storage fetcher bounds bytes and validates every redirect.
                for index, image_url in enumerate(
                    image_urls[: settings.recipe_cover_max_candidates]
                ):
                    try:
                        image = await storage_service.fetch_thumbnail_source(
                            image_url, recipe_id, referer="https://www.tiktok.com/"
                        )
                        candidates.append(
                            CoverCandidate(
                                f"slide-{index}", image.data, "slideshow", slide_index=index
                            )
                        )
                    except Exception:
                        continue
            else:
                frame_result = await video_service.extract_cover_frames(source_url)
                for index, frame in enumerate(frame_result.frames or []):
                    candidates.append(
                        CoverCandidate(
                            f"frame-{index}",
                            base64.b64decode(frame.image_base64, validate=True),
                            "video_frame",
                            timestamp_seconds=frame.timestamp_seconds,
                        )
                    )

        if not candidates:
            raise RuntimeError("CoverMediaUnavailable")
        if incumbent is None and incumbent_url is None:
            # Preserve the former first-slide/15%-frame fallback even when the
            # optional grading provider is disabled or unavailable. Reuse bytes.
            frames = [
                candidate for candidate in candidates if candidate.timestamp_seconds is not None
            ]
            fallback = (
                min(
                    frames,
                    key=lambda candidate: abs(
                        candidate.timestamp_seconds
                        - max(frame.timestamp_seconds for frame in frames) * 0.15
                    ),
                )
                if frames
                else candidates[0]
            )
            incumbent = CoverCandidate(
                "incumbent",
                fallback.image_data,
                "thumbnail",
                timestamp_seconds=fallback.timestamp_seconds,
                slide_index=fallback.slide_index,
            )
            candidates.insert(0, incumbent)
            incumbent_url = await self._store_candidate(
                job_id, token, incumbent, revision, expected_thumbnail=None
            )
        with ai_request_context(
            request_id=f"cover_{job_id.hex}",
            user_id=owner,
            job_id=str(job_id),
            route="cover_worker",
        ):
            selection = await cover_selection_service.select(
                candidates, recipe_data, video_service.detect_platform(source_url)
            )
        if selection.error_code in {
            "timeout",
            "provider_error",
            "provider_http_error",
            "invalid_response",
            "incomplete_or_refused",
        }:
            candidate_cache.remember(job_id, candidates)
            raise RuntimeError("CoverSelectionUnavailable")
        if selection.candidate and selection.candidate is not incumbent:
            await self._store_candidate(
                job_id, token, selection.candidate, revision, expected_thumbnail=incumbent_url
            )
        await self._finish(
            job_id, token, "selected" if selection.candidate else "abstained", selection.provenance
        )

    async def _store_candidate(
        self,
        job_id: UUID,
        token: str,
        candidate: CoverCandidate,
        revision: int,
        *,
        expected_thumbnail: str | None,
    ) -> str | None:
        image = await asyncio.to_thread(
            validate_image_bytes, candidate.image_data, max_bytes=10 * 1024 * 1024
        )
        variants = await storage_service.prepare_thumbnail_variants(image)
        async with AsyncSessionLocal() as db:
            # Match deletion's advisory-media -> recipe -> job lock order.
            identity = await db.get(ExtractionJob, job_id)
            if not identity or not identity.target_recipe_id:
                return None
            recipe_id = identity.target_recipe_id
            await acquire_recipe_media_lock(db, recipe_id)
            recipe = await db.scalar(
                select(Recipe)
                .where(Recipe.id == recipe_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            job = await db.scalar(
                select(ExtractionJob)
                .where(ExtractionJob.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if (
                not job
                or job.lease_token != token
                or job.status != "processing"
                or not _job_matches_recipe(job, recipe, revision)
            ):
                return None
            if job.expires_at and job.expires_at <= datetime.now(timezone.utc):
                return None
            if recipe.thumbnail_url != expected_thumbnail:
                return None
            image_url = await storage_service.store_prepared_thumbnail_variants_locked(
                variants, recipe_id
            )
            recipe.thumbnail_url = image_url
            extracted = deepcopy(recipe.extracted)
            media = extracted.get("media") or {}
            extracted["media"] = {**media, "thumbnail": image_url}
            recipe.extracted = extracted
            flag_modified(recipe, "extracted")
            await db.commit()
            return image_url

    async def _finish(
        self, job_id: UUID, token: str, outcome: str, provenance: dict | None = None
    ) -> None:
        async with AsyncSessionLocal() as db:
            identity = await db.get(ExtractionJob, job_id)
            if not identity or not identity.target_recipe_id:
                return
            await acquire_recipe_media_lock(db, identity.target_recipe_id)
            recipe = await db.scalar(
                select(Recipe).where(Recipe.id == identity.target_recipe_id).with_for_update()
            )
            job = await db.scalar(
                select(ExtractionJob)
                .where(ExtractionJob.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if not job or job.lease_token != token or job.status != "processing":
                return
            revision = int(json.loads(job.notes)["revision"])
            if _job_matches_recipe(job, recipe, revision):
                _selection_metadata(
                    recipe, {"status": outcome, "contentRevision": revision, **(provenance or {})}
                )
            apply_recovered_completion(job, datetime.now(timezone.utc))
            job.message = "Recipe photo processing finished"
            job.notes = "{}"  # Expiring source-image URLs are no longer needed.
            await db.commit()

    async def _postpone_for_parent(self, job_id: UUID, token: str) -> None:
        """Wait for import completion without racing its cancellation cleanup."""
        async with AsyncSessionLocal() as db:
            job = await db.scalar(
                select(ExtractionJob).where(ExtractionJob.id == job_id).with_for_update()
            )
            if not job or job.lease_token != token or job.status != "processing":
                return
            job.status = "queued"
            job.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=5)
            job.attempt_count = max(0, job.attempt_count - 1)
            job.lease_token = None
            job.leased_until = None
            await db.commit()

    async def _clear_terminal_pending(self, job_id: UUID) -> None:
        async with AsyncSessionLocal() as db:
            job = await db.get(ExtractionJob, job_id)
            if not job or job.status not in {"failed", "expired", "cancelled"}:
                return
            try:
                revision = int(json.loads(job.notes)["revision"])
            except (KeyError, TypeError, ValueError):
                return
            if not job.target_recipe_id:
                return
            await acquire_recipe_media_lock(db, job.target_recipe_id)
            recipe = await db.scalar(
                select(Recipe).where(Recipe.id == job.target_recipe_id).with_for_update()
            )
            job = await db.scalar(
                select(ExtractionJob)
                .where(ExtractionJob.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if not job or job.status not in {"failed", "expired", "cancelled"}:
                return
            if _job_matches_recipe(job, recipe, revision):
                _selection_metadata(recipe, {"status": "unavailable", "contentRevision": revision})
            job.notes = "{}"
            await db.commit()


cover_job_worker = CoverJobWorker()

"""Durable imports; all commit points recheck account generation and AI consent."""

import asyncio
from contextlib import suppress
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, text

from app.ai_governance import ai_request_context
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.automation_models import WorkoutImport
from app.domains.workouts.extraction import (
    ExtractionRequest,
    WorkoutExtractionResult,
    WorkoutExtractor,
)
from app.domains.workouts.import_usage_service import (
    charge_usable_import,
    enforce_import_allowance,
    purge_import_usage,
)
from app.domains.workouts.lifecycle import lock_owner, membership_for, now
from app.domains.workouts.models import WorkoutsConsent
from app.domains.workouts.router import content_digest

TERMINAL = {"ready", "incomplete", "failed", "cancelled", "expired"}
RETRYABLE = {"source_or_provider_unavailable", "source_or_provider_timeout"}
MAX_IMPORTS_PER_DAY = 15
MAX_IMPORT_ATTEMPTS = 3


async def require_ai_consent(db, user_id, generation, *, expected=None):
    consent = await db.get(WorkoutsConsent, user_id, populate_existing=True)
    if not consent or consent.generation != generation or not consent.accepted_at:
        raise HTTPException(403, "Accept AI processing before importing or coaching")
    if expected is not None and consent.accepted_at != expected:
        raise HTTPException(409, "AI consent changed; this operation was cancelled")
    return consent


async def create_import(
    db, user_id, generation, request_id, request, *, auto_save=False, is_public=False,
    display_name="Håfa member",
):
    await membership_for(db, user_id, generation=generation, write=True)
    consent = await require_ai_consent(db, user_id, generation)
    content = request.model_dump(mode="json")
    if auto_save:
        content["_save"] = {"is_public": is_public, "display_name": display_name[:100]}
    identity = dict(content)
    if auto_save:
        identity["_save"] = {"is_public": is_public}
    digest = content_digest(identity)
    existing = await db.scalar(
        select(WorkoutImport).where(
            WorkoutImport.app_user_id == user_id,
            WorkoutImport.generation == generation,
            WorkoutImport.request_id == request_id,
        )
    )
    if existing:
        if existing.request_hash != digest:
            raise HTTPException(409, "Import identity was used for different source content")
        return existing
    await enforce_import_allowance(db, user_id, generation, request_id, limit=MAX_IMPORTS_PER_DAY)
    row = WorkoutImport(
        id=uuid4(),
        app_user_id=user_id,
        generation=generation,
        request_id=request_id,
        request_hash=digest,
        payload=content,
        status="queued",
        ai_accepted_at=consent.accepted_at,
        expires_at=now() + timedelta(hours=24),
    )
    db.add(row)
    await db.commit()
    return row


def saved_warning_projection(warnings):
    unique = list(dict.fromkeys(warnings))
    if len(unique) <= 100:
        return unique
    return unique[:99] + [
        f"{len(unique) - 99} more extraction warnings. Check the full source details before training."
    ]


async def save_import_result(db, row, result, preferences):
    """Save once under the worker's owner/generation lock, without a live client."""
    if result.workout is not None:
        if result.status == "incomplete" and not result.warnings:
            result.warnings.append(
                "Some exercises are missing rounds, sets, reps, time, or distance. Missing values stay unspecified."
            )
        result.workout.extraction_warnings = saved_warning_projection(result.warnings)
    if preferences is None or row.accepted_workout_id or result.workout is None:
        return
    from app.auth import ClerkUser
    from app.domains.workouts.automation_router import store_workout
    from app.domains.workouts.discover import discover_ready, set_publication
    from app.domains.workouts.library_organization_service import refresh_optional_source_metadata
    from app.domains.workouts.router import validated_workout
    from app.domains.workouts.source_media import retain_source_cover

    if result.status not in {"ready", "incomplete"}:
        return
    try:
        content = validated_workout(result.workout, authored=False)
    except HTTPException as error:
        if error.status_code != 422:
            raise
        result.status = "incomplete"
        result.error_code = "workout_needs_correction"
        result.warnings.append("The extracted workout needs correction before saving. Your source remains available.")
        result.workout.extraction_warnings = saved_warning_projection(result.warnings)
        return
    try:
        await retain_source_cover(db, row.app_user_id, row.generation, result.workout.source_thumbnail_url)
    except HTTPException as error:
        if error.status_code != 422:
            raise
        result.workout.source_thumbnail_url = None
        content.pop("source_thumbnail_url", None)
        result.source.coverage_notes.append("Preview image unavailable; the saved instructions remain intact.")
    saved = store_workout(db, row.app_user_id, row.generation, content)
    await refresh_optional_source_metadata(db, saved)
    # Insufficient or uncertain sources remain private, regardless of the
    # capture preference. A revoked disclosure cannot discard the private save.
    if preferences.get("is_public") and result.status == "ready" and not result.warnings:
        if await discover_ready(db):
            actor = ClerkUser(
                id=row.app_user_id, clerk_user_id="workouts-import", clerk_issuer="workouts-import",
                clerk_environment="workouts-import", first_name=preferences.get("display_name"),
            )
            try:
                await set_publication(db, saved, actor, True)
            except HTTPException:
                pass  # Save privately if publishing no longer qualifies.
    row.accepted_workout_id = saved.id
    row.accepted_content_hash = content_digest(content)
    row.payload = None


async def cancel_imports(db, user_id):
    rows = (
        await db.scalars(
            select(WorkoutImport).where(
                WorkoutImport.app_user_id == user_id,
                WorkoutImport.status.in_(["queued", "processing"]),
            )
        )
    ).all()
    for row in rows:
        from app.domains.workouts.source_media import release_source_cover

        await release_source_cover(db, user_id, row.generation, row.id)
        row.status = "cancelled"
        row.payload = None
        row.result = None
        row.lease_token = None
        row.leased_until = None
        row.updated_at = now()


class WorkoutImportWorker:
    def __init__(self, session_factory=AsyncSessionLocal, extractor=None):
        self.sessions = session_factory
        self.extractor = extractor or WorkoutExtractor()
        self.task = None
        self.active_task = None
        self.active_owner = None
        self.wake = asyncio.Event()

    def enabled(self):
        configured = get_settings()
        return (
            configured.workouts_api_enabled
            and configured.workouts_imports_enabled
            and configured.workouts_ai_enabled
            and configured.job_worker_enabled
        )

    def maintenance_enabled(self):
        configured = get_settings()
        return configured.workouts_api_enabled and configured.job_worker_enabled

    async def start(self):
        if self.maintenance_enabled() and self.task is None:
            self.task = asyncio.create_task(self.run(), name="workouts-import-dispatch")

    async def stop(self):
        for task in (self.active_task, self.task):
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        self.task = self.active_task = None
        self.active_owner = None

    def notify(self):
        self.wake.set()

    def cancel_owner(self, user_id):
        if self.active_owner == user_id and self.active_task:
            self.active_task.cancel()

    async def run(self):
        while self.maintenance_enabled():
            try:
                worked = await self.tick() if self.enabled() else False
                # Sweep even under a continuous queue; successful dispatches
                # must not indefinitely defer content-free receipt retention.
                await self.purge_expired()
                if worked:
                    continue
                self.wake.clear()
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(self.wake.wait(), timeout=30)
            except asyncio.CancelledError:
                raise
            except Exception:
                # No source/provider/SQL exceptions in logs. DB leases remain
                # recoverable; retries are bounded and independent of Recipes.
                self.wake.clear()
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(self.wake.wait(), timeout=30)

    async def tick(self):
        current = now()
        async with self.sessions() as db:
            # Serialize dispatch across replicas and admit at most one live
            # Workouts extraction. Existing Recipes media slots remain shared.
            await db.execute(text("SELECT pg_advisory_xact_lock(7340035)"))
            active = await db.scalar(
                select(WorkoutImport.id)
                .where(WorkoutImport.status == "processing", WorkoutImport.leased_until > current)
                .limit(1)
            )
            if active is not None:
                return False
            dispatch = (
                select(
                    WorkoutImport.app_user_id.label("owner"),
                    func.max(WorkoutImport.updated_at).label("last_dispatch"),
                )
                .where(WorkoutImport.attempt_count > 0)
                .group_by(WorkoutImport.app_user_id)
                .subquery()
            )
            row = await db.scalar(
                select(WorkoutImport)
                .outerjoin(dispatch, dispatch.c.owner == WorkoutImport.app_user_id)
                .where(
                    WorkoutImport.status.in_(["queued", "processing"]),
                    or_(
                        WorkoutImport.next_attempt_at.is_(None),
                        WorkoutImport.next_attempt_at <= current,
                    ),
                    or_(
                        WorkoutImport.leased_until.is_(None), WorkoutImport.leased_until <= current
                    ),
                )
                .order_by(dispatch.c.last_dispatch.asc().nullsfirst(), WorkoutImport.created_at)
                .with_for_update(skip_locked=True, of=WorkoutImport)
                .limit(1)
            )
            if row is None:
                return False
            if row.expires_at <= current or row.attempt_count >= MAX_IMPORT_ATTEMPTS:
                row.status = "expired" if row.expires_at <= current else "failed"
                row.payload = None
                row.lease_token = None
                row.leased_until = None
                await db.commit()
                return True
            # Claim does not hold an AppUser lock while downloading or invoking
            # a provider. Authorization is checked separately before side effects.
            token = uuid4().hex
            identifier = row.id
            owner = row.app_user_id
            generation = row.generation
            row.lease_token = token
            row.leased_until = current + timedelta(seconds=300)
            row.status = "processing"
            row.attempt_count += 1
            row.updated_at = current
            await db.commit()
        self.active_owner = owner
        self.active_task = asyncio.create_task(self.process(identifier, owner, generation, token))
        try:
            await self.active_task
        except asyncio.CancelledError:
            if self.task is not None and self.task.cancelling():
                raise
        finally:
            self.active_task = None
            self.active_owner = None
        return True

    async def process(self, identifier, owner, generation, token):
        async with self.sessions() as db:
            try:
                await membership_for(db, owner, generation=generation, write=True)
                row = await db.get(WorkoutImport, identifier, populate_existing=True)
                if row is None or row.lease_token != token or row.status != "processing":
                    return
                await require_ai_consent(db, owner, generation, expected=row.ai_accepted_at)
                consent_epoch = row.ai_accepted_at
                source = dict(row.payload)
                preferences = source.pop("_save", None)
                request = ExtractionRequest.model_validate(source)
                await db.rollback()
            except HTTPException:
                await db.rollback()
                await self.finish_cancelled(identifier, owner, generation, token)
                return
        with ai_request_context(
            request_id=str(identifier), user_id=owner, job_id=None, route="/api/v1/workouts/imports"
        ):
            try:
                result = await asyncio.wait_for(self.extractor.extract(request), timeout=240)
            except asyncio.TimeoutError:
                result = WorkoutExtractionResult(
                    status="incomplete",
                    error_code="source_or_provider_timeout",
                    warnings=["Import timed out. Try again or complete the workout manually."],
                )
        if request.kind == "url" and result.workout and result.source.thumbnail_url:
            from app.domains.workouts.source_media import prepare_source_cover

            result.workout.source_thumbnail_url = await prepare_source_cover(
                self.sessions, owner, generation, identifier, result.source.thumbnail_url,
                expected_ai_accepted_at=consent_epoch,
            )
        async with self.sessions() as db:
            try:
                await membership_for(db, owner, generation=generation, write=True)
                row = await db.get(WorkoutImport, identifier, populate_existing=True)
                if row is None or row.lease_token != token or row.status != "processing":
                    return
                await require_ai_consent(db, owner, generation, expected=row.ai_accepted_at)
                current = now()
                if row.expires_at <= current:
                    row.status = "expired"
                    row.payload = None
                    row.result = None
                elif result.error_code in RETRYABLE and row.attempt_count < MAX_IMPORT_ATTEMPTS:
                    row.status = "queued"
                    row.next_attempt_at = current + timedelta(seconds=15 * row.attempt_count)
                else:
                    await charge_usable_import(db, row, result)
                    await save_import_result(db, row, result, preferences)
                    row.status = result.status
                    row.result = result.model_dump(mode="json")
                    # Private raw capture survives until review, cancellation
                    # or expiry so another device can inspect visual evidence.
                row.lease_token = None
                row.leased_until = None
                row.updated_at = current
                await db.commit()
            except HTTPException:
                await db.rollback()
                await self.finish_cancelled(identifier, owner, generation, token)

    async def finish_cancelled(self, identifier, owner, generation, token):
        async with self.sessions() as db:
            try:
                await lock_owner(db, owner)
            except HTTPException:
                return
            row = await db.scalar(
                select(WorkoutImport)
                .where(
                    WorkoutImport.id == identifier,
                    WorkoutImport.app_user_id == owner,
                    WorkoutImport.generation == generation,
                    WorkoutImport.lease_token == token,
                )
                .with_for_update()
            )
            if row:
                from app.domains.workouts.source_media import release_source_cover

                await release_source_cover(db, owner, generation, identifier)
                row.status = "cancelled"
                row.payload = None
                row.result = None
                row.lease_token = None
                row.leased_until = None
                row.updated_at = now()
                await db.commit()

    async def purge_expired(self):
        from app.domains.workouts.export_service import invalidate_export_snapshots
        from app.models.identity import AppUser

        current = now()
        async with self.sessions() as db:
            owners = (
                await db.scalars(
                    select(WorkoutImport.app_user_id)
                    .where(WorkoutImport.expires_at < current)
                    .distinct()
                    .order_by(WorkoutImport.app_user_id)
                    .limit(100)
                )
            ).all()
        # Each owner commits separately; never hold a hundred account locks
        # while processing the rest of a maintenance batch.
        for owner in owners:
            async with self.sessions.begin() as db:
                if (
                    await db.scalar(select(AppUser.id).where(AppUser.id == owner).with_for_update())
                    is None
                ):
                    continue
                generations = (
                    await db.scalars(
                        select(WorkoutImport.generation)
                        .where(
                            WorkoutImport.app_user_id == owner, WorkoutImport.expires_at < current
                        )
                        .distinct()
                    )
                ).all()
                for generation in generations:
                    await invalidate_export_snapshots(db, owner, generation)
                from app.domains.workouts.source_media import release_source_cover

                expired = await db.scalars(select(WorkoutImport).where(
                    WorkoutImport.app_user_id == owner, WorkoutImport.expires_at < current,
                ))
                for job in expired:
                    await release_source_cover(db, owner, job.generation, job.id)
                await db.execute(
                    delete(WorkoutImport).where(
                        WorkoutImport.app_user_id == owner, WorkoutImport.expires_at < current
                    )
                )
        async with self.sessions.begin() as db:
            await purge_import_usage(db)
        from app.domains.workouts.export_service import cleanup_expired_exports
        from app.domains.workouts.lifecycle import optional_table_exists

        # Each batch commits independently. Limit one sweep's work; subsequent
        # maintenance ticks finish any backlog without monopolizing Recipes.
        for _ in range(5):
            async with self.sessions.begin() as db:
                if not await optional_table_exists(db, "workouts_export_snapshots"):
                    break
                count = await cleanup_expired_exports(db, limit=100)
            if count < 100:
                break


workout_import_worker = WorkoutImportWorker()

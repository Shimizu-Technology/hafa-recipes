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
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import WorkoutsConsent
from app.domains.workouts.router import content_digest

TERMINAL = {"ready", "incomplete", "failed", "cancelled", "expired"}
RETRYABLE = {"source_or_provider_unavailable", "source_or_provider_timeout"}
MAX_IMPORTS_PER_DAY = 15


async def require_ai_consent(db, user_id, generation, *, expected=None):
    consent = await db.get(WorkoutsConsent, user_id, populate_existing=True)
    if not consent or consent.generation != generation or not consent.accepted_at:
        raise HTTPException(403, "Accept AI processing before importing or coaching")
    if expected is not None and consent.accepted_at != expected:
        raise HTTPException(409, "AI consent changed; this operation was cancelled")
    return consent


async def create_import(db, user_id, generation, request_id, request):
    await membership_for(db, user_id, generation=generation, write=True)
    consent = await require_ai_consent(db, user_id, generation)
    content = request.model_dump(mode="json")
    digest = content_digest(content)
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
            if row.expires_at <= current or row.attempt_count >= 3:
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
                request = ExtractionRequest.model_validate(row.payload)
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
                elif result.error_code in RETRYABLE and row.attempt_count < 3:
                    row.status = "queued"
                    row.next_attempt_at = current + timedelta(seconds=15 * row.attempt_count)
                else:
                    await charge_usable_import(db, row, result)
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
                row.status = "cancelled"
                row.payload = None
                row.result = None
                row.lease_token = None
                row.leased_until = None
                row.updated_at = now()
                await db.commit()

    async def purge_expired(self):
        async with self.sessions() as db:
            await db.execute(delete(WorkoutImport).where(WorkoutImport.expires_at < now()))
            await purge_import_usage(db)
            await db.commit()


workout_import_worker = WorkoutImportWorker()

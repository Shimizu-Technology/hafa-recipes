"""Restart-safe durable worker with a cross-replica single execution owner."""

import asyncio
import logging
from contextlib import suppress
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text

from app.ai_governance import ai_request_context
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.baby.access import (
    AccessChanged,
    SpaceAccess,
    _stamp,
    access_for,
    family_enabled,
    touch,
)
from app.domains.baby.lifecycle import now, owned, source_note, validate_relations
from app.domains.baby.models import (
    BABY_TABLES,
    BabyAttachment,
    BabyImport,
    BabyRecord,
    BabySpace,
    BabySpaceMember,
)
from app.domains.baby.processing import process_capture
from app.domains.baby.provider import BabyProvider
from app.domains.baby.schema import ALLOWED_FORMS
from app.domains.baby.schema import schema_complete as check_schema
from app.domains.baby.schemas import DEFAULT_SOURCE_TITLE
from app.models.identity import AppUser

logger = logging.getLogger("hafa.baby.worker")
WORKER_LOCK = 7340050


async def schema_complete(connection, *, tables=None, allowed_forms=ALLOWED_FORMS):
    """Check the running models against the explicit pre-F11 compatibility contract."""
    if tables is None:
        from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential

        tables = (*BABY_TABLES, BabyShareCredential.__table__, BabyShareCapture.__table__)
    # Once a release maps a column it must exist; historical migrations still
    # use their frozen optional forms directly. Keep nullable/SET NULL expansion.
    mapped = {table.name: table for table in tables}
    forms = {name: {column: tuple(form for form in options
        if form is not None or column not in mapped[name].c)
        for column, options in contract.items()}
        for name, contract in allowed_forms.items() if name in mapped}
    return await check_schema(connection, tables=tables, allowed_forms=forms)


async def verify_baby_schema(session_factory=None):
    if not getattr(get_settings(), "baby_api_enabled", False):
        return
    async with (session_factory or AsyncSessionLocal)() as db:
        for version in (56, 57):
            if not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=:version)"), {"version": version}):
                raise RuntimeError(f"Apply Baby migration{version:03} before deploying F2")
        if not await schema_complete(db):
            raise RuntimeError("Baby schema is incomplete; apply migrations056 and057 before F2")
        if not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=50)")
        ):
            raise RuntimeError("Baby migration050 marker is missing")


async def job_access(db, owner, generation, space_id, *, write=False):
    return await access_for(db, owner, stored_space_id=space_id, generation=generation, write=write)


async def retire_unreachable(db, model, identifier, owner, generation, stored_space):
    """Retire inaccessible queue work without borrowing the actor's current destination."""
    await db.rollback()
    if not family_enabled():
        return False
    affected = set(await db.scalars(select(BabySpaceMember.app_user_id).where(
        BabySpaceMember.space_id == stored_space)))
    for actor in sorted({owner, *affected}):
        await db.scalar(select(AppUser.id).where(AppUser.id == actor).with_for_update())
    space = await db.scalar(select(BabySpace).where(BabySpace.id == stored_space).with_for_update())
    after = set(await db.scalars(select(BabySpaceMember.app_user_id).where(
        BabySpaceMember.space_id == stored_space)))
    if after != affected:
        await db.rollback()
        return True
    row = await db.get(model, identifier, populate_existing=True, with_for_update=True)
    if (row is None or row.app_user_id != owner or row.space_id != stored_space
            or row.generation != generation or space is None):
        await db.rollback()
        return True
    grant = SpaceAccess(space, "internal", 0, db, db.get_transaction())
    db.info["baby_family_write"] = True
    if model is BabyImport:
        if row.status not in {"queued", "processing"}:
            return True
        row.status, row.error, row.lease_token, row.lease_until = (
            "cancelled", "Baby access changed. Your original source is saved.", None, None)
        row.updated_at = now()
        await _stamp(row, grant)
        source = await db.get(BabyRecord, row.record_id, populate_existing=True, with_for_update=True)
        if (source is not None and source.space_id == stored_space and source.generation == generation
                and source.deleted_at is None):
            source.data = {**source.data, "status": "cancelled"}
            source.revision, source.updated_at = source.revision + 1, now()
            await _stamp(source, grant)
    else:
        if row.status != "deferred":
            return True
        row.status, row.last_attempt_at = "saved", now()
    await _stamp(row, grant)
    await db.commit()
    return True


class BabyWorker:
    def __init__(
        self,
        session_factory=AsyncSessionLocal,
        processor=process_capture,
        provider_factory=BabyProvider,
    ):
        self.sessions, self.processor, self.provider_factory = (
            session_factory,
            processor,
            provider_factory,
        )
        self.task = None
        self.event = asyncio.Event()

    def notify(self):
        self.event.set()

    async def start(self):
        if (
            getattr(get_settings(), "baby_api_enabled", False)
            and getattr(get_settings(), "baby_worker_enabled", False)
            and (self.task is None or self.task.done())
        ):
            self.task = asyncio.create_task(self.run(), name="baby-import-worker")

    async def stop(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def run(self):
        while True:
            try:
                if not await self.tick():
                    self.event.clear()
                    with suppress(TimeoutError):
                        await asyncio.wait_for(self.event.wait(), 10)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Baby import maintenance deferred")
                with suppress(TimeoutError):
                    await asyncio.wait_for(self.event.wait(), 10)

    async def tick(self):
        # The connection remains checked out until processing settles; no other
        # replica can start a Baby media import during this execution lease.
        async with self.sessions() as guard:
            acquired = await guard.scalar(
                text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": WORKER_LOCK}
            )
            if not acquired:
                return False
            from app.domains.baby.share_router import drain_deferred_captures

            async with self.sessions() as deferred:
                await drain_deferred_captures(deferred)
            # Transaction-scoped ownership is released by the shielded session
            # close even if shutdown is cancelled repeatedly; never leak a
            # session advisory lock back into the pool.
            return await self.claim_and_process()

    async def claim_and_process(self):
        async with self.sessions() as db:
            # Read candidate first, then acquire the same account-first lock as
            # routes/deletion. Never invert row/account lock order.
            candidate = await db.scalar(
                select(BabyImport)
                .where(
                    or_(
                        BabyImport.status == "queued",
                        (BabyImport.status == "processing") & (BabyImport.lease_until < now()),
                    )
                )
                .order_by(BabyImport.created_at)
                .limit(1)
            )
            if candidate is None:
                return False
            identifier, owner, generation = (
                candidate.id,
                candidate.app_user_id,
                candidate.generation,
            )
            stored_space = candidate.space_id
            try:
                access = await job_access(db, owner, generation, stored_space, write=True)
                member = access.member
                row = await owned(db, BabyImport, access, generation, identifier)
                await owned(db, BabyRecord, access, generation, row.record_id)
            except AccessChanged:
                await db.rollback()
                return True
            except HTTPException:
                return await retire_unreachable(db, BabyImport, identifier, owner, generation, stored_space)
            if row.status not in {"queued", "processing"} or (
                row.status == "processing" and row.lease_until and row.lease_until > now()
            ):
                return True
            source_attempts = await db.scalar(select(func.coalesce(func.sum(BabyImport.attempts), 0)).where(
                BabyImport.record_id == row.record_id))
            if row.attempts >= 5 or source_attempts >= 5:
                row.status, row.error = (
                    "failed",
                    "Processing stopped after repeated interruptions. Your original is saved.",
                )
                await self.finish_source(db, row, access)
                await db.commit()
                return True
            if row.consent_epoch != member.consent_epoch or (
                row.request.get("automatic")
                and not (
                    member.profile.get("ai_consent") and member.profile.get("auto_process_shares")
                )
            ):
                row.status, row.error = (
                    "cancelled",
                    "Your processing permission changed. Retry deliberately.",
                )
                await self.finish_source(db, row, access)
                await db.commit()
                return True
            token = uuid4()
            row.status, row.lease_token, row.lease_until = (
                "processing",
                token,
                now() + timedelta(minutes=8),
            )
            row.attempts, row.updated_at = row.attempts + 1, now()
            request, epoch = dict(row.request), row.consent_epoch
            await touch(row, access.target)
            try:
                source = await owned(db, BabyRecord, access, generation, row.record_id)
            except AccessChanged:
                await db.rollback()
                return True
            except HTTPException:
                return await retire_unreachable(db, BabyImport, identifier, owner, generation, stored_space)
            linked = bool(request.get("url") or source.data.get("url") or source.data.get("attachment_ids"))
            note, note_patch = await source_note(db, source) if linked else (None, {})
            request["url"] = source.data.get("url")
            request["attachment_ids"] = source.data.get("attachment_ids", [])
            if linked:
                request["text"] = note
            source.revision += 1
            source.updated_at = now()
            baseline_revision = source.revision
            source.data = {**source.data, **note_patch, "status": "processing"}
            await touch(source, access.target)
            await touch(row, access.target)
            await db.commit()

        async def gate():
            async with self.sessions() as check:
                access = await job_access(check, owner, generation, stored_space)
                member = access.member
                current = await owned(check, BabyImport, access, generation, identifier)
                if (
                    member.consent_epoch != epoch
                    or current.status != "processing"
                    or current.lease_token != token
                    or (access.enabled and (current.lease_until is None or current.lease_until <= now()))
                    or (
                        request.get("automatic")
                        and not (
                            member.profile.get("ai_consent")
                            and member.profile.get("auto_process_shares")
                        )
                    )
                ):
                    raise HTTPException(409, "Capture no longer active")

        async def ai_gate():
            await gate()
            async with self.sessions() as check:
                access = await job_access(check, owner, generation, stored_space)
                member = access.member
                if not member.profile.get("ai_consent") or member.consent_epoch != epoch:
                    raise HTTPException(403, "AI processing permission is required")

        try:
            async with self.sessions() as db:
                access = await job_access(db, owner, generation, stored_space)
                member = access.member
                may_use_ai = bool(member.profile.get("ai_consent"))
                attachments = []
                for attachment_id in request.get("attachment_ids", []):
                    from uuid import UUID

                    attachment = await owned(
                        db, BabyAttachment, access, generation, UUID(attachment_id)
                    )
                    if attachment.state != "ready":
                        raise ValueError("Attachment unavailable")
                    attachments.append(attachment)
                # Category titles let extraction suggest the parent's own words.
                request["categories"] = [
                    {"id": str(row.id), "title": row.title}
                    for row in await db.scalars(
                        select(BabyRecord)
                        .where(
                            access.condition(BabyRecord),
                            BabyRecord.kind == "collection",
                            BabyRecord.deleted_at.is_(None),
                        )
                        .order_by(BabyRecord.updated_at.desc(), BabyRecord.id)
                        .limit(100)
                    )
                ]
            provider = self.provider_factory(gate=ai_gate)
            with ai_request_context(
                request_id=str(identifier), user_id=owner, job_id=None, route="/api/v1/baby/imports"
            ):
                result = await asyncio.wait_for(
                    self.processor(
                        request, attachments, provider, may_use_ai=may_use_ai, gate=gate
                    ),
                    timeout=300,
                )
            await gate()
            async with self.sessions() as db:
                access = await job_access(db, owner, generation, stored_space, write=True)
                current = access.member
                if current.consent_epoch != epoch:
                    return True
                row = await owned(db, BabyImport, access, generation, identifier)
                source = await owned(db, BabyRecord, access, generation, row.record_id)
                if row.status != "processing" or row.lease_token != token or (
                    access.enabled and (row.lease_until is None or row.lease_until <= now())
                ):
                    return True
                if source.revision == baseline_revision:
                    # Preserve the editable body, child and original attachments.
                    title = source.title
                    if result.get("title") and (
                        not request.get("record_id")
                        or (not request.get("automatic") and source.title == DEFAULT_SOURCE_TITLE)
                        or (
                            request.get("automatic")
                            and source.title == request.get("automatic_title")
                        )
                    ):
                        title = result["title"]
                    merged = {**source.data, **keep_user_decisions(source.data, result["data"])}
                    if access.enabled:
                        await validate_relations(db, access, generation, source.child_id, merged,
                                                 record_id=source.id, kind="source")
                    source.title = title
                    source.data = merged
                    source.revision, source.updated_at = source.revision + 1, now()
                else:
                    # A user edit wins; expose the conflict rather than overwrite.
                    result["status"], result["error"] = (
                        "incomplete",
                        "You edited this source while it processed. Your edits were kept; retry to organize it again.",
                    )
                    source.data = {**source.data, "status": "incomplete"}
                    if access.enabled:
                        source.revision, source.updated_at = source.revision + 1, now()
                row.status, row.error = result["status"], result.get("error")
                row.lease_token, row.lease_until, row.updated_at = None, None, now()
                await touch(source, access.target)
                await touch(row, access.target)
                await db.commit()
        except AccessChanged:
            # Rollback/close leaves queued work or the durable lease for recovery.
            return True
        except asyncio.CancelledError:
            # The durable lease makes a killed process recoverable after restart.
            raise
        except Exception:
            async with self.sessions() as db:
                try:
                    access = await job_access(db, owner, generation, stored_space, write=True)
                    row = await owned(db, BabyImport, access, generation, identifier)
                    if row.status == "processing" and row.lease_token == token and (
                        not access.enabled or (row.lease_until is not None and row.lease_until > now())
                    ):
                        row.status, row.error, row.lease_token, row.lease_until = (
                            "failed",
                            "Processing could not finish. Your original source is saved; you can retry.",
                            None,
                            None,
                        )
                        await touch(row, access.target)
                        source = await owned(db, BabyRecord, access, generation, row.record_id)
                        source.data = {**source.data, "status": "failed"}
                        source.revision, source.updated_at = source.revision + 1, now()
                        await touch(source, access.target)
                        await touch(row, access.target)
                        await db.commit()
                except AccessChanged:
                    await db.rollback()
                except HTTPException:
                    await retire_unreachable(db, BabyImport, identifier, owner, generation, stored_space)
        return True

    @staticmethod
    async def finish_source(db, row, access):
        """Keep the saved source consistent with terminal queue recovery."""
        await touch(row, access.target)
        source = await owned(db, BabyRecord, access, row.generation, row.record_id)
        source.data = {**source.data, "status": row.status}
        source.revision, source.updated_at = source.revision + 1, now()
        row.lease_token, row.lease_until, row.updated_at = None, None, now()
        await touch(source, access.target)
        await touch(row, access.target)


def keep_user_decisions(current, organized):
    """Keep user decisions and earlier reading after a retry cannot reread a source."""
    organized = dict(organized)
    organized.pop("attachment_ids", None)
    organized.pop("user_text", None)
    organized.pop("legacy_saved_text", None)
    if (organized.get("status") in {"incomplete", "failed"} and current.get("source_text")
            and (current.get("url") or current.get("attachment_ids"))
            and not any(item.get("text") and item.get("location") != "user_note"
                        for item in (organized.get("evidence") or []))):
        # Keep earlier reading for display, without feeding it into this attempt.
        for key in ("source_text", "summary", "evidence", "key_points", "steps", "creator",
                    "platform", "thumbnail_url", "suggested_category"):
            organized.pop(key, None)
        organized["coverage_notes"] = [
            "Previously saved text is shown. This attempt could not reread the source.",
            *organized.get("coverage_notes", []),
        ][:30]
    if (current.get("relevance") or {}).get("origin") == "user":
        organized.pop("relevance", None)
    if (current.get("suggested_category") or {}).get("status") in {"accepted", "dismissed"}:
        organized.pop("suggested_category", None)
    return organized


baby_worker = BabyWorker()


async def start_baby_worker():
    await baby_worker.start()


async def stop_baby_worker():
    await baby_worker.stop()

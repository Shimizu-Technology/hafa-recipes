"""Restart-safe durable worker with a cross-replica single execution owner."""

import asyncio
import logging
from contextlib import suppress
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import CheckConstraint, or_, select, text

from app.ai_governance import ai_request_context
from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.baby.lifecycle import membership_for, now, owned
from app.domains.baby.models import (
    BABY_TABLES,
    BabyAttachment,
    BabyImport,
    BabyRecord,
)
from app.domains.baby.processing import process_capture
from app.domains.baby.provider import BabyProvider

logger = logging.getLogger("hafa.baby.worker")
WORKER_LOCK = 7340050


async def schema_complete(connection):
    """Verify columns, types, nullability, PKs and owner foreign keys."""
    for table in BABY_TABLES:
        columns = {
            row[0]: (row[1], row[2])
            for row in (
                await connection.execute(
                    text("""SELECT column_name,udt_name,is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name=:name"""),
                    {"name": table.name},
                )
            ).all()
        }
        for column in table.columns:
            expected = {
                "VARCHAR": "varchar",
                "TEXT": "text",
                "INTEGER": "int4",
                "UUID": "uuid",
                "JSONB": "jsonb",
                "DATE": "date",
            }.get(str(column.type))
            if expected is None:
                if str(column.type).startswith("VARCHAR"):
                    expected = "varchar"
                elif str(column.type) == "DATETIME":
                    expected = "timestamptz"
            if columns.get(column.name) != (expected, "YES" if column.nullable else "NO"):
                return False
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint) and constraint.name:
                if not await connection.scalar(
                    text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
                    WHERE conrelid=to_regclass(:table) AND conname=:name AND contype='c' AND convalidated)"""),
                    {"table": "public." + table.name, "name": constraint.name},
                ):
                    return False
        for index in table.indexes:
            if not await connection.scalar(
                text("""SELECT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                WHERE i.indrelid=to_regclass(:table) AND c.relname=:name AND i.indisvalid)"""),
                {"table": "public." + table.name, "name": index.name},
            ):
                return False
        primary = [column.name for column in table.primary_key.columns]
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
            WHERE conrelid=to_regclass(:table) AND contype='p'
            AND pg_get_constraintdef(oid)=:definition)"""),
            {
                "table": "public." + table.name,
                "definition": "PRIMARY KEY (" + ", ".join(primary) + ")",
            },
        ):
            return False
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
            WHERE conrelid=to_regclass(:table) AND contype='f' AND convalidated
            AND pg_get_constraintdef(oid)='FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE')"""),
            {"table": "public." + table.name},
        ):
            return False
    return True


async def verify_baby_schema(session_factory=None):
    if not getattr(get_settings(), "baby_api_enabled", False):
        return
    async with (session_factory or AsyncSessionLocal)() as db:
        if not await schema_complete(db):
            raise RuntimeError("Baby migration050 schema is incomplete")
        if not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=50)")
        ):
            raise RuntimeError("Baby migration050 marker is missing")


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
                text("SELECT pg_try_advisory_lock(:key)"), {"key": WORKER_LOCK}
            )
            if not acquired:
                return False
            try:
                return await self.claim_and_process()
            finally:
                await guard.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": WORKER_LOCK})
                await guard.commit()

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
            try:
                member = await membership_for(db, owner, generation=generation, write=True)
                row = await owned(db, BabyImport, owner, generation, identifier)
            except HTTPException:
                await db.rollback()
                return False
            if row.status not in {"queued", "processing"} or (
                row.status == "processing" and row.lease_until and row.lease_until > now()
            ):
                return True
            if row.attempts >= 5:
                row.status, row.error = (
                    "failed",
                    "Processing stopped after repeated interruptions. Your original is saved.",
                )
                await db.commit()
                return True
            if row.consent_epoch != member.consent_epoch:
                row.status, row.error = (
                    "cancelled",
                    "Your processing permission changed. Retry deliberately.",
                )
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
            source = await owned(db, BabyRecord, owner, generation, row.record_id)
            source.revision += 1
            source.updated_at = now()
            baseline_revision = source.revision
            source.data = {**source.data, "status": "processing"}
            await db.commit()

        async def gate():
            async with self.sessions() as check:
                member = await membership_for(check, owner, generation=generation)
                current = await owned(check, BabyImport, owner, generation, identifier)
                if (
                    member.consent_epoch != epoch
                    or current.status != "processing"
                    or current.lease_token != token
                ):
                    raise HTTPException(409, "Capture no longer active")

        async def ai_gate():
            await gate()
            async with self.sessions() as check:
                member = await membership_for(check, owner, generation=generation)
                if not member.profile.get("ai_consent") or member.consent_epoch != epoch:
                    raise HTTPException(403, "AI processing permission is required")

        try:
            async with self.sessions() as db:
                member = await membership_for(db, owner, generation=generation)
                may_use_ai = bool(member.profile.get("ai_consent"))
                attachments = []
                for attachment_id in request.get("attachment_ids", []):
                    from uuid import UUID

                    attachment = await owned(
                        db, BabyAttachment, owner, generation, UUID(attachment_id)
                    )
                    if attachment.state != "ready":
                        raise ValueError("Attachment unavailable")
                    attachments.append(attachment)
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
                current = await membership_for(db, owner, generation=generation, write=True)
                if current.consent_epoch != epoch:
                    return True
                row = await owned(db, BabyImport, owner, generation, identifier)
                source = await owned(db, BabyRecord, owner, generation, row.record_id)
                if row.status != "processing" or row.lease_token != token:
                    return True
                if source.revision == baseline_revision:
                    # Preserve the editable body, child and original attachments.
                    if result.get("title") and not request.get("record_id"):
                        source.title = result["title"]
                    source.data = {**source.data, **result["data"]}
                    source.revision, source.updated_at = source.revision + 1, now()
                else:
                    # A user edit wins; expose the conflict rather than overwrite.
                    result["status"], result["error"] = (
                        "incomplete",
                        "You edited this source while it processed. Your edits were kept; retry to organize it again.",
                    )
                    source.data = {**source.data, "status": "incomplete"}
                row.status, row.error = result["status"], result.get("error")
                row.lease_token, row.lease_until, row.updated_at = None, None, now()
                await db.commit()
        except asyncio.CancelledError:
            # The durable lease makes a killed process recoverable after restart.
            raise
        except Exception:
            async with self.sessions() as db:
                try:
                    await membership_for(db, owner, generation=generation, write=True)
                    row = await owned(db, BabyImport, owner, generation, identifier)
                    if row.status == "processing" and row.lease_token == token:
                        row.status, row.error, row.lease_token, row.lease_until = (
                            "failed",
                            "Processing could not finish. Your original source is saved; you can retry.",
                            None,
                            None,
                        )
                        source = await owned(db, BabyRecord, owner, generation, row.record_id)
                        source.data = {**source.data, "status": "failed"}
                        source.revision, source.updated_at = source.revision + 1, now()
                        await db.commit()
                except HTTPException:
                    await db.rollback()
        return True


baby_worker = BabyWorker()


async def start_baby_worker():
    await baby_worker.start()


async def stop_baby_worker():
    await baby_worker.stop()

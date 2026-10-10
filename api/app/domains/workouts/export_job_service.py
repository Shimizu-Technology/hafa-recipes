"""Bounded durable admission; deletion never proves executing memory ended."""

import hmac
import math
from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.export_job_execution import ExportJobExecution
from app.domains.workouts.export_job_identity import (
    OperatorDeathVerifier,
    current_worker_identity,
    evidence_digest,
    same_namespace_ended,
)
from app.domains.workouts.export_job_models import (
    WorkoutsExportJob,
    WorkoutsExportJobRecovery,
    WorkoutsExportJobSlot,
)
from app.domains.workouts.export_job_runtime import verify_export_job_schema
from app.domains.workouts.export_job_schemas import ExportJobReceipt
from app.domains.workouts.export_models import WorkoutsExportSnapshot
from app.domains.workouts.export_service import ExportManifest, export_key, privacy_digest
from app.domains.workouts.lifecycle import membership_for

TOTAL_SECONDS = 120
EXPIRY_SECONDS = 600
LEASE_SECONDS = 15
MAX_ACCEPTED_PER_HOUR = 6
TERMINAL = frozenset({"ready", "cancelled", "failed", "expired"})
PROCESS_IDENTITY = current_worker_identity()


def stopped(detail="export_job_stopped", status=410):
    return HTTPException(status, detail)


class ExportJobCoordinator:
    def __init__(
        self, sessions=AsyncSessionLocal, *, settings=None, identity=None, death_verifier=None
    ):
        self.sessions = sessions
        self.settings = settings
        self.identity = identity or PROCESS_IDENTITY
        self.death_verifier = death_verifier or OperatorDeathVerifier()
        self._verified = False

    @property
    def configured(self):
        return self.settings or get_settings()

    async def installed(self):
        if not self.configured.workouts_api_enabled:
            return False
        if self._verified:
            return True
        engine = getattr(self.sessions, "kw", {}).get("bind")
        if engine is None:
            raise stopped("export_jobs_unavailable", 503)
        try:
            self._verified = await verify_export_job_schema(engine, settings=self.configured)
        except (SQLAlchemyError, RuntimeError):
            raise stopped("export_jobs_unavailable", 503) from None
        # Absence is deliberately not cached: installed045 must fence a replica
        # even if its async route switch remains OFF during a mixed rollout.
        return self._verified

    async def _fresh(self, db):
        await db.connection(execution_options={"isolation_level": "READ COMMITTED"})
        await db.execute(text("SET LOCAL statement_timeout='750ms'"))
        await db.execute(text("SET LOCAL lock_timeout='500ms'"))

    async def _slot(self, db):
        slot = await db.scalar(
            select(WorkoutsExportJobSlot).where(WorkoutsExportJobSlot.slot == 1).with_for_update()
        )
        if slot is None:
            raise stopped("export_jobs_unavailable", 503)
        return slot

    def authorize(self, user):
        configured = self.configured
        if not configured.workouts_api_enabled:
            raise stopped("Not found", 404)
        if (
            not configured.workouts_public_access_enabled
            and user.id not in configured.workouts_testers
        ):
            raise stopped("Workouts testing is not enabled for this account", 403)

    async def admit(self, user, generation, request_id, *, kind="async"):
        self.authorize(user)
        if kind == "async" and not self.configured.workouts_export_jobs_enabled:
            raise stopped("Not found", 404)
        if type(request_id) is not UUID or kind not in {"async", "legacy"}:
            raise stopped("Invalid export request", 422)
        if not await self.installed():
            raise stopped("export_jobs_unavailable", 503)
        key = export_key()
        # Replays do not wait for or consume global admission, and remain valid
        # after expiry. Revalidate owner/current generation in receipt().
        async with self.sessions() as db:
            existing = await db.scalar(
                select(WorkoutsExportJob.id).where(
                    WorkoutsExportJob.app_user_id == user.id,
                    WorkoutsExportJob.generation == generation,
                    WorkoutsExportJob.request_id == request_id,
                )
            )
        if existing is not None:
            return await self.receipt(user, generation, existing)
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)  # Global -> owner -> job; never reverse.
            await membership_for(db, user.id, generation=generation, write=True)
            existing = await db.scalar(
                select(WorkoutsExportJob)
                .where(
                    WorkoutsExportJob.app_user_id == user.id,
                    WorkoutsExportJob.generation == generation,
                    WorkoutsExportJob.request_id == request_id,
                )
                .with_for_update()
            )
            if existing is not None:
                identifier = existing.id
            else:
                if slot.active_job_id is not None:
                    raise HTTPException(429, "export_job_busy", headers={"Retry-After": "2"})
                clock = await db.scalar(select(func.clock_timestamp()))
                recent = (
                    await db.scalars(
                        select(WorkoutsExportJob.admitted_at)
                        .where(
                            WorkoutsExportJob.app_user_id == user.id,
                            WorkoutsExportJob.admitted_at > clock - timedelta(hours=1),
                        )
                        .order_by(WorkoutsExportJob.admitted_at)
                        .limit(MAX_ACCEPTED_PER_HOUR)
                    )
                ).all()
                if len(recent) >= MAX_ACCEPTED_PER_HOUR:
                    retry = max(
                        1, math.ceil((recent[0] + timedelta(hours=1) - clock).total_seconds())
                    )
                    raise HTTPException(
                        429, "export_job_rate_limited", headers={"Retry-After": str(retry)}
                    )
                identifier, snapshot_id = uuid4(), uuid4()
                row = WorkoutsExportJob(
                    id=identifier,
                    app_user_id=user.id,
                    generation=generation,
                    request_id=request_id,
                    kind=kind,
                    snapshot_id=snapshot_id,
                    status="queued",
                    admitted_at=clock,
                    deadline_at=clock + timedelta(seconds=TOTAL_SECONDS),
                    expires_at=clock + timedelta(seconds=EXPIRY_SECONDS),
                    permission_digest=await privacy_digest(db, user.id, generation, key),
                )
                db.add(row)
                slot.active_job_id, slot.snapshot_id = identifier, snapshot_id
                slot.admitted_at, slot.deadline_at = row.admitted_at, row.deadline_at
                if kind == "legacy":
                    self._start(row, slot, clock)
        return await self.receipt(user, generation, identifier)

    def _start(self, row, slot, clock):
        if row.started_at is not None or slot.started_at is not None:
            raise stopped("export_job_interrupted")
        token = uuid4()
        for target in (row, slot):
            target.started_at = clock
            target.worker_instance = self.identity.instance
            target.worker_identity = self.identity.record()
            target.lease_token = token
            target.leased_until = min(clock + timedelta(seconds=LEASE_SECONDS), row.deadline_at)
        row.status = "running"

    @staticmethod
    def execution(row):
        return ExportJobExecution(
            row.id,
            row.app_user_id,
            row.generation,
            row.snapshot_id,
            row.lease_token,
            row.worker_instance,
            row.deadline_at,
            row.expires_at,
            bytes(row.permission_digest),
        )

    async def claim(self, identifier=None):
        if not await self.installed():
            return None
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)
            if slot.active_job_id is None or (
                identifier is not None and slot.active_job_id != identifier
            ):
                return None
            row = await db.get(WorkoutsExportJob, slot.active_job_id)
            if row is None:
                return None
            await membership_for(db, row.app_user_id, generation=row.generation, write=True)
            row = await db.scalar(
                select(WorkoutsExportJob)
                .where(WorkoutsExportJob.id == row.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            clock = await db.scalar(select(func.clock_timestamp()))
            if row.status != "queued" or row.started_at is not None or slot.started_at is not None:
                return None
            if row.deadline_at <= clock or not hmac.compare_digest(
                row.permission_digest,
                await privacy_digest(db, row.app_user_id, row.generation, export_key()),
            ):
                row.status = "expired" if row.deadline_at <= clock else "failed"
                row.failure_code = (
                    "deadline_exceeded" if row.deadline_at <= clock else "privacy_changed"
                )
                row.finished_at = clock
                return None
            self._start(row, slot, clock)
            return self.execution(row)

    async def legacy_execution(self, user, generation, identifier):
        async with self.sessions.begin() as db:
            await self._fresh(db)
            await membership_for(db, user.id, generation=generation, write=True)
            row = await db.get(WorkoutsExportJob, identifier)
            if (
                row is None
                or row.app_user_id != user.id
                or row.generation != generation
                or row.kind != "legacy"
                or row.worker_instance != self.identity.instance
            ):
                raise stopped("export_job_interrupted")
            return self.execution(row)

    async def _receipt(self, db, row, key):
        clock = await db.scalar(select(func.clock_timestamp()))
        slot = await db.get(WorkoutsExportJobSlot, 1)
        pending = slot is not None and slot.active_job_id == row.id
        if row.expires_at <= clock:
            await db.execute(
                delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.id == row.snapshot_id)
            )
            row.status, row.manifest = "expired", None
            if row.finished_at is None:
                row.finished_at = clock
        manifest = None
        if row.status == "ready":
            snapshot = await db.get(WorkoutsExportSnapshot, row.snapshot_id)
            if (
                snapshot is None
                or snapshot.status != "ready"
                or snapshot.expires_at <= clock
                or snapshot.app_user_id != row.app_user_id
                or snapshot.generation != row.generation
                or not hmac.compare_digest(snapshot.permission_digest, row.permission_digest)
            ):
                row.status, row.manifest = "expired", None
            elif not hmac.compare_digest(
                row.permission_digest,
                await privacy_digest(db, row.app_user_id, row.generation, key),
            ):
                await db.execute(
                    delete(WorkoutsExportSnapshot).where(
                        WorkoutsExportSnapshot.id == row.snapshot_id
                    )
                )
                row.status, row.failure_code, row.manifest = "failed", "privacy_changed", None
            else:
                manifest = ExportManifest.model_validate(row.manifest)
        visible_status = "running" if row.status == "ready" and pending else row.status
        if visible_status != "ready":
            manifest = None
        return ExportJobReceipt(
            id=row.id,
            request_id=row.request_id,
            generation=row.generation,
            status=visible_status,
            admitted_at=row.admitted_at,
            deadline_at=row.deadline_at,
            expires_at=row.expires_at,
            started_at=row.started_at,
            finished_at=None
            if visible_status in {"queued", "running", "cancel_requested"}
            else row.finished_at,
            failure_code=row.failure_code,
            cleanup_pending=pending,
            manifest=manifest,
        )

    async def receipt(self, user, generation, identifier=None, *, request_id=None):
        self.authorize(user)
        if not await self.installed():
            raise stopped("Not found", 404)
        async with self.sessions.begin() as db:
            await self._fresh(db)
            await membership_for(db, user.id, generation=generation, write=True)
            predicate = (
                WorkoutsExportJob.id == identifier
                if identifier is not None
                else WorkoutsExportJob.request_id == request_id
            )
            row = await db.scalar(
                select(WorkoutsExportJob)
                .where(
                    predicate,
                    WorkoutsExportJob.app_user_id == user.id,
                    WorkoutsExportJob.generation == generation,
                )
                .with_for_update()
            )
            if row is None:
                raise stopped("export_job_not_found", 404)
            return await self._receipt(db, row, export_key())

    async def cancel(self, user, generation, identifier):
        self.authorize(user)
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)
            await membership_for(db, user.id, generation=generation, write=True)
            row = await db.scalar(
                select(WorkoutsExportJob)
                .where(
                    WorkoutsExportJob.id == identifier,
                    WorkoutsExportJob.app_user_id == user.id,
                    WorkoutsExportJob.generation == generation,
                )
                .with_for_update()
            )
            if row is None:
                raise stopped("export_job_not_found", 404)
            clock = await db.scalar(select(func.clock_timestamp()))
            await db.execute(
                delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.id == row.snapshot_id)
            )
            row.manifest = None
            if row.status in {"queued", "running", "cancel_requested", "ready"}:
                row.status = (
                    "cancel_requested"
                    if row.started_at is not None and slot.active_job_id == row.id
                    else "cancelled"
                )
                if row.status == "cancelled" and row.finished_at is None:
                    row.finished_at = clock
            if slot.active_job_id == row.id and slot.started_at is None:
                await self._release(db, slot, "never_started", clock)
            return await self._receipt(db, row, export_key())

    async def _release(self, db, slot, reason, clock):
        if slot.active_job_id is None:
            return
        db.add(
            WorkoutsExportJobRecovery(
                id=uuid4(),
                job_id=slot.active_job_id,
                worker_instance=slot.worker_instance,
                released_at=clock,
                reason=reason,
                evidence_digest=evidence_digest(
                    [str(slot.active_job_id), slot.worker_identity, str(slot.lease_token)], reason
                ),
            )
        )
        await db.flush()  # Immutable audit must exist before the slot trigger.
        for column in WorkoutsExportJobSlot.__table__.columns:
            if column.name != "slot":
                setattr(slot, column.name, None)

    async def heartbeat(self, execution):
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)
            if slot.active_job_id != execution.job_id or slot.lease_token != execution.lease_token:
                return False
            await membership_for(db, execution.owner, generation=execution.generation, write=True)
            row = await db.scalar(
                select(WorkoutsExportJob)
                .where(WorkoutsExportJob.id == execution.job_id)
                .with_for_update()
            )
            clock = await db.scalar(select(func.clock_timestamp()))
            if (
                row is None
                or row.status != "running"
                or row.lease_token != execution.lease_token
                or row.worker_instance != execution.worker_instance
                or slot.worker_instance != execution.worker_instance
                or row.deadline_at <= clock
                or row.leased_until is None
                or row.leased_until <= clock
                or slot.leased_until is None
                or slot.leased_until <= clock
            ):
                return False
            until = min(clock + timedelta(seconds=LEASE_SECONDS), row.deadline_at)
            row.leased_until = slot.leased_until = until
            return True

    async def acknowledge_end(self, execution, outcome):
        """Only worker consumer calls after its task/trace/source refs are gone."""
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)
            if (
                slot.active_job_id != execution.job_id
                or slot.lease_token != execution.lease_token
                or slot.worker_instance != execution.worker_instance
            ):
                return
            # Missing owner/job after cascade is expected. Slot remains independent.
            from app.models.identity import AppUser

            await db.scalar(
                select(AppUser.id).where(AppUser.id == execution.owner).with_for_update()
            )
            row = await db.scalar(
                select(WorkoutsExportJob)
                .where(WorkoutsExportJob.id == execution.job_id)
                .with_for_update()
            )
            clock = await db.scalar(select(func.clock_timestamp()))
            if row is not None:
                if row.status in {"running", "ready"} and row.deadline_at <= clock:
                    row.status, row.failure_code = "expired", "deadline_exceeded"
                elif row.status == "cancel_requested":
                    row.status = "cancelled"
                elif row.status == "running":
                    row.status = "expired" if outcome == "deadline_exceeded" else "failed"
                    row.failure_code = outcome or "interrupted"
                if row.finished_at is None:
                    row.finished_at = clock
                if row.status != "ready":
                    row.manifest = None
                    await db.execute(
                        delete(WorkoutsExportSnapshot).where(
                            WorkoutsExportSnapshot.id == row.snapshot_id
                        )
                    )
            await self._release(db, slot, "actual_end", clock)

    async def maintain(self):
        """One slot plus bounded artifact/audit sweeps; never reap by lease alone."""
        if not await self.installed():
            return
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)
            clock = await db.scalar(select(func.clock_timestamp()))
            if slot.active_job_id is not None:
                row = await db.get(WorkoutsExportJob, slot.active_job_id)
                if row is not None:
                    from app.models.identity import AppUser

                    await db.scalar(
                        select(AppUser.id).where(AppUser.id == row.app_user_id).with_for_update()
                    )
                    row = await db.scalar(
                        select(WorkoutsExportJob)
                        .where(WorkoutsExportJob.id == row.id)
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                if slot.started_at is None:
                    if row is None or row.status != "queued" or slot.deadline_at <= clock:
                        if row is not None and row.status == "queued":
                            row.status, row.failure_code, row.finished_at = (
                                "expired",
                                "deadline_exceeded",
                                clock,
                            )
                        await self._release(db, slot, "never_started", clock)
                else:
                    ended = same_namespace_ended(slot.worker_identity, self.identity)
                    if (
                        row is not None
                        and row.status in {"running", "cancel_requested", "ready"}
                        and (
                            ended
                            or slot.leased_until is None
                            or slot.leased_until <= clock
                            or slot.deadline_at <= clock
                        )
                    ):
                        row.status = "expired" if slot.deadline_at <= clock else "failed"
                        row.failure_code = (
                            "deadline_exceeded" if slot.deadline_at <= clock else "interrupted"
                        )
                        row.manifest = None
                        if row.finished_at is None:
                            row.finished_at = clock
                        await db.execute(
                            delete(WorkoutsExportSnapshot).where(
                                WorkoutsExportSnapshot.id == slot.snapshot_id
                            )
                        )
                    if ended:
                        await self._release(db, slot, "same_namespace_dead", clock)
            old_audits = (
                select(WorkoutsExportJobRecovery.id)
                .where(WorkoutsExportJobRecovery.released_at <= clock - timedelta(days=7))
                .order_by(WorkoutsExportJobRecovery.released_at)
                .limit(50)
            )
            await db.execute(
                delete(WorkoutsExportJobRecovery).where(
                    WorkoutsExportJobRecovery.id.in_(old_audits)
                )
            )
        # Identity tombstones survive expiry. Each owner's artifact cleanup uses
        # its own owner-first transaction, never locks another owner's job first.
        async with self.sessions() as db:
            expired = (
                await db.execute(
                    select(WorkoutsExportJob.id, WorkoutsExportJob.app_user_id)
                    .where(
                        WorkoutsExportJob.expires_at <= func.clock_timestamp(),
                        WorkoutsExportJob.manifest.is_not(None),
                    )
                    .order_by(WorkoutsExportJob.expires_at)
                    .limit(50)
                )
            ).all()
        from app.models.identity import AppUser

        for identifier, owner in expired:
            async with self.sessions.begin() as db:
                await self._fresh(db)
                await db.scalar(select(AppUser.id).where(AppUser.id == owner).with_for_update())
                row = await db.scalar(
                    select(WorkoutsExportJob)
                    .where(WorkoutsExportJob.id == identifier)
                    .with_for_update()
                )
                clock = await db.scalar(select(func.clock_timestamp()))
                if row is not None and row.expires_at <= clock:
                    await db.execute(
                        delete(WorkoutsExportSnapshot).where(
                            WorkoutsExportSnapshot.id == row.snapshot_id
                        )
                    )
                    row.status, row.manifest = "expired", None

    async def recover_verified_death(self, evidence):
        """No public route. Default verifier refuses every operator assertion."""
        async with self.sessions.begin() as db:
            await self._fresh(db)
            slot = await self._slot(db)
            if slot.active_job_id is None:
                return False
            if not self.death_verifier.verify(slot.worker_identity, evidence):
                raise stopped("Verified worker termination evidence is required", 409)
            clock = await db.scalar(select(func.clock_timestamp()))
            row = await db.get(WorkoutsExportJob, slot.active_job_id)
            if row is not None:
                from app.models.identity import AppUser

                await db.scalar(
                    select(AppUser.id).where(AppUser.id == row.app_user_id).with_for_update()
                )
                row = await db.scalar(
                    select(WorkoutsExportJob)
                    .where(WorkoutsExportJob.id == row.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            if row is None or row.status != "ready" or slot.deadline_at <= clock:
                await db.execute(
                    delete(WorkoutsExportSnapshot).where(
                        WorkoutsExportSnapshot.id == slot.snapshot_id
                    )
                )
                if row is not None:
                    row.status = "expired" if slot.deadline_at <= clock else "failed"
                    row.failure_code = (
                        "deadline_exceeded" if slot.deadline_at <= clock else "interrupted"
                    )
                    row.manifest = None
                    if row.finished_at is None:
                        row.finished_at = clock
            await self._release(db, slot, "verified_operator", clock)
            return True

"""Rolling allowance receipts; no source, identity-provider or health context."""

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, union
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.automation_models import WorkoutImport
from app.domains.workouts.import_usage_models import WorkoutImportUsage
from app.domains.workouts.lifecycle import membership_for, now

ALLOWANCE_WINDOW = timedelta(hours=24)
RECEIPT_RETENTION = timedelta(hours=48)


async def usage_schema_present(db):
    # Compatibility for intentionally migration035-only unit/integration
    # fixtures. Enabled application startup MUST separately verify042.
    present = bool(
        await db.scalar(text("SELECT to_regclass('public.workouts_import_usage') IS NOT NULL"))
    )
    if not present and get_settings().environment != "test":
        raise HTTPException(503, "Import accounting is unavailable; try again later")
    return present


def usable_job_predicate():
    return WorkoutImport.status.in_(["ready", "incomplete"]) & WorkoutImport.result[
        "workout"
    ].astext.is_not(None)


async def enforce_import_allowance(db, owner, generation, request_id, *, limit=15):
    """Caller holds the AppUser write lock; count distinct reservations/charges."""
    current = now()
    durable = await usage_schema_present(db)
    if durable:
        prior = await db.get(WorkoutImportUsage, (owner, request_id), populate_existing=True)
        if prior and prior.charged_at > current - RECEIPT_RETENTION:
            raise HTTPException(
                410, "This completed import identity has expired; use a new request ID"
            )
    pending = select(WorkoutImport.request_id).where(
        WorkoutImport.app_user_id == owner,
        WorkoutImport.generation == generation,
        WorkoutImport.status.in_(["queued", "processing"]),
        WorkoutImport.expires_at > current,
    )
    if durable:
        charged = select(WorkoutImportUsage.request_id).where(
            WorkoutImportUsage.app_user_id == owner,
            WorkoutImportUsage.charged_at > current - ALLOWANCE_WINDOW,
        )
    else:
        charged = select(WorkoutImport.request_id).where(
            WorkoutImport.app_user_id == owner,
            WorkoutImport.generation == generation,
            WorkoutImport.updated_at > current - ALLOWANCE_WINDOW,
            usable_job_predicate(),
        )
    count = await db.scalar(select(func.count()).select_from(union(pending, charged).subquery()))
    if count >= limit:
        raise HTTPException(
            429, "Free beta includes 15 successful or pending imports per rolling day"
        )


async def charge_usable_import(db, job, result):
    """Stage a receipt in the SAME transaction as the usable job result.

    Never commits. Rechecks generation under the owner lock. Failed, cancelled,
    timed-out or incomplete captures without a workout carry no success charge.
    """
    if result.status not in {"ready", "incomplete"} or result.workout is None:
        return False
    await membership_for(db, job.app_user_id, generation=job.generation, write=True)
    if not await usage_schema_present(db):
        return False
    # Drop an expired tombstone before reusing its UUID; retained successful
    # UUIDs were rejected at admission, except safe current-job replay.
    await db.execute(
        delete(WorkoutImportUsage).where(
            WorkoutImportUsage.app_user_id == job.app_user_id,
            WorkoutImportUsage.request_id == job.request_id,
            WorkoutImportUsage.charged_at <= now() - RECEIPT_RETENTION,
        )
    )
    await db.execute(
        insert(WorkoutImportUsage)
        .values(app_user_id=job.app_user_id, request_id=job.request_id, charged_at=now())
        .on_conflict_do_nothing(index_elements=["app_user_id", "request_id"])
    )
    return True


async def purge_import_usage(db):
    """Bounded 48h accounting retention; called by the import worker sweep."""
    if await usage_schema_present(db):
        await db.execute(
            delete(WorkoutImportUsage).where(
                WorkoutImportUsage.charged_at <= now() - RECEIPT_RETENTION
            )
        )


async def verify_import_usage_schema(session_factory=AsyncSessionLocal, *, settings=None):
    """Enabled import readiness is fail-closed; fixture fallback is NOT readiness."""
    configured = settings or get_settings()
    if not (configured.workouts_api_enabled and configured.workouts_imports_enabled):
        return
    async with session_factory() as db:
        if not await db.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ):
            raise RuntimeError("Optional Workouts migration042 is missing")
        if not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=42)")
        ):
            raise RuntimeError("Optional Workouts migration042 is missing")
        columns = set(
            (
                await db.execute(
                    text("""SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='workouts_import_usage'""")
                )
            ).scalars()
        )
        if columns != {"app_user_id", "request_id", "charged_at"}:
            raise RuntimeError("Workouts import usage schema is incomplete")
        valid = await db.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_constraint c
            WHERE c.conrelid='public.workouts_import_usage'::regclass AND c.contype='f'
            AND c.confrelid='public.app_users'::regclass AND c.confdeltype='c'
            AND c.convalidated AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (app_user_id)%')
            AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.workouts_import_usage'::regclass
            AND c.contype='p' AND pg_get_constraintdef(c.oid)='PRIMARY KEY (app_user_id, request_id)')
            AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.workouts_import_usage'::regclass
            AND t.tgname='immutable_workouts_import_usage' AND t.tgenabled='O' AND NOT t.tgisinternal)""")
        )
        if not valid:
            raise RuntimeError("Workouts import usage invariants are incomplete")

"""Database-backed external cleanup worker for account and recipe deletion."""

import asyncio
import hashlib
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import sentry_sdk
from sqlalchemy import and_, func, or_, select, text

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.models.deletion import DeletionCleanupJob
from app.services.clerk import ClerkBackendClient
from app.services.storage import StorageCleanupError, storage_service

settings = get_settings()
TERMINAL_CLEANUP_STATUSES = frozenset({"completed", "failed"})
REQUIRED_TABLES = frozenset({"deletion_cleanup_jobs", "deleted_auth_identities"})
REQUIRED_JOB_COLUMNS = frozenset(
    {
        "kind",
        "app_user_id",
        "status",
        "clerk_identities",
        "storage_prefixes",
        "attempt_count",
        "max_attempts",
        "next_attempt_at",
        "lease_token",
        "leased_until",
        "last_error",
        "completed_at",
    }
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hash_auth_identity(issuer: str, clerk_user_id: str) -> str:
    """Hash a normalized issuer/subject pair for a non-reversible tombstone."""
    normalized_issuer = issuer.strip().rstrip("/").lower()
    return hashlib.sha256(
        f"{normalized_issuer}\0{clerk_user_id.strip()}".encode("utf-8")
    ).hexdigest()


def is_allowed_cleanup_prefix(prefix: str) -> bool:
    """Restrict durable cleanup to one recipe or one user's owned namespace."""
    if not isinstance(prefix, str) or not prefix or ".." in prefix:
        return False
    if prefix.startswith("thumbnails/") and prefix[-1:] in {".", "/"}:
        recipe_id = prefix.removeprefix("thumbnails/")[:-1]
        try:
            UUID(recipe_id)
        except (ValueError, TypeError):
            return False
        return True
    if prefix.startswith("chat-images/") and prefix.endswith("/"):
        user_id = prefix.removeprefix("chat-images/")[:-1]
        return bool(user_id and "/" not in user_id)
    return False


def capture_sanitized_cleanup_failure(error: Exception) -> None:
    """Report failure type without sending provider URLs or target identifiers."""
    sentry_sdk.capture_message(
        f"Deletion cleanup target failed: {type(error).__name__}",
        level="error",
    )


def apply_cleanup_claim(job: DeletionCleanupJob, now: datetime) -> None:
    """Claim an already locked cleanup row with a fenced lease."""
    job.status = "processing"
    job.lease_token = uuid4().hex
    job.leased_until = now + timedelta(seconds=settings.deletion_cleanup_lease_seconds)
    job.attempt_count = (job.attempt_count or 0) + 1
    job.next_attempt_at = None
    job.updated_at = now


def apply_cleanup_retry(job: DeletionCleanupJob, now: datetime, error: Exception) -> None:
    """Apply bounded exponential retry without storing credentials in errors."""
    job.lease_token = None
    job.leased_until = None
    job.updated_at = now
    job.last_error = type(error).__name__[:128]
    if job.attempt_count < job.max_attempts:
        delay_seconds = min(3600, 2 ** max(0, job.attempt_count - 1) * 15)
        job.status = "queued"
        job.next_attempt_at = now + timedelta(seconds=delay_seconds)
    else:
        job.status = "failed"
        job.next_attempt_at = None
        job.completed_at = now


def claimable_cleanup_query(now: datetime):
    """Build the cross-replica locking query for due and expired work."""
    return (
        select(DeletionCleanupJob)
        .where(
            or_(
                and_(
                    DeletionCleanupJob.status == "queued",
                    or_(
                        DeletionCleanupJob.next_attempt_at.is_(None),
                        DeletionCleanupJob.next_attempt_at <= now,
                    ),
                ),
                and_(
                    DeletionCleanupJob.status == "processing",
                    DeletionCleanupJob.leased_until < now,
                ),
            ),
            DeletionCleanupJob.attempt_count < DeletionCleanupJob.max_attempts,
        )
        .order_by(DeletionCleanupJob.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )


class DurableDeletionCleanupWorker:
    """Retry idempotent Clerk and object-storage deletion outside requests."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._wake_event = asyncio.Event()

    async def start(self) -> None:
        if not settings.deletion_cleanup_worker_enabled or (
            self._task and not self._task.done()
        ):
            return
        await self.verify_schema()
        self._task = asyncio.create_task(
            self._run(), name="durable-deletion-cleanup-worker"
        )

    async def verify_schema(self) -> None:
        """Fail startup before serving if migration 019 is absent."""
        async with AsyncSessionLocal() as db:
            table_result = await db.execute(
                text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_name IN ('deletion_cleanup_jobs', 'deleted_auth_identities')
                """)
            )
            existing_tables = set(table_result.scalars().all())
            column_result = await db.execute(
                text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'deletion_cleanup_jobs'
                """)
            )
            existing_columns = set(column_result.scalars().all())

        missing_tables = sorted(REQUIRED_TABLES - existing_tables)
        missing_columns = sorted(REQUIRED_JOB_COLUMNS - existing_columns)
        if missing_tables or missing_columns:
            details = []
            if missing_tables:
                details.append(f"missing tables: {', '.join(missing_tables)}")
            if missing_columns:
                details.append(f"missing columns: {', '.join(missing_columns)}")
            raise RuntimeError(
                "Migration 019 is required before enabling deletion cleanup; "
                + "; ".join(details)
            )

    async def stop(self) -> None:
        if not self._task:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    def wake(self) -> None:
        self._wake_event.set()

    async def _run(self) -> None:
        while True:
            try:
                self._wake_event.clear()
                job_id = await self.claim_next_job()
                if job_id:
                    await self.execute_claimed_job(job_id)
                    continue
                try:
                    await asyncio.wait_for(
                        self._wake_event.wait(),
                        timeout=settings.deletion_cleanup_poll_seconds,
                    )
                except asyncio.TimeoutError:
                    pass
            except asyncio.CancelledError:
                raise
            except Exception as error:
                sentry_sdk.capture_exception(error)
                await asyncio.sleep(settings.deletion_cleanup_poll_seconds)

    async def claim_next_job(self) -> UUID | None:
        now = utc_now()
        async with AsyncSessionLocal() as db:
            async with db.begin():
                terminal_result = await db.execute(
                    select(DeletionCleanupJob)
                    .where(
                        DeletionCleanupJob.status.in_(("queued", "processing")),
                        DeletionCleanupJob.attempt_count
                        >= DeletionCleanupJob.max_attempts,
                        or_(
                            DeletionCleanupJob.status == "queued",
                            DeletionCleanupJob.leased_until.is_(None),
                            DeletionCleanupJob.leased_until <= now,
                        ),
                    )
                    .with_for_update(skip_locked=True)
                )
                for exhausted_job in terminal_result.scalars().all():
                    exhausted_job.status = "failed"
                    exhausted_job.lease_token = None
                    exhausted_job.leased_until = None
                    exhausted_job.next_attempt_at = None
                    exhausted_job.last_error = "MaxAttemptsExceeded"
                    exhausted_job.completed_at = now
                    exhausted_job.updated_at = now

                result = await db.execute(claimable_cleanup_query(now))
                job = result.scalar_one_or_none()
                if not job:
                    return None
                apply_cleanup_claim(job, now)
                return job.id

    async def execute_claimed_job(self, job_id: UUID) -> None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DeletionCleanupJob).where(DeletionCleanupJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if not job or job.status != "processing" or not job.lease_token:
                return
            lease_token = job.lease_token
            clerk_identities = list(job.clerk_identities or [])
            storage_prefixes = list(job.storage_prefixes or [])

        try:
            failures = []
            for operation, targets in (
                (self._delete_storage_prefixes, storage_prefixes),
                (self._delete_clerk_identities, clerk_identities),
            ):
                try:
                    await operation(targets)
                except Exception as error:
                    failures.append(error)
                    capture_sanitized_cleanup_failure(error)
            if failures:
                raise RuntimeError("One or more external cleanup targets failed")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self.retry_or_fail(job_id, lease_token, error)
            return

        now = utc_now()
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DeletionCleanupJob)
                .where(
                    DeletionCleanupJob.id == job_id,
                    DeletionCleanupJob.status == "processing",
                    DeletionCleanupJob.lease_token == lease_token,
                )
                .with_for_update()
            )
            job = result.scalar_one_or_none()
            if not job:
                return
            job.status = "completed"
            job.clerk_identities = []
            job.storage_prefixes = []
            job.lease_token = None
            job.leased_until = None
            job.next_attempt_at = None
            job.last_error = None
            job.completed_at = now
            job.updated_at = now
            await db.commit()

    async def _delete_storage_prefixes(self, prefixes: list[str]) -> None:
        if any(not is_allowed_cleanup_prefix(prefix) for prefix in prefixes):
            raise ValueError("Invalid storage cleanup prefix")
        if prefixes and not storage_service.is_enabled:
            if settings.environment.lower() != "production":
                return
            raise StorageCleanupError("Object storage is not configured")
        failures = 0
        for prefix in prefixes:
            try:
                await storage_service.delete_prefix(prefix)
            except Exception as error:
                failures += 1
                capture_sanitized_cleanup_failure(error)
        if failures:
            raise StorageCleanupError(
                f"Unable to clean {failures} object-storage target(s)"
            )

    async def _delete_clerk_identities(self, identities: list[dict]) -> None:
        failures = 0
        for identity in identities:
            try:
                issuer = identity.get("issuer") if isinstance(identity, dict) else None
                subject = identity.get("clerk_user_id") if isinstance(identity, dict) else None
                if not issuer or not subject:
                    raise ValueError("Invalid Clerk cleanup identity")
                environment = settings.clerk_environment_for_issuer(issuer)
                if environment is None or not environment.secret_key:
                    raise RuntimeError("Clerk environment is unavailable")
                deleted = await ClerkBackendClient(
                    environment, timeout=20.0
                ).delete_user(subject)
                if not deleted:
                    raise RuntimeError("Clerk account deletion was not confirmed")
            except Exception as error:
                failures += 1
                capture_sanitized_cleanup_failure(error)
        if failures:
            raise RuntimeError(f"Unable to clean {failures} Clerk account target(s)")

    async def retry_or_fail(
        self, job_id: UUID, lease_token: str, error: Exception
    ) -> None:
        now = utc_now()
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DeletionCleanupJob)
                .where(
                    DeletionCleanupJob.id == job_id,
                    DeletionCleanupJob.status == "processing",
                    DeletionCleanupJob.lease_token == lease_token,
                )
                .with_for_update()
            )
            job = result.scalar_one_or_none()
            if not job or job.status in TERMINAL_CLEANUP_STATUSES:
                return
            apply_cleanup_retry(job, now, error)
            await db.commit()
        self.wake()

    async def queue_metrics(self) -> dict[str, int]:
        """Return bounded operational counts for admin diagnostics."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DeletionCleanupJob.status, func.count(DeletionCleanupJob.id))
                .group_by(DeletionCleanupJob.status)
            )
            return {status: count for status, count in result.all()}


deletion_cleanup_worker = DurableDeletionCleanupWorker()

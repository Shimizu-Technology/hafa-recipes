"""One consistent, encrypted private export; HTTP pages never hold a DB snapshot open."""

import asyncio
import hmac
import json
import os
from datetime import datetime, timedelta
from functools import wraps
from uuid import UUID, uuid4

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Response
from pydantic import Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.export_models import (
    EXPORT_TABLES,
    WorkoutsExportEpoch,
    WorkoutsExportPage,
    WorkoutsExportSnapshot,
)
from app.domains.workouts.lifecycle import membership_for, optional_table_exists
from app.domains.workouts.models import WorkoutsConsent, WorkoutsGrant
from app.domains.workouts.router import ExportResponse, export_data
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.sharing_service import sharing_key

PAGE_SIZE = 10
MAX_PAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_PAGES = 512
TTL_SECONDS = 600
BUILD_SECONDS = 120


class ExportManifest(DomainModel):
    id: UUID
    generation: int
    schema_version: int = 1
    created_at: datetime
    expires_at: datetime
    page_count: int
    page_size: int = PAGE_SIZE
    totals: dict[str, int]


class ExportSnapshotPage(DomainModel):
    snapshot_id: UUID
    page: int = Field(ge=0, lt=MAX_PAGES)
    page_count: int
    export: ExportResponse


def error(code, status=410):
    return HTTPException(status, code)


def redacted(function):
    @wraps(function)
    async def call(*args, **kwargs):
        try:
            return await function(*args, **kwargs)
        except (SQLAlchemyError, InvalidTag, ValueError, TypeError, UnicodeError, TimeoutError):
            # SQL/provider messages and private JSON/key material never reach clients.
            raise error("export_snapshot_unavailable", 503) from None

    return call


def export_key():
    try:
        key = sharing_key()
    except HTTPException:
        raise error("export_snapshot_not_configured", 503) from None
    # Explicit key reuse with a distinct cryptographic purpose, not sharing-token AAD.
    return hmac.digest(key, b"hafa-workouts:private-export:key:v1", "sha256")


def aad(snapshot, page):
    return f"hafa-workouts:private-export:v1:{snapshot.id}:{snapshot.app_user_id}:{snapshot.generation}:{page}".encode()


def seal(key, snapshot, page, content):
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, content, aad(snapshot, page))


def unseal(key, snapshot, page, ciphertext):
    return AESGCM(key).decrypt(ciphertext[:12], ciphertext[12:], aad(snapshot, page))


async def privacy_digest(db, owner, generation, key):
    grants = (
        await db.execute(
            select(WorkoutsGrant.scope, WorkoutsGrant.granted_at)
            .where(WorkoutsGrant.app_user_id == owner, WorkoutsGrant.generation == generation)
            .order_by(WorkoutsGrant.scope)
        )
    ).all()
    consent = await db.get(WorkoutsConsent, owner, populate_existing=True)
    epoch = await db.get(WorkoutsExportEpoch, (owner, generation), populate_existing=True)
    permissions = {
        "owner": owner,
        "generation": generation,
        "grants": [(scope, at.isoformat()) for scope, at in grants],
        "ai": consent.accepted_at.isoformat() if consent and consent.accepted_at else None,
        "epoch": epoch.revision if epoch else 0,
    }
    if await optional_table_exists(db, "workouts_health_connections"):
        from app.domains.workouts.health_models import HealthConnection

        permissions["health"] = [
            list(row)
            for row in (
                await db.execute(
                    select(
                        HealthConnection.provider,
                        HealthConnection.revision,
                        HealthConnection.connected,
                        HealthConnection.read_on_device,
                        HealthConnection.upload_to_server,
                        HealthConnection.use_for_ai,
                        HealthConnection.write_actuals,
                    )
                    .where(
                        HealthConnection.app_user_id == owner,
                        HealthConnection.generation == generation,
                    )
                    .order_by(HealthConnection.provider)
                )
            ).all()
        ]
    if await optional_table_exists(db, "workouts_recipe_grant_epochs"):
        permissions["recipes_epoch"] = await db.scalar(
            text("""SELECT revision FROM workouts_recipe_grant_epochs
        WHERE app_user_id=:owner AND generation=:generation"""),
            {"owner": owner, "generation": generation},
        )
    encoded = json.dumps(permissions, sort_keys=True, separators=(",", ":")).encode()
    return hmac.digest(key, encoded, "sha256")


async def invalidate_export_snapshots(db, owner, generation):
    """Caller holds AppUser lock; bump even during an invisible/in-progress RR build.

    Do not reset this epoch within a generation. Product erase may remove epochs
    only after advancing membership generation; global account deletion cascades.
    Optional schema checks allow legacy034-only fixtures. Does not commit.
    """
    if not await optional_table_exists(db, "workouts_export_snapshots"):
        return
    table = WorkoutsExportEpoch.__table__
    await db.execute(
        insert(table)
        .values(app_user_id=owner, generation=generation, revision=1)
        .on_conflict_do_update(
            index_elements=[table.c.app_user_id, table.c.generation],
            set_={"revision": table.c.revision + 1},
        )
    )
    await db.execute(
        delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.app_user_id == owner)
    )


async def erase_export_epochs_after_product_deletion(db, owner):
    """Only after generation++/status deleted, in the same owner-locked transaction."""
    if await optional_table_exists(db, "workouts_export_snapshots"):
        membership = await membership_for(db, owner, active=False)
        if membership.status != "deleted":
            raise RuntimeError("Advance deleted enrollment before removing export epochs")
        await db.execute(
            delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.app_user_id == owner)
        )
        await db.execute(
            delete(WorkoutsExportEpoch).where(WorkoutsExportEpoch.app_user_id == owner)
        )


async def cleanup_expired_exports(db, *, limit=100):
    """Bounded maintenance transaction; root schedules it or calls during admission."""
    if not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("Invalid export cleanup limit")
    ids = (
        select(WorkoutsExportSnapshot.id)
        .where(WorkoutsExportSnapshot.expires_at <= func.clock_timestamp())
        .order_by(WorkoutsExportSnapshot.expires_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return (
        await db.execute(delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.id.in_(ids)))
    ).rowcount


async def guard_projection_memory(db, owner, generation, limit, offset):
    """Count large projected fields in PG before asyncpg decodes JSON into RAM.

    Server-owned identifiers only. Raw capture payloads, tokens, cursors, and
    request hashes are deliberately absent. The half-page reserve accommodates
    wrapper metadata and JSON quoting; final encoded bounds still apply.
    """
    size = 0
    for table_name, fields in (
        ("workouts_library", ("content",)),
        ("workouts_library_versions", ("content",)),
        ("workouts_programs", ("content",)),
        ("workouts_program_versions", ("content",)),
        ("workouts_sessions", ("content",)),
        ("workouts_activities", ("content",)),
        ("workouts_import_jobs", ("result",)),
        ("workouts_proposals", ("content",)),
        ("workouts_coach_messages", ("user_message", "assistant_message", "proposals")),
        ("workouts_health_observations", ("content",)),
        ("workouts_shares", ("snapshot",)),
        ("workouts_copy_receipts", ("attribution",)),
    ):
        if not await optional_table_exists(db, table_name):
            continue
        expression = " + ".join(f"COALESCE(octet_length({field}::text),0)" for field in fields)
        size += await db.scalar(
            text(f"""SELECT COALESCE(SUM(size),0) FROM
            (SELECT {expression} AS size FROM {table_name}
             WHERE app_user_id=:owner AND generation=:generation
             ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset) selected"""),
            {"owner": owner, "generation": generation, "limit": limit, "offset": offset},
        )
        if size > MAX_PAGE_BYTES // 2:
            raise error("export_snapshot_too_large", 413)
    profile_size = await db.scalar(
        text("""SELECT COALESCE(octet_length(content::text),0)
    FROM workouts_profiles WHERE app_user_id=:owner AND generation=:generation"""),
        {"owner": owner, "generation": generation},
    )
    if size + (profile_size or 0) > MAX_PAGE_BYTES // 2:
        raise error("export_snapshot_too_large", 413)


async def approved_export_page(db, user, limit, offset):
    # Reuse the reviewed explicit projection, not arbitrary ORM/column dumps.
    # This handler does not commit; the service supplies one RR transaction.
    membership = await membership_for(db, user.id)
    await guard_projection_memory(db, user.id, membership.generation, limit, offset)
    return await export_data(Response(), user, db, limit=limit, offset=offset)


class PrivateExportService:
    def __init__(
        self, session_factory=AsyncSessionLocal, *, settings=None, page_source=approved_export_page
    ):
        self.sessions = session_factory
        self.settings = settings
        self.page_source = page_source

    def authorize(self, user, generation):
        configured = self.settings or get_settings()
        if not configured.workouts_api_enabled:
            raise error("Not found", 404)
        if (
            not configured.workouts_public_access_enabled
            and user.id not in configured.workouts_testers
        ):
            raise error("Workouts testing is not enabled for this account", 403)
        if type(generation) is not int or not 1 <= generation <= 2_147_483_647:
            raise error("Invalid Workouts generation", 422)
        # Mounts MUST use require_workouts_user; this service receives its verified
        # stable AppUser identity and never accepts owner IDs in request JSON.
        return export_key()

    @staticmethod
    async def _fresh(db):
        await db.connection(execution_options={"isolation_level": "READ COMMITTED"})
        await db.execute(text("SET LOCAL statement_timeout='15s'"))
        await db.execute(text("SET LOCAL lock_timeout='5s'"))

    async def _discard(self, snapshot_id, owner):
        async with self.sessions.begin() as db:
            await self._fresh(db)
            await db.execute(
                delete(WorkoutsExportSnapshot).where(
                    WorkoutsExportSnapshot.id == snapshot_id,
                    WorkoutsExportSnapshot.app_user_id == owner,
                )
            )

    @redacted
    async def create(self, user, generation):
        key = self.authorize(user, generation)
        snapshot_id = uuid4()
        async with self.sessions.begin() as db:
            await self._fresh(db)
            await membership_for(db, user.id, generation=generation, write=True)
            await cleanup_expired_exports(db)
            await db.execute(
                delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.app_user_id == user.id)
            )
            created = await db.scalar(select(func.clock_timestamp()))
            snapshot = WorkoutsExportSnapshot(
                id=snapshot_id,
                app_user_id=user.id,
                generation=generation,
                created_at=created,
                expires_at=created + timedelta(seconds=TTL_SECONDS),
                status="building",
                permission_digest=await privacy_digest(db, user.id, generation, key),
                page_count=0,
                byte_count=0,
            )
            db.add(snapshot)
        try:
            async with asyncio.timeout(BUILD_SECONDS):
                async with self.sessions() as db:
                    # Set before any statement/snapshot acquisition. Never reuse an
                    # HTTP dependency session with an already acquired RC snapshot.
                    await db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
                    await db.execute(text("SET LOCAL statement_timeout='15s'"))
                    await membership_for(db, user.id, generation=generation)
                    if not hmac.compare_digest(
                        snapshot.permission_digest,
                        await privacy_digest(db, user.id, generation, key),
                    ):
                        raise error("export_snapshot_unavailable")
                    totals, total_bytes = None, 0
                    for page in range(MAX_PAGES):
                        projected = await self.page_source(db, user, PAGE_SIZE, page * PAGE_SIZE)
                        projected.generated_at = created
                        if totals is None:
                            totals = projected.totals
                            if any(count > MAX_PAGES * PAGE_SIZE for count in totals.values()):
                                raise error("export_snapshot_too_large", 413)
                        elif totals != projected.totals:
                            raise error("export_snapshot_unavailable", 503)
                        content = projected.model_dump_json().encode()
                        total_bytes += len(content)
                        if len(content) > MAX_PAGE_BYTES or total_bytes > MAX_TOTAL_BYTES:
                            raise error("export_snapshot_too_large", 413)
                        db.add(
                            WorkoutsExportPage(
                                snapshot_id=snapshot_id,
                                page=page,
                                ciphertext=seal(key, snapshot, page, content),
                            )
                        )
                        await db.flush()
                        if not any(projected.has_more.values()):
                            break
                    else:
                        raise error("export_snapshot_too_large", 413)
                    await db.commit()
            # Fresh RC publication fences revocation/deletion that happened during
            # RR reads. The short owner lock is released before returning HTTP.
            async with self.sessions.begin() as db:
                await self._fresh(db)
                await membership_for(db, user.id, generation=generation, write=True)
                current = await db.get(WorkoutsExportSnapshot, snapshot_id)
                clock = await db.scalar(select(func.clock_timestamp()))
                if (
                    current is None
                    or current.expires_at <= clock
                    or not hmac.compare_digest(
                        current.permission_digest,
                        await privacy_digest(db, user.id, generation, key),
                    )
                ):
                    raise error("export_snapshot_unavailable")
                current.page_count = page + 1
                current.byte_count = total_bytes
                current.status = "ready"
                manifest = self._manifest(current, totals)
            return manifest
        except BaseException:
            # Cancellation also removes temporary private ciphertext; cleanup is
            # bounded. A cancelled cleanup rolls back; TTL maintenance retries.
            try:
                await asyncio.wait_for(self._discard(snapshot_id, user.id), 5)
            except (SQLAlchemyError, TimeoutError):
                pass
            raise

    @staticmethod
    def _manifest(snapshot, totals):
        return ExportManifest(
            id=snapshot.id,
            generation=snapshot.generation,
            created_at=snapshot.created_at,
            expires_at=snapshot.expires_at,
            page_count=snapshot.page_count,
            totals=totals,
        )

    @redacted
    async def read(self, user, generation, snapshot_id, *, page=None):
        key = self.authorize(user, generation)
        if not isinstance(snapshot_id, UUID) or (
            page is not None and (type(page) is not int or not 0 <= page < MAX_PAGES)
        ):
            raise error("Invalid export page", 422)
        failure = None
        async with self.sessions.begin() as db:
            await self._fresh(db)
            await membership_for(db, user.id, generation=generation, write=True)
            snapshot = await db.scalar(
                select(WorkoutsExportSnapshot).where(
                    WorkoutsExportSnapshot.id == snapshot_id,
                    WorkoutsExportSnapshot.app_user_id == user.id,
                    WorkoutsExportSnapshot.generation == generation,
                )
            )
            if snapshot is None:
                raise error("export_snapshot_unavailable", 404)
            clock = await db.scalar(select(func.clock_timestamp()))
            if snapshot.expires_at <= clock or not hmac.compare_digest(
                snapshot.permission_digest, await privacy_digest(db, user.id, generation, key)
            ):
                await db.execute(
                    delete(WorkoutsExportSnapshot).where(WorkoutsExportSnapshot.id == snapshot_id)
                )
                failure = error("export_snapshot_unavailable")
            elif snapshot.status != "ready":
                raise error("export_snapshot_not_ready", 409)
            elif page is not None and page >= snapshot.page_count:
                raise error("Invalid export page", 422)
            else:
                number = 0 if page is None else page
                stored = await db.get(WorkoutsExportPage, (snapshot.id, number))
                if stored is None:
                    raise error("export_snapshot_unavailable", 503)
                projected = ExportResponse.model_validate_json(
                    unseal(key, snapshot, number, stored.ciphertext)
                )
                result = (
                    self._manifest(snapshot, projected.totals)
                    if page is None
                    else ExportSnapshotPage(
                        snapshot_id=snapshot.id,
                        page=number,
                        page_count=snapshot.page_count,
                        export=projected,
                    )
                )
        if failure:
            raise failure
        return result

    @redacted
    async def remove(self, user, generation, snapshot_id):
        self.authorize(user, generation)
        if not isinstance(snapshot_id, UUID):
            raise error("Invalid export snapshot", 422)
        async with self.sessions.begin() as db:
            await self._fresh(db)
            await membership_for(db, user.id, generation=generation, write=True)
            await db.execute(
                delete(WorkoutsExportSnapshot).where(
                    WorkoutsExportSnapshot.id == snapshot_id,
                    WorkoutsExportSnapshot.app_user_id == user.id,
                    WorkoutsExportSnapshot.generation == generation,
                )
            )


async def verify_export_schema(engine, settings):
    if not settings.workouts_api_enabled:
        return
    async with engine.connect() as connection:
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=43)")
        ):
            raise RuntimeError("Workouts export migration043 is missing")
        for table in EXPORT_TABLES:
            columns = set(
                (
                    await connection.execute(
                        text("""SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=:name"""),
                        {"name": table.name},
                    )
                ).scalars()
            )
            if columns != set(table.columns.keys()):
                raise RuntimeError("Workouts export schema is incomplete")
        binary = dict(
            (
                await connection.execute(
                    text("""SELECT table_name,column_name
        FROM information_schema.columns WHERE table_schema='public'
        AND table_name IN ('workouts_export_pages','workouts_export_snapshots')
        AND data_type='bytea'""")
                )
            ).all()
        )
        if binary != {
            "workouts_export_pages": "ciphertext",
            "workouts_export_snapshots": "permission_digest",
        }:
            raise RuntimeError("Workouts exports must store ciphertext")
        cascades = set(
            (
                await connection.execute(
                    text("""SELECT child.relname,column_record.attname,parent.relname,parent_column.attname
        FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid
        JOIN pg_class parent ON parent.oid=c.confrelid
                        JOIN pg_attribute column_record ON column_record.attrelid=child.oid AND column_record.attnum=c.conkey[1]
                        JOIN pg_attribute parent_column ON parent_column.attrelid=parent.oid AND parent_column.attnum=c.confkey[1]
        JOIN pg_namespace ns ON ns.oid=child.relnamespace
        WHERE ns.nspname='public' AND c.contype='f' AND c.confdeltype='c' AND c.convalidated AND cardinality(c.conkey)=1
        AND child.relname IN ('workouts_export_epochs','workouts_export_snapshots','workouts_export_pages')""")
                )
            ).all()
        )
        if (
            not {
                ("workouts_export_epochs", "app_user_id", "app_users", "id"),
                ("workouts_export_snapshots", "app_user_id", "app_users", "id"),
                ("workouts_export_pages", "snapshot_id", "workouts_export_snapshots", "id"),
            }
            <= cascades
        ):
            raise RuntimeError("Workouts export deletion cascades are incomplete")
        triggers = set(
            (
                await connection.execute(
                    text("""SELECT relation.relname,trigger_record.tgname,fn.proname
        FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid=trigger_record.tgrelid
        JOIN pg_namespace ns ON ns.oid=relation.relnamespace
        JOIN pg_proc fn ON fn.oid=trigger_record.tgfoid
        WHERE ns.nspname='public' AND trigger_record.tgenabled <> 'D'
        AND NOT trigger_record.tgisinternal AND trigger_record.tgtype=19""")
                )
            ).all()
        )
        if (
            not {
                (
                    "workouts_export_pages",
                    "immutable_workouts_export_page",
                    "prevent_workouts_snapshot_update",
                ),
                (
                    "workouts_export_epochs",
                    "fence_workouts_export_epoch",
                    "fence_workouts_export_epoch",
                ),
            }
            <= triggers
        ):
            raise RuntimeError("Workouts export fences are incomplete")

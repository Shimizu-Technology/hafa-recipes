"""Private optional health API; no implicit upload, AI, or write authorization."""

from datetime import datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import AwareDatetime, Field, StrictBool, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser
from app.config import get_settings
from app.db import get_db
from app.domains.workouts.health_models import (
    HealthConnection,
    HealthExportIntent,
    HealthObservation,
)
from app.domains.workouts.health_service import (
    actual_for_export,
    apply_sync,
    connection_for,
    purge_imported,
    reconcile_snapshot,
    require_ai_disclosure,
    set_health_scopes,
)
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute, require_workouts_user

Provider = Literal["apple_health", "health_connect"]
User = Annotated[ClerkUser, Depends(require_workouts_user)]
Database = Annotated[AsyncSession, Depends(get_db)]
Generation = Annotated[int, Header(alias="X-Workouts-Generation", ge=1, le=2_147_483_647)]


class HealthRoute(WorkoutsRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def gated(request: Request):
            configured = get_settings()
            if not configured.workouts_api_enabled or not configured.workouts_health_sync_enabled:
                raise HTTPException(404, "Not found")
            return await original(request)

        return gated


router = APIRouter(
    prefix="/api/v1/workouts/health", tags=["workouts-health"], route_class=HealthRoute
)


class ConnectionRequest(DomainModel):
    expected_revision: int = Field(strict=True, ge=0, le=2_147_483_647)
    disclosure_version: int = Field(default=1, strict=True, ge=1, le=1)
    connected: StrictBool
    read_on_device: StrictBool = False
    upload_to_server: StrictBool = False
    use_for_ai: StrictBool = False
    write_actuals: StrictBool = False

    @model_validator(mode="after")
    def coherent(self):
        if not self.connected and any(
            (self.read_on_device, self.upload_to_server, self.use_for_ai, self.write_actuals)
        ):
            raise ValueError("Disconnected connections cannot retain permissions")
        if self.upload_to_server and not self.read_on_device:
            raise ValueError("Server upload requires a separate on-device read choice")
        if self.use_for_ai and not self.upload_to_server:
            raise ValueError("AI context requires separately permitted server upload")
        return self


class ConnectionResponse(DomainModel):
    provider: Provider
    generation: int
    revision: int
    connected: bool
    read_on_device: bool
    upload_to_server: bool
    use_for_ai: bool
    write_actuals: bool
    last_sync_at: datetime | None
    cursor: dict | None


def connection_response(row, provider, generation):
    return ConnectionResponse(
        provider=provider,
        generation=generation,
        revision=row.revision if row else 0,
        connected=row.connected if row else False,
        read_on_device=row.read_on_device if row else False,
        upload_to_server=row.upload_to_server if row else False,
        use_for_ai=row.use_for_ai if row else False,
        write_actuals=row.write_actuals if row else False,
        last_sync_at=row.last_sync_at if row else None,
        cursor=row.cursor if row else None,
    )


class Cursor(DomainModel):
    provider: Provider
    window_start: AwareDatetime
    window_end: AwareDatetime
    phase: Literal["bootstrap", "changes"]
    anchor: str | None = Field(default=None, max_length=4096)
    page_token: str | None = Field(default=None, max_length=4096)
    changes_token: str | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def window(self):
        if self.window_end <= self.window_start or self.window_end - self.window_start > timedelta(
            days=30
        ):
            raise ValueError("Cursor window must be positive and at most 30 days")
        return self


class Observation(DomainModel):
    source_id: str = Field(min_length=1, max_length=224)
    provider: Provider
    origin_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")
    started_at: AwareDatetime
    ended_at: AwareDatetime
    duration_seconds: float = Field(strict=True, gt=0, le=86400)
    duration_basis: Literal["provider_reported", "elapsed_interval"]
    activity_type: str = Field(min_length=1, max_length=80)
    updated_at: AwareDatetime | None = None
    ai_eligibility: Literal["unknown", "restricted"] = "unknown"
    possible_duplicate_of: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def actual_interval(self):
        elapsed = (self.ended_at - self.started_at).total_seconds()
        if elapsed <= 0 or self.duration_seconds > elapsed + 1:
            raise ValueError("Exercise duration must fit its actual interval")
        if any(len(value) > 224 for value in self.possible_duplicate_of):
            raise ValueError("Duplicate candidates exceed their identifier bound")
        return self


class SyncRequest(DomainModel):
    receipt_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    observations: list[Observation] = Field(default_factory=list, max_length=200)
    deleted_source_ids: list[str] = Field(default_factory=list, max_length=200)
    next_cursor: Cursor | None = None
    has_more: StrictBool = False
    reset_required: StrictBool = False

    @model_validator(mode="after")
    def deletion_ids(self):
        if any(not value or len(value) > 224 for value in self.deleted_source_ids):
            raise ValueError("Deleted identifiers exceed their bounds")
        return self


class ExportRequest(DomainModel):
    session_id: UUID
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)


class SnapshotRequest(DomainModel):
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    window_start: AwareDatetime
    window_end: AwareDatetime
    receipt_ids: list[UUID] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def window(self):
        if self.window_end <= self.window_start or self.window_end - self.window_start > timedelta(
            days=30
        ):
            raise ValueError("Snapshot window must be positive and at most 30 days")
        if len(set(self.receipt_ids)) != len(self.receipt_ids):
            raise ValueError("Snapshot receipt identifiers must be unique")
        return self


class ExportAcknowledgment(DomainModel):
    expected_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    status: Literal["written", "already_written", "unsupported"]
    source_id: str | None = Field(default=None, max_length=224)

    @model_validator(mode="after")
    def confirmed_source(self):
        if self.status != "unsupported" and not self.source_id:
            raise ValueError("A reported write requires the provider source identifier")
        return self


@router.get("/{provider}/connection", response_model=ConnectionResponse)
async def get_connection(provider: Provider, user: User, db: Database):
    membership = await membership_for(db, user.id)
    row = await db.scalar(
        select(HealthConnection).where(
            HealthConnection.app_user_id == user.id,
            HealthConnection.provider == provider,
            HealthConnection.generation == membership.generation,
        )
    )
    return connection_response(row, provider, membership.generation)


@router.put("/{provider}/connection", response_model=ConnectionResponse)
async def replace_connection(
    provider: Provider, request: ConnectionRequest, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await db.scalar(
        select(HealthConnection)
        .where(HealthConnection.app_user_id == user.id, HealthConnection.provider == provider)
        .execution_options(populate_existing=True)
    )
    if row is not None and row.generation != generation:
        raise HTTPException(409, "Health connection belongs to an older enrollment")
    revision = row.revision if row else 0
    if request.expected_revision != revision:
        raise HTTPException(409, "Health connection changed; refresh before changing permissions")
    if request.use_for_ai:
        await require_ai_disclosure(db, user.id, generation)
    if row is None:
        row = HealthConnection(
            app_user_id=user.id, provider=provider, generation=generation, revision=1
        )
        db.add(row)
    else:
        row.revision += 1
    if not request.connected or not request.upload_to_server:
        await purge_imported(db, user.id, generation, provider)
        row.cursor = row.last_sync_at = None
    for field in (
        "connected",
        "read_on_device",
        "upload_to_server",
        "use_for_ai",
        "write_actuals",
        "disclosure_version",
    ):
        setattr(row, field, getattr(request, field))
    row.updated_at = now()
    await db.flush()
    await set_health_scopes(db, user.id, generation)
    await db.commit()
    return connection_response(row, provider, generation)


@router.post("/{provider}/sync")
async def sync_page(
    provider: Provider, request: SyncRequest, user: User, db: Database, generation: Generation
):
    result = await apply_sync(db, user.id, generation, provider, request)
    await db.commit()
    return result


@router.post("/{provider}/reconcile")
async def reconcile(
    provider: Provider, request: SnapshotRequest, user: User, db: Database, generation: Generation
):
    result = await reconcile_snapshot(db, user.id, generation, provider, request)
    await db.commit()
    return result


@router.get("/{provider}/observations", response_model=list[Observation])
async def observations(
    provider: Provider,
    user: User,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    membership = await membership_for(db, user.id)
    await connection_for(db, user.id, provider, membership.generation, operation="sync")
    rows = list(
        (
            await db.scalars(
                select(HealthObservation)
                .where(
                    HealthObservation.app_user_id == user.id,
                    HealthObservation.provider == provider,
                    HealthObservation.generation == membership.generation,
                )
                .order_by(HealthObservation.created_at.desc(), HealthObservation.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
    )
    return [Observation.model_validate(row.content) for row in rows]


@router.post("/{provider}/exports")
async def prepare_export(
    provider: Provider, request: ExportRequest, user: User, db: Database, generation: Generation
):
    connection = await connection_for(
        db,
        user.id,
        provider,
        generation,
        revision=request.expected_revision,
        operation="export",
        write=True,
    )
    session, actual, reason = await actual_for_export(db, user.id, generation, request.session_id)
    if reason:
        return {"status": "unsupported", "message": reason, "actual": None, "intent_id": None}
    row = await db.scalar(
        select(HealthExportIntent).where(
            HealthExportIntent.app_user_id == user.id,
            HealthExportIntent.generation == generation,
            HealthExportIntent.provider == provider,
            HealthExportIntent.session_id == session.id,
            HealthExportIntent.connection_revision == connection.revision,
        )
    )
    if row is None:
        row = HealthExportIntent(
            id=uuid4(),
            app_user_id=user.id,
            generation=generation,
            provider=provider,
            connection_revision=connection.revision,
            session_id=session.id,
            canonical_session_id=actual["canonical_session_id"],
            session_revision=actual["revision"],
            actual=actual,
            status="prepared",
        )
        db.add(row)
    await db.commit()
    return {
        "status": "ready",
        "intent_id": str(row.id),
        "actual": row.actual,
        "provider_write_status": row.status,
        "source_id": row.source_id,
    }


@router.post("/{provider}/exports/{intent_id}/acknowledgment")
async def acknowledge_export(
    provider: Provider,
    intent_id: UUID,
    request: ExportAcknowledgment,
    user: User,
    db: Database,
    generation: Generation,
):
    connection = await connection_for(
        db,
        user.id,
        provider,
        generation,
        revision=request.expected_revision,
        operation="export",
        write=True,
    )
    row = await db.scalar(
        select(HealthExportIntent).where(
            HealthExportIntent.id == intent_id,
            HealthExportIntent.app_user_id == user.id,
            HealthExportIntent.generation == generation,
            HealthExportIntent.provider == provider,
        )
    )
    if row is None:
        raise HTTPException(404, "Owned export intent not found")
    if row.connection_revision != connection.revision:
        raise HTTPException(409, "Health write intent was prepared under older permission")
    if request.source_id and not request.source_id.startswith(provider + ":"):
        raise HTTPException(422, "Write receipt provider does not match")
    status = "reported_unsupported" if request.status == "unsupported" else "reported_written"
    if row.status != "prepared" and (row.status != status or row.source_id != request.source_id):
        raise HTTPException(409, "Write receipt conflicts with the previously reported outcome")
    row.status, row.source_id = status, request.source_id
    await db.commit()
    return {"intent_id": str(row.id), "status": row.status, "source_id": row.source_id}

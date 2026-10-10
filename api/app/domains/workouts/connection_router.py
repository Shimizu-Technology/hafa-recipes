"""Private opt-in connections plus explicit expiring workout/program links."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, StrictBool, model_validator
from sqlalchemy import select

from app.domains.workouts.connection_models import (
    RecipeConnectionReceipt,
    WorkoutCopyReceipt,
    WorkoutShare,
)
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.recipe_connections import RecipeConnectionContext, recipe_context
from app.domains.workouts.router import (
    Database,
    Generation,
    Limit,
    Offset,
    RecordResponse,
    User,
    owned_record,
    record_response,
)
from app.domains.workouts.schemas import DomainModel
from app.domains.workouts.security import WorkoutsRoute
from app.domains.workouts.sharing_service import (
    confirm_preview,
    copy_share,
    decrypt_token,
    make_preview,
    public_share,
)

router = APIRouter(
    prefix="/api/v1/workouts", tags=["workouts-connections"], route_class=WorkoutsRoute
)
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


@router.get("/connections/recipes", response_model=RecipeConnectionContext)
async def connected_recipes(
    user: User,
    db: Database,
    generation: Generation,
    purpose: Literal["view", "coach"] = "view",
    recipe_ids: Annotated[list[UUID] | None, Query(max_length=10)] = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    result = await recipe_context(
        db,
        user.id,
        generation,
        purpose=purpose,
        recipe_ids=recipe_ids or (),
        start_date=start_date,
        end_date=end_date,
    )
    await db.commit()
    return result


class ConnectionReceiptResponse(DomainModel):
    id: UUID
    purpose: Literal["view", "coach"]
    scopes: list[str]
    recipe_ids: list[UUID]
    meal_plan_ids: list[UUID]
    created_at: datetime


@router.get("/connections/receipts", response_model=list[ConnectionReceiptResponse])
async def connection_receipts(user: User, db: Database, limit: Limit = 20, offset: Offset = 0):
    membership = await membership_for(db, user.id)
    rows = (
        await db.scalars(
            select(RecipeConnectionReceipt)
            .where(
                RecipeConnectionReceipt.app_user_id == user.id,
                RecipeConnectionReceipt.generation == membership.generation,
            )
            .order_by(RecipeConnectionReceipt.created_at.desc(), RecipeConnectionReceipt.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [
        ConnectionReceiptResponse(
            id=row.id,
            purpose=row.purpose,
            scopes=row.scopes,
            recipe_ids=row.recipe_ids,
            meal_plan_ids=row.meal_plan_ids,
            created_at=row.created_at,
        )
        for row in rows
    ]


class SharePreviewRequest(DomainModel):
    kind: Literal["workout", "program"] = "workout"
    workout_id: UUID | None = None
    program_id: UUID | None = None
    expected_revision: int = Field(strict=True, ge=1)
    display_name: str = Field(default="Håfa member", min_length=1, max_length=80)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    include_source_url: StrictBool = False
    allow_incomplete: StrictBool = False
    expires_in_days: int = Field(default=7, strict=True, ge=1, le=30)

    @model_validator(mode="after")
    def validate_target(self):
        if self.kind == "workout" and (self.workout_id is None or self.program_id is not None):
            raise ValueError("Select one workout")
        if self.kind == "program" and (self.program_id is None or self.workout_id is not None):
            raise ValueError("Select one program")
        if not self.display_name.strip() or (self.title is not None and not self.title.strip()):
            raise ValueError("Public display names and titles cannot be blank")
        return self


class SharePreviewResponse(DomainModel):
    id: UUID
    generation: int
    preview_digest: str
    expires_at: datetime
    link_expires_at: datetime
    kind: Literal["workout", "program"]
    content: dict
    attribution: dict
    review_required: bool


class ShareConfirmRequest(DomainModel):
    preview_digest: Digest
    confirm_public_snapshot: StrictBool
    disclosure_version: int = Field(strict=True, ge=1, le=1)

    @model_validator(mode="after")
    def require_confirmation(self):
        if not self.confirm_public_snapshot:
            raise ValueError(
                "Review and explicitly confirm the public snapshot and copy/revocation policy"
            )
        return self


class PublicShareResponse(DomainModel):
    id: UUID
    expires_at: datetime
    snapshot_digest: str
    kind: Literal["workout", "program"]
    content: dict
    attribution: dict
    review_required: bool


def public_response(row):
    return PublicShareResponse(
        id=row.id,
        expires_at=row.expires_at,
        snapshot_digest=row.snapshot_digest,
        kind=row.kind,
        content=row.snapshot["content"],
        attribution=row.snapshot["attribution"],
        review_required=row.snapshot["review_required"],
    )


class OwnerShareResponse(PublicShareResponse):
    generation: int
    revoked_at: datetime | None
    api_path: str
    app_path: str
    website_path: str


def owner_response(row):
    token = decrypt_token(row)
    return OwnerShareResponse(
        **public_response(row).model_dump(),
        generation=row.generation,
        revoked_at=row.revoked_at,
        api_path=f"/api/v1/workouts/shared/{token}",
        app_path=f"hafaworkouts://shared/{token}",
        website_path=f"/shared/{token}",
    )


@router.post("/sharing/previews", response_model=SharePreviewResponse, status_code=201)
async def sharing_preview(
    request: SharePreviewRequest, user: User, db: Database, generation: Generation
):
    preview = await make_preview(db, user.id, generation, request)
    await db.commit()
    return SharePreviewResponse(
        id=preview.id,
        generation=generation,
        preview_digest=preview.snapshot_digest,
        expires_at=preview.expires_at,
        link_expires_at=preview.link_expires_at,
        **preview.snapshot,
    )


@router.post(
    "/sharing/previews/{preview_id}/confirm", response_model=OwnerShareResponse, status_code=201
)
async def sharing_confirm(
    preview_id: UUID, request: ShareConfirmRequest, user: User, db: Database, generation: Generation
):
    share = await confirm_preview(db, user.id, generation, preview_id, request.preview_digest)
    # Build the encrypted link response before committing, so crypto failures do
    # not publish a snapshot whose creator cannot retrieve its link.
    result = owner_response(share)
    await db.commit()
    return result


@router.get("/sharing", response_model=list[OwnerShareResponse])
async def list_shares(user: User, db: Database, limit: Limit = 20, offset: Offset = 0):
    membership = await membership_for(db, user.id)
    rows = (
        await db.scalars(
            select(WorkoutShare)
            .where(
                WorkoutShare.app_user_id == user.id,
                WorkoutShare.generation == membership.generation,
            )
            .order_by(WorkoutShare.created_at.desc(), WorkoutShare.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [owner_response(row) for row in rows]


@router.get("/sharing/{share_id}", response_model=OwnerShareResponse)
async def get_owner_share(share_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    return owner_response(
        await owned_record(db, WorkoutShare, share_id, user.id, membership.generation)
    )


class RevocationResponse(DomainModel):
    id: UUID
    revoked_at: datetime


@router.delete("/sharing/{share_id}", response_model=RevocationResponse)
async def revoke_share(share_id: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned_record(db, WorkoutShare, share_id, user.id, generation)
    await db.refresh(row, with_for_update=True)
    row.revoked_at = row.revoked_at or now()
    await db.commit()
    return RevocationResponse(id=row.id, revoked_at=row.revoked_at)


@router.get("/shared/{token}", response_model=PublicShareResponse)
async def view_shared(token: str, db: Database):
    return public_response(await public_share(db, token))


class CopyRequest(DomainModel):
    copy_request_id: UUID
    snapshot_digest: Digest
    acknowledge_not_personalized: StrictBool
    start_date: date | None = None

    @model_validator(mode="after")
    def acknowledge(self):
        if not self.acknowledge_not_personalized:
            raise ValueError("Review the shared content; copying does not personalize it")
        return self


class CopyReceiptResponse(DomainModel):
    id: UUID
    source_share_id: UUID
    attribution: dict
    created_at: datetime


class CopyResponse(DomainModel):
    kind: Literal["workout", "program"]
    record: RecordResponse
    receipt: CopyReceiptResponse


@router.post("/shared/{token}/copy", response_model=CopyResponse, status_code=201)
async def copy_shared(
    token: str,
    request: CopyRequest,
    response: Response,
    user: User,
    db: Database,
    generation: Generation,
):
    row, receipt, replayed = await copy_share(db, user.id, generation, token, request)
    await db.commit()
    if replayed:
        response.status_code = 200
    return CopyResponse(
        kind=receipt.kind,
        record=record_response(row),
        receipt=CopyReceiptResponse(
            id=receipt.id,
            source_share_id=receipt.share_id,
            attribution=receipt.attribution,
            created_at=receipt.created_at,
        ),
    )


@router.get("/sharing/copies/{record_id}", response_model=CopyReceiptResponse)
async def copied_attribution(record_id: UUID, user: User, db: Database):
    membership = await membership_for(db, user.id)
    receipt = await db.scalar(
        select(WorkoutCopyReceipt).where(
            WorkoutCopyReceipt.record_id == record_id,
            WorkoutCopyReceipt.app_user_id == user.id,
            WorkoutCopyReceipt.generation == membership.generation,
        )
    )
    if receipt is None:
        raise HTTPException(404, "Copy attribution not found")
    return CopyReceiptResponse(
        id=receipt.id,
        source_share_id=receipt.share_id,
        attribution=receipt.attribution,
        created_at=receipt.created_at,
    )

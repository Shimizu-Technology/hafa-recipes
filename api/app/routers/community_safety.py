"""Signed-in reporting and contributor-blocking endpoints."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.models.identity import AppUser
from app.models.moderation import ContentReport, UserBlock
from app.models.recipe import Recipe
from app.moderation import is_publicly_viewable, public_recipe_conditions
from app.public_identity import public_contributor_id

router = APIRouter(prefix="/api", tags=["community safety"])
MAX_OPEN_REPORTS_PER_USER = 50


class ReportCreate(BaseModel):
    target_type: Literal["recipe", "contributor"]
    recipe_id: UUID | None = None
    contributor_id: str | None = Field(default=None, min_length=10, max_length=80)
    category: Literal[
        "spam", "unsafe", "inappropriate", "copyright", "impersonation", "other"
    ]
    details: str | None = Field(default=None, max_length=1000)


class AppealCreate(BaseModel):
    target_type: Literal["recipe", "contributor"]
    recipe_id: UUID | None = None
    details: str = Field(min_length=10, max_length=1000)

    model_config = ConfigDict(str_strip_whitespace=True)


class ReportResponse(BaseModel):
    id: UUID
    target_type: str
    target_id: str | None
    category: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BlockedContributorResponse(BaseModel):
    contributor_id: str
    display_name: str
    created_at: datetime


class SafetyStatusResponse(BaseModel):
    account_moderation_status: Literal["active", "hidden"]


def _report_response(report: ContentReport) -> ReportResponse:
    target_id = (
        str(report.recipe_id)
        if report.target_type == "recipe" and report.recipe_id
        else public_contributor_id(report.target_user_id)
        if report.target_type == "contributor" and report.target_user_id
        else None
    )
    return ReportResponse(
        id=report.id,
        target_type=report.target_type,
        target_id=target_id,
        category=report.category,
        status=report.status,
        created_at=report.created_at,
    )


async def _resolve_contributor(
    db: AsyncSession,
    contributor_id: str,
    *,
    viewer_user_id: str | None,
    require_visible: bool,
) -> str | None:
    query = select(Recipe.user_id).where(Recipe.user_id.isnot(None)).distinct()
    if require_visible:
        query = query.where(*public_recipe_conditions(viewer_user_id))
    candidates = (await db.execute(query)).scalars().all()
    return next(
        (
            candidate
            for candidate in candidates
            if public_contributor_id(candidate) == contributor_id
        ),
        None,
    )


async def _ensure_report_capacity(db: AsyncSession, user_id: str) -> None:
    active_count = await db.scalar(
        select(func.count(ContentReport.id)).where(
            ContentReport.reporter_user_id == user_id,
            ContentReport.status.in_(("open", "reviewing")),
        )
    )
    if (active_count or 0) >= MAX_OPEN_REPORTS_PER_USER:
        raise HTTPException(
            status_code=429,
            detail="Please wait for existing reports to be reviewed before submitting more",
        )


@router.post("/reports", response_model=ReportResponse, status_code=201)
async def create_report(
    payload: ReportCreate,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Report a currently viewable recipe or contributor for moderator review."""
    recipe_id: UUID | None = None
    target_user_id: str | None = None
    if payload.target_type == "recipe":
        if payload.recipe_id is None or payload.contributor_id is not None:
            raise HTTPException(status_code=422, detail="Provide exactly one recipe target")
        recipe = await db.get(Recipe, payload.recipe_id)
        if (
            recipe is None
            or recipe.user_id == user.id
            or not await is_publicly_viewable(db, recipe, None)
        ):
            raise HTTPException(status_code=404, detail="Report target not found")
        recipe_id = recipe.id
    else:
        if payload.contributor_id is None or payload.recipe_id is not None:
            raise HTTPException(status_code=422, detail="Provide exactly one contributor target")
        target_user_id = await _resolve_contributor(
            db,
            payload.contributor_id,
            viewer_user_id=None,
            require_visible=True,
        )
        if target_user_id is None or target_user_id == user.id:
            raise HTTPException(status_code=404, detail="Report target not found")

    existing = await db.scalar(
        select(ContentReport).where(
            ContentReport.reporter_user_id == user.id,
            ContentReport.target_type == payload.target_type,
            ContentReport.recipe_id.is_(recipe_id)
            if recipe_id is None
            else ContentReport.recipe_id == recipe_id,
            ContentReport.target_user_id.is_(target_user_id)
            if target_user_id is None
            else ContentReport.target_user_id == target_user_id,
            ContentReport.category == payload.category,
            ContentReport.status.in_(("open", "reviewing")),
        )
    )
    if existing is not None:
        return _report_response(existing)
    await _ensure_report_capacity(db, user.id)

    report = ContentReport(
        reporter_user_id=user.id,
        target_type=payload.target_type,
        recipe_id=recipe_id,
        target_user_id=target_user_id,
        category=payload.category,
        details=payload.details.strip() if payload.details and payload.details.strip() else None,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return _report_response(report)


@router.get("/reports/mine", response_model=list[ReportResponse])
async def list_my_reports(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    result = await db.execute(
        select(ContentReport)
        .where(ContentReport.reporter_user_id == user.id)
        .order_by(ContentReport.created_at.desc())
        .limit(100)
    )
    return [_report_response(report) for report in result.scalars().all()]


@router.get("/safety/status", response_model=SafetyStatusResponse)
async def get_safety_status(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Return only the caller's appeal-relevant account state."""
    account = await db.get(AppUser, user.id)
    return SafetyStatusResponse(
        account_moderation_status=(account.moderation_status if account else "active")
    )


@router.post("/appeals", response_model=ReportResponse, status_code=201)
async def create_appeal(
    payload: AppealCreate,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Ask moderators to review a hold on the caller's recipe or account."""
    recipe_id: UUID | None = None
    target_user_id: str | None = None
    if payload.target_type == "recipe":
        if payload.recipe_id is None:
            raise HTTPException(status_code=422, detail="A recipe appeal requires recipe_id")
        recipe = await db.get(Recipe, payload.recipe_id)
        if (
            recipe is None
            or recipe.user_id != user.id
            or recipe.moderation_status != "hidden"
        ):
            raise HTTPException(status_code=404, detail="Appeal target not found")
        recipe_id = recipe.id
    else:
        if payload.recipe_id is not None:
            raise HTTPException(status_code=422, detail="Contributor appeals do not use recipe_id")
        account = await db.get(AppUser, user.id)
        if account is None or account.moderation_status != "hidden":
            raise HTTPException(status_code=404, detail="Appeal target not found")
        target_user_id = user.id

    target_conditions = [
        ContentReport.recipe_id.is_(None)
        if recipe_id is None
        else ContentReport.recipe_id == recipe_id,
        ContentReport.target_user_id.is_(None)
        if target_user_id is None
        else ContentReport.target_user_id == target_user_id,
    ]
    existing = await db.scalar(
        select(ContentReport).where(
            ContentReport.reporter_user_id == user.id,
            ContentReport.target_type == payload.target_type,
            ContentReport.category == "appeal",
            ContentReport.status.in_(("open", "reviewing")),
            *target_conditions,
        )
    )
    if existing is not None:
        return _report_response(existing)
    await _ensure_report_capacity(db, user.id)

    appeal = ContentReport(
        reporter_user_id=user.id,
        target_type=payload.target_type,
        recipe_id=recipe_id,
        target_user_id=target_user_id,
        category="appeal",
        details=payload.details,
    )
    db.add(appeal)
    await db.commit()
    await db.refresh(appeal)
    return _report_response(appeal)


@router.post(
    "/blocks/{contributor_id}",
    response_model=BlockedContributorResponse,
    status_code=201,
)
async def block_contributor(
    contributor_id: str,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    target_user_id = await _resolve_contributor(
        db,
        contributor_id,
        viewer_user_id=None,
        require_visible=False,
    )
    if target_user_id is None or target_user_id == user.id:
        raise HTTPException(status_code=404, detail="Contributor not found")

    existing = await db.scalar(
        select(UserBlock).where(
            UserBlock.blocker_user_id == user.id,
            UserBlock.blocked_user_id == target_user_id,
        )
    )
    block = existing or UserBlock(blocker_user_id=user.id, blocked_user_id=target_user_id)
    if existing is None:
        visible_recipe = await db.scalar(
            select(Recipe.id).where(
                Recipe.user_id == target_user_id,
                *public_recipe_conditions(None),
            )
        )
        if visible_recipe is None:
            raise HTTPException(status_code=404, detail="Contributor not found")
        db.add(block)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            block = await db.scalar(
                select(UserBlock).where(
                    UserBlock.blocker_user_id == user.id,
                    UserBlock.blocked_user_id == target_user_id,
                )
            )
            if block is None:
                raise
    display_name = await db.scalar(
        select(func.max(Recipe.extractor_display_name)).where(Recipe.user_id == target_user_id)
    )
    return BlockedContributorResponse(
        contributor_id=contributor_id,
        display_name=display_name or "Anonymous Chef",
        created_at=block.created_at,
    )


@router.delete("/blocks/{contributor_id}", status_code=204)
async def unblock_contributor(
    contributor_id: str,
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    target_user_id = await _resolve_contributor(
        db,
        contributor_id,
        viewer_user_id=None,
        require_visible=False,
    )
    block = None
    if target_user_id:
        block = await db.scalar(
            select(UserBlock).where(
                UserBlock.blocker_user_id == user.id,
                UserBlock.blocked_user_id == target_user_id,
            )
        )
    if block is not None:
        await db.delete(block)
        await db.commit()


@router.get("/blocks", response_model=list[BlockedContributorResponse])
async def list_blocked_contributors(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(
                UserBlock.blocked_user_id,
                UserBlock.created_at,
                func.max(Recipe.extractor_display_name).label("display_name"),
            )
            .outerjoin(Recipe, Recipe.user_id == UserBlock.blocked_user_id)
            .where(UserBlock.blocker_user_id == user.id)
            .group_by(UserBlock.blocked_user_id, UserBlock.created_at)
            .order_by(UserBlock.created_at.desc())
        )
    ).all()
    return [
        BlockedContributorResponse(
            contributor_id=public_contributor_id(row.blocked_user_id),
            display_name=row.display_name or "Anonymous Chef",
            created_at=row.created_at,
        )
        for row in rows
    ]

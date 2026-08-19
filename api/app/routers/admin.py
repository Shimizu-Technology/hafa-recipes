"""Focused administrator APIs for moderation and operational recovery."""

from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser
from app.config import get_settings
from app.db import get_db
from app.job_worker import ACTIVE_JOB_STATUSES, job_worker
from app.models.identity import AppUser
from app.models.moderation import AdminAuditEvent, ContentReport
from app.models.recipe import ExtractionJob, Recipe
from app.moderation import require_admin
from app.public_identity import public_contributor_id

router = APIRouter(prefix="/api/admin", tags=["admin"])
settings = get_settings()


class AdminReason(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    model_config = ConfigDict(str_strip_whitespace=True)


class RecipeModerationUpdate(AdminReason):
    moderation_status: Literal["active", "hidden"]
    is_featured: bool = False
    featured_order: int | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def validate_feature_state(self):
        if self.moderation_status == "hidden" and self.is_featured:
            raise ValueError("A hidden recipe cannot be featured")
        if self.is_featured != (self.featured_order is not None):
            raise ValueError("Featured recipes require an order; unfeatured recipes do not")
        return self


class ContributorModerationUpdate(AdminReason):
    moderation_status: Literal["active", "hidden"]


class ReportReviewUpdate(AdminReason):
    status: Literal["reviewing", "resolved", "dismissed"]


class AdminRecipePreview(BaseModel):
    id: UUID
    title: str
    contributor_id: str | None
    display_name: str
    source_type: str
    is_public: bool
    moderation_status: str
    is_featured: bool
    featured_order: int | None
    created_at: datetime


class AdminContributorPreview(BaseModel):
    contributor_id: str
    display_name: str
    moderation_status: str
    public_recipe_count: int
    hidden_recipe_count: int


class AdminReportResponse(BaseModel):
    id: UUID
    target_type: str
    target_id: str | None
    target_label: str
    category: str
    details: str | None
    status: str
    resolution_note: str | None
    created_at: datetime
    updated_at: datetime


class AdminJobResponse(BaseModel):
    id: UUID
    job_kind: str
    status: str
    source_host: str | None
    error_code: str | None
    attempt_count: int
    max_attempts: int
    created_at: datetime
    updated_at: datetime
    leased_until: datetime | None


class AdminAuditResponse(BaseModel):
    id: UUID
    actor_user_id: str
    action: str
    target_type: str
    target_id: str
    reason: str
    before_summary: dict
    after_summary: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminDashboardResponse(BaseModel):
    open_reports: int
    hidden_recipes: int
    hidden_contributors: int
    jobs_needing_attention: int
    recent_actions: list[AdminAuditResponse]


def _recipe_preview(recipe: Recipe) -> AdminRecipePreview:
    extracted = recipe.extracted or {}
    is_public = bool(recipe.is_public)
    return AdminRecipePreview(
        id=recipe.id,
        title=(extracted.get("title") or "Untitled recipe") if is_public else "Private recipe",
        contributor_id=(
            public_contributor_id(recipe.user_id) if is_public and recipe.user_id else None
        ),
        display_name=(recipe.extractor_display_name or "Anonymous Chef")
        if is_public
        else "Private contributor",
        source_type=recipe.source_type,
        is_public=is_public,
        moderation_status=recipe.moderation_status,
        is_featured=recipe.is_featured,
        featured_order=recipe.featured_order,
        created_at=recipe.created_at,
    )


def _job_response(job: ExtractionJob) -> AdminJobResponse:
    parsed = urlparse(job.url)
    source_host = parsed.hostname
    if job.job_kind == "reextract" or not source_host:
        source_host = None
    return AdminJobResponse(
        id=job.id,
        job_kind=job.job_kind,
        status=job.status,
        source_host=source_host,
        error_code=job.error_code,
        attempt_count=job.attempt_count,
        max_attempts=job.max_attempts,
        created_at=job.created_at,
        updated_at=job.updated_at,
        leased_until=job.leased_until,
    )


def _add_audit(
    db: AsyncSession,
    *,
    actor: ClerkUser,
    action: str,
    target_type: str,
    target_id: str,
    reason: str,
    before: dict,
    after: dict,
) -> None:
    db.add(
        AdminAuditEvent(
            actor_user_id=actor.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            reason=reason.strip(),
            before_summary=before,
            after_summary=after,
        )
    )


async def _resolve_admin_contributor(db: AsyncSession, contributor_id: str) -> str | None:
    candidates = (
        await db.execute(select(Recipe.user_id).where(Recipe.user_id.isnot(None)).distinct())
    ).scalars().all()
    return next(
        (
            candidate
            for candidate in candidates
            if public_contributor_id(candidate) == contributor_id
        ),
        None,
    )


def _stale_job_condition(now: datetime):
    return or_(
        and_(
            ExtractionJob.status.in_(("claimed", "processing")),
            ExtractionJob.leased_until < now,
        ),
        and_(
            ExtractionJob.status == "queued",
            ExtractionJob.updated_at < now - timedelta(minutes=15),
            or_(
                ExtractionJob.next_attempt_at.is_(None),
                ExtractionJob.next_attempt_at <= now,
            ),
        ),
    )


@router.get("/dashboard", response_model=AdminDashboardResponse)
async def admin_dashboard(
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    del admin
    now = datetime.now(timezone.utc)
    open_reports = await db.scalar(
        select(func.count(ContentReport.id)).where(
            ContentReport.status.in_(("open", "reviewing"))
        )
    )
    hidden_recipes = await db.scalar(
        select(func.count(Recipe.id)).where(Recipe.moderation_status == "hidden")
    )
    hidden_contributors = await db.scalar(
        select(func.count(AppUser.id)).where(AppUser.moderation_status == "hidden")
    )
    jobs_needing_attention = await db.scalar(
        select(func.count(ExtractionJob.id)).where(
            or_(
                ExtractionJob.status.in_(("failed", "expired")),
                _stale_job_condition(now),
            )
        )
    )
    recent = (
        await db.execute(
            select(AdminAuditEvent).order_by(AdminAuditEvent.created_at.desc()).limit(10)
        )
    ).scalars().all()
    return {
        "open_reports": open_reports or 0,
        "hidden_recipes": hidden_recipes or 0,
        "hidden_contributors": hidden_contributors or 0,
        "jobs_needing_attention": jobs_needing_attention or 0,
        "recent_actions": [AdminAuditResponse.model_validate(item) for item in recent],
    }


@router.get("/recipes", response_model=list[AdminRecipePreview])
async def admin_recipe_search(
    q: str = Query(default="", max_length=100),
    moderation_status: Literal["all", "active", "hidden"] = "all",
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    del admin
    # Moderation search is intentionally public-metadata-only. Private recipe
    # content, source text, personal notes, and chat data never enter this view.
    query = select(Recipe).where(Recipe.is_public.is_(True))
    if q.strip():
        query = query.where(func.lower(Recipe.extracted["title"].astext).like(f"%{q.lower()}%"))
    if moderation_status != "all":
        query = query.where(Recipe.moderation_status == moderation_status)
    recipes = (
        await db.execute(query.order_by(Recipe.created_at.desc()).limit(limit))
    ).scalars().all()
    return [_recipe_preview(recipe) for recipe in recipes]


@router.put("/recipes/{recipe_id}/moderation", response_model=AdminRecipePreview)
async def moderate_recipe(
    recipe_id: UUID,
    payload: RecipeModerationUpdate,
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    recipe = await db.scalar(
        select(Recipe).where(Recipe.id == recipe_id).with_for_update()
    )
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if not recipe.is_public:
        if recipe.moderation_status != "hidden":
            raise HTTPException(status_code=404, detail="Recipe not found")
        if payload.moderation_status != "active" or payload.is_featured:
            raise HTTPException(
                status_code=409,
                detail="A private recipe can only have an existing moderation hold cleared",
            )
    before = {
        "moderation_status": recipe.moderation_status,
        "is_featured": recipe.is_featured,
        "featured_order": recipe.featured_order,
    }
    recipe.moderation_status = payload.moderation_status
    recipe.moderation_updated_at = datetime.now(timezone.utc)
    recipe.is_featured = payload.is_featured
    recipe.featured_order = payload.featured_order
    after = {
        "moderation_status": recipe.moderation_status,
        "is_featured": recipe.is_featured,
        "featured_order": recipe.featured_order,
    }
    _add_audit(
        db,
        actor=admin,
        action="recipe_moderation_updated",
        target_type="recipe",
        target_id=str(recipe.id),
        reason=payload.reason,
        before=before,
        after=after,
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="That featured position is already in use",
        ) from None
    await db.refresh(recipe)
    return _recipe_preview(recipe)


@router.get("/contributors", response_model=list[AdminContributorPreview])
async def admin_contributor_search(
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    del admin
    query = (
        select(
            Recipe.user_id,
            func.max(Recipe.extractor_display_name).label("display_name"),
            AppUser.moderation_status,
            func.count(Recipe.id).filter(Recipe.is_public.is_(True)).label("public_count"),
            func.count(Recipe.id)
            .filter(Recipe.moderation_status == "hidden")
            .label("hidden_count"),
        )
        .join(AppUser, AppUser.id == Recipe.user_id)
        .where(Recipe.user_id.isnot(None), Recipe.is_public.is_(True))
        .group_by(Recipe.user_id, AppUser.moderation_status)
    )
    if q.strip():
        query = query.where(Recipe.extractor_display_name.ilike(f"%{q.strip()}%"))
    rows = (
        await db.execute(query.order_by(func.count(Recipe.id).desc()).limit(limit))
    ).all()
    return [
        AdminContributorPreview(
            contributor_id=public_contributor_id(row.user_id),
            display_name=row.display_name or "Anonymous Chef",
            moderation_status=row.moderation_status,
            public_recipe_count=row.public_count,
            hidden_recipe_count=row.hidden_count,
        )
        for row in rows
    ]


@router.put(
    "/contributors/{contributor_id}/moderation",
    response_model=AdminContributorPreview,
)
async def moderate_contributor(
    contributor_id: str,
    payload: ContributorModerationUpdate,
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    target_user_id = await _resolve_admin_contributor(db, contributor_id)
    if target_user_id is None:
        raise HTTPException(status_code=404, detail="Contributor not found")
    contributor = await db.scalar(
        select(AppUser).where(AppUser.id == target_user_id).with_for_update()
    )
    if contributor is None:
        raise HTTPException(status_code=404, detail="Contributor not found")
    before = {"moderation_status": contributor.moderation_status}
    contributor.moderation_status = payload.moderation_status
    contributor.moderation_updated_at = datetime.now(timezone.utc)
    after = {"moderation_status": contributor.moderation_status}
    _add_audit(
        db,
        actor=admin,
        action="contributor_moderation_updated",
        target_type="contributor",
        target_id=contributor_id,
        reason=payload.reason,
        before=before,
        after=after,
    )
    await db.commit()

    counts = (
        await db.execute(
            select(
                func.max(Recipe.extractor_display_name),
                func.count(Recipe.id).filter(Recipe.is_public.is_(True)),
                func.count(Recipe.id).filter(Recipe.moderation_status == "hidden"),
            ).where(Recipe.user_id == target_user_id)
        )
    ).one()
    return AdminContributorPreview(
        contributor_id=contributor_id,
        display_name=counts[0] or "Anonymous Chef",
        moderation_status=contributor.moderation_status,
        public_recipe_count=counts[1],
        hidden_recipe_count=counts[2],
    )


async def _report_response(db: AsyncSession, report: ContentReport) -> AdminReportResponse:
    target_id: str | None
    target_label: str
    if report.target_type == "recipe":
        target_id = str(report.recipe_id) if report.recipe_id else None
        recipe = await db.get(Recipe, report.recipe_id) if report.recipe_id else None
        target_label = (
            (recipe.extracted or {}).get("title", "Untitled recipe")
            if recipe is not None and recipe.is_public
            else "Unavailable recipe"
        )
    else:
        target_id = (
            public_contributor_id(report.target_user_id) if report.target_user_id else None
        )
        target_label = "Contributor"
        if report.target_user_id:
            target_label = (
                await db.scalar(
                    select(func.max(Recipe.extractor_display_name)).where(
                        Recipe.user_id == report.target_user_id,
                        Recipe.is_public.is_(True),
                    )
                )
                or "Contributor"
            )
    return AdminReportResponse(
        id=report.id,
        target_type=report.target_type,
        target_id=target_id,
        target_label=target_label,
        category=report.category,
        details=report.details,
        status=report.status,
        resolution_note=report.resolution_note,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


@router.get("/reports", response_model=list[AdminReportResponse])
async def admin_reports(
    status: Literal["all", "open", "reviewing", "resolved", "dismissed"] = "open",
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    del admin
    query = select(ContentReport)
    if status == "open":
        query = query.where(ContentReport.status.in_(("open", "reviewing")))
    elif status != "all":
        query = query.where(ContentReport.status == status)
    reports = (
        await db.execute(query.order_by(ContentReport.created_at.asc()).limit(limit))
    ).scalars().all()
    return [await _report_response(db, report) for report in reports]


@router.put("/reports/{report_id}", response_model=AdminReportResponse)
async def review_report(
    report_id: UUID,
    payload: ReportReviewUpdate,
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    report = await db.scalar(
        select(ContentReport).where(ContentReport.id == report_id).with_for_update()
    )
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    before = {"status": report.status}
    report.status = payload.status
    report.resolution_note = payload.reason.strip()
    report.reviewed_by = admin.id
    report.resolved_at = (
        datetime.now(timezone.utc) if payload.status in ("resolved", "dismissed") else None
    )
    after = {"status": report.status}
    _add_audit(
        db,
        actor=admin,
        action="report_status_updated",
        target_type="report",
        target_id=str(report.id),
        reason=payload.reason,
        before=before,
        after=after,
    )
    await db.commit()
    await db.refresh(report)
    return await _report_response(db, report)


@router.get("/jobs", response_model=list[AdminJobResponse])
async def admin_jobs(
    status: Literal["attention", "failed", "expired", "stale", "all"] = "attention",
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    del admin
    now = datetime.now(timezone.utc)
    query = select(ExtractionJob)
    stale = _stale_job_condition(now)
    if status == "attention":
        query = query.where(
            or_(ExtractionJob.status.in_(("failed", "expired")), stale)
        )
    elif status == "stale":
        query = query.where(stale)
    elif status != "all":
        query = query.where(ExtractionJob.status == status)
    jobs = (
        await db.execute(query.order_by(ExtractionJob.updated_at.desc()).limit(limit))
    ).scalars().all()
    return [_job_response(job) for job in jobs]


@router.post("/jobs/{job_id}/retry", response_model=AdminJobResponse)
async def retry_job(
    job_id: UUID,
    payload: AdminReason,
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    job = await db.scalar(
        select(ExtractionJob).where(ExtractionJob.id == job_id).with_for_update()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("failed", "expired"):
        raise HTTPException(status_code=409, detail="Only failed or expired jobs can be retried")
    if not job.user_id:
        raise HTTPException(status_code=409, detail="This legacy job has no owner")
    if job.job_kind == "reextract" and (
        not job.target_recipe_id or await db.get(Recipe, job.target_recipe_id) is None
    ):
        raise HTTPException(status_code=409, detail="The target recipe no longer exists")

    before = {
        "status": job.status,
        "error_code": job.error_code,
        "attempt_count": job.attempt_count,
    }
    now = datetime.now(timezone.utc)
    job.status = "queued"
    job.progress = 0
    job.current_step = "queued"
    job.message = "Queued for administrator-approved retry"
    job.error_message = None
    job.error_code = None
    job.attempt_count = 0
    job.next_attempt_at = now
    job.expires_at = now + timedelta(hours=settings.job_expiry_hours)
    job.completed_at = None
    job.lease_token = None
    job.leased_until = None
    job.heartbeat_at = None
    job.updated_at = now
    after = {"status": job.status, "error_code": None, "attempt_count": 0}
    _add_audit(
        db,
        actor=admin,
        action="extraction_job_retried",
        target_type="extraction_job",
        target_id=str(job.id),
        reason=payload.reason,
        before=before,
        after=after,
    )
    await db.commit()
    await db.refresh(job)
    job_worker.wake()
    return _job_response(job)


@router.post("/jobs/{job_id}/cancel", response_model=AdminJobResponse)
async def cancel_job(
    job_id: UUID,
    payload: AdminReason,
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    job = await db.scalar(
        select(ExtractionJob).where(ExtractionJob.id == job_id).with_for_update()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ACTIVE_JOB_STATUSES | {"failed", "expired"}:
        raise HTTPException(
            status_code=409,
            detail="Only active, failed, or expired jobs can be cancelled",
        )
    before = {"status": job.status, "attempt_count": job.attempt_count}
    now = datetime.now(timezone.utc)
    job.status = "cancelled"
    job.current_step = "cancelled"
    job.message = "Extraction cancelled by an administrator"
    job.completed_at = now
    job.next_attempt_at = None
    job.lease_token = None
    job.leased_until = None
    job.updated_at = now
    after = {"status": job.status, "attempt_count": job.attempt_count}
    _add_audit(
        db,
        actor=admin,
        action="extraction_job_cancelled",
        target_type="extraction_job",
        target_id=str(job.id),
        reason=payload.reason,
        before=before,
        after=after,
    )
    await db.commit()
    await db.refresh(job)
    return _job_response(job)


@router.get("/audit", response_model=list[AdminAuditResponse])
async def admin_audit_history(
    action: str | None = Query(default=None, max_length=48),
    target_id: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: ClerkUser = Depends(require_admin),
):
    del admin
    query = select(AdminAuditEvent)
    if action:
        query = query.where(AdminAuditEvent.action == action)
    if target_id:
        query = query.where(AdminAuditEvent.target_id == target_id)
    events = (
        await db.execute(query.order_by(AdminAuditEvent.created_at.desc()).limit(limit))
    ).scalars().all()
    return list(events)

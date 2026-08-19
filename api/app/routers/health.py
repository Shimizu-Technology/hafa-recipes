"""Health check endpoint."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_governance import ai_usage_metrics
from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.db import get_db
from app.deletion_cleanup import deletion_cleanup_worker
from app.job_worker import job_worker
from app.models.schemas import DiagnosticResponse, HealthResponse

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/up", response_model=HealthResponse)
@router.get("/health", response_model=HealthResponse)
async def liveness_check():
    """Report only whether the API process can serve requests."""
    return HealthResponse()


@router.get("/api/admin/diagnostics", response_model=DiagnosticResponse)
async def dependency_diagnostics(
    db: AsyncSession = Depends(get_db),
    user: ClerkUser = Depends(get_current_user),
):
    """Return bounded dependency diagnostics to authenticated admins only."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        await db.execute(text("SELECT 1"))
        db_status = "connected"
        job_queue = await job_worker.queue_metrics()
        deletion_cleanup_queue = await deletion_cleanup_worker.queue_metrics()
        ai_usage = await ai_usage_metrics(db)
    except Exception:
        db_status = "unavailable"
        job_queue = {}
        deletion_cleanup_queue = {}
        ai_usage = {}

    dependencies = {
        "database": db_status,
        "object_storage": "configured" if settings.s3_enabled else "not_configured",
        "openai": "configured" if bool(settings.openai_api_key) else "not_configured",
    }
    return DiagnosticResponse(
        status="healthy" if db_status == "connected" else "degraded",
        environment=settings.environment,
        dependencies=dependencies,
        disabled_ai_capabilities=sorted(settings.disabled_ai_capability_set),
        job_queue=job_queue,
        deletion_cleanup_queue=deletion_cleanup_queue,
        ai_usage=ai_usage,
    )


@router.get("/sentry-debug")
async def trigger_error():
    """
    Test endpoint to verify Sentry is working.
    Triggers a division by zero error that gets captured by Sentry.
    
    Only use for testing - will throw an error!
    """
    if settings.environment.lower() != "development" and not settings.enable_sentry_debug:
        raise HTTPException(status_code=404, detail="Not found")

    raise RuntimeError("Sentry debug test error")

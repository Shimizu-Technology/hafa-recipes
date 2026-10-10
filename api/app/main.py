"""Håfa API - shared FastAPI platform with compatible Recipes surfaces."""

import logging

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai_governance import verify_ai_governance_schema
from app.config import get_settings
from app.cover_jobs import cover_job_worker
from app.database_invariants import verify_database_invariants
from app.deletion_cleanup import deletion_cleanup_worker
from app.domains.workouts.activity_log_router import router as workouts_activity_log_router
from app.domains.workouts.automation_router import imports_router as workouts_imports_router
from app.domains.workouts.automation_router import router as workouts_automation_router
from app.domains.workouts.automation_runtime import verify_automation_schema
from app.domains.workouts.budget_router import router as workouts_budget_router
from app.domains.workouts.coach import workout_coach
from app.domains.workouts.coach_router import router as workouts_coach_router
from app.domains.workouts.coach_router import send_router as workouts_coach_send_router
from app.domains.workouts.connection_router import router as workouts_connections_router
from app.domains.workouts.connection_runtime import verify_connections_schema
from app.domains.workouts.export_router import read_router as workouts_export_read_router
from app.domains.workouts.export_router import router as workouts_export_router
from app.domains.workouts.health_router import router as workouts_health_router
from app.domains.workouts.import_usage_service import verify_import_usage_schema
from app.domains.workouts.imports import workout_import_worker
from app.domains.workouts.library_organization_router import router as workouts_library_router
from app.domains.workouts.measurement_router import router as workouts_measurements_router
from app.domains.workouts.optional_runtime import verify_optional_workouts_schema
from app.domains.workouts.privacy import (
    WorkoutsAccessLogFilter,
    redact_workouts_event,
    redact_workouts_transaction,
)
from app.domains.workouts.router import router as workouts_router
from app.domains.workouts.runtime import verify_workouts_schema
from app.domains.workouts.source_planning import compose_coach_sources
from app.grocery_sync import verify_grocery_sync_schema
from app.job_worker import job_worker
from app.moderation import verify_moderation_schema
from app.request_context import RequestContextMiddleware
from app.request_limits import PastedTextBodyLimitMiddleware
from app.routers import (
    admin_router,
    chat_router,
    clerk_transition_router,
    collections_router,
    community_safety_router,
    cooking_chat_router,
    extract_router,
    grocery_router,
    grocery_widget_router,
    health_router,
    meal_plans_router,
    pantry_router,
    recipes_router,
    share_import_router,
    tts_router,
    users_router,
)
from app.routers.platform import router as platform_router
from app.widget_credentials import verify_widget_credential_schema

settings = get_settings()
logging.getLogger("uvicorn.access").addFilter(WorkoutsAccessLogFilter())

# Initialize Sentry for error monitoring
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        # Performance monitoring (20% sample - cost-effective for production)
        traces_sample_rate=0.2,
        # Profiling (10% sample)
        profiles_sample_rate=0.1,
        enable_tracing=True,
        # Don't send PII
        send_default_pii=False,
        before_send=redact_workouts_event,
        before_send_transaction=redact_workouts_transaction,
    )
    print(f"📊 Sentry initialized for {settings.environment}")
else:
    print("📊 Sentry not configured (no SENTRY_DSN)")

# Create FastAPI app
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description="Transform cooking videos into structured recipes with AI",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware - browser callers only. React Native does not require CORS.
allowed_origins = settings.allowed_cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials="*" not in allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "ETag", "X-Workouts-Revision"],
)
app.add_middleware(PastedTextBodyLimitMiddleware)

app.add_middleware(RequestContextMiddleware)


# Include routers
app.include_router(health_router)
app.include_router(platform_router)
app.include_router(workouts_library_router)
app.include_router(workouts_measurements_router)
app.include_router(workouts_router)
app.include_router(workouts_automation_router)
app.include_router(workouts_imports_router)
app.include_router(workouts_connections_router)
app.include_router(workouts_health_router)
app.include_router(workouts_coach_router)
app.include_router(workouts_coach_send_router)
app.include_router(workouts_budget_router)
app.include_router(workouts_export_router)
app.include_router(workouts_export_read_router)
app.include_router(workouts_activity_log_router)
workout_coach.compose_library_program = compose_coach_sources
app.include_router(admin_router)
app.include_router(recipes_router)
app.include_router(extract_router)
app.include_router(grocery_router)
app.include_router(pantry_router)
app.include_router(grocery_widget_router)
app.include_router(share_import_router)
app.include_router(chat_router)
app.include_router(clerk_transition_router)
app.include_router(cooking_chat_router)
app.include_router(users_router)
app.include_router(collections_router)
app.include_router(community_safety_router)
app.include_router(meal_plans_router)
app.include_router(tts_router)


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        # This legacy discovery field is consumed by released clients. Shared
        # branding lives in OpenAPI and the versioned platform registry.
        "name": "Recipe Extractor API",
        "version": settings.api_version,
        "docs": "/docs",
        "health": "/up",
    }


# Startup/shutdown events
@app.on_event("startup")
async def startup():
    """Run on application startup."""
    print(f"🚀 {settings.api_title} v{settings.api_version}")
    print(f"📍 Environment: {settings.environment}")
    print("📚 Docs: http://localhost:8000/docs")
    await verify_database_invariants()
    await verify_ai_governance_schema()
    print("AI governance schema ready")
    await verify_moderation_schema()
    print("Moderation schema ready")
    await verify_grocery_sync_schema()
    print("Grocery synchronization schema ready")
    await verify_widget_credential_schema()
    print("Grocery widget credential schema ready")
    await verify_workouts_schema()
    await verify_automation_schema()
    await verify_connections_schema()
    await verify_optional_workouts_schema()
    await verify_import_usage_schema()
    await job_worker.start()
    await workout_import_worker.start()
    await cover_job_worker.start()
    await deletion_cleanup_worker.start()


@app.on_event("shutdown")
async def shutdown():
    """Run on application shutdown."""
    await workout_import_worker.stop()
    await cover_job_worker.stop()
    await deletion_cleanup_worker.stop()
    await job_worker.stop()
    print("👋 Shutting down Håfa API")

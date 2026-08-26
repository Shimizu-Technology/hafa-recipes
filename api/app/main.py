"""Recipe Extractor API - FastAPI Application."""

import re
from uuid import uuid4

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.ai_governance import ai_request_context, verify_ai_governance_schema
from app.config import get_settings
from app.database_invariants import verify_database_invariants
from app.deletion_cleanup import deletion_cleanup_worker
from app.grocery_sync import verify_grocery_sync_schema
from app.job_worker import job_worker
from app.moderation import verify_moderation_schema
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
    recipes_router,
    tts_router,
    users_router,
)
from app.widget_credentials import verify_widget_credential_schema

settings = get_settings()

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
)
app.add_middleware(PastedTextBodyLimitMiddleware)

SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@app.middleware("http")
async def attach_request_context(request: Request, call_next):
    """Trace requests without trusting or logging arbitrary header content."""

    supplied = request.headers.get("x-request-id", "")
    request_id = supplied if SAFE_REQUEST_ID.fullmatch(supplied) else uuid4().hex
    with ai_request_context(request_id=request_id, route=request.url.path):
        response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

# Include routers
app.include_router(health_router)
app.include_router(admin_router)
app.include_router(recipes_router)
app.include_router(extract_router)
app.include_router(grocery_router)
app.include_router(grocery_widget_router)
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
        "name": settings.api_title,
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
    await job_worker.start()
    await deletion_cleanup_worker.start()


@app.on_event("shutdown")
async def shutdown():
    """Run on application shutdown."""
    await deletion_cleanup_worker.stop()
    await job_worker.stop()
    print("👋 Shutting down Recipe Extractor API")

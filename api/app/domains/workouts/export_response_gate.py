"""One cross-replica private export GET through the final ASGI response send."""

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import JSONResponse

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.security import WorkoutsRoute

# Separate from build/decrypt IDs: creation never holds this response slot.
RESPONSE_LOCK = 73400432
GUARD_SECONDS = 2
RESPONSE_SECONDS = 30
logger = logging.getLogger(__name__)


class ExportReadRoute(WorkoutsRoute):
    """Mount only snapshot/page GETs; keep normal verified auth dependencies."""

    session_factory = AsyncSessionLocal

    @staticmethod
    async def close_guard(db):
        if db is not None:
            try:
                await asyncio.wait_for(db.close(), GUARD_SECONDS)
            except (SQLAlchemyError, TimeoutError, OSError):
                logger.warning("Private export response guard cleanup unavailable")

    async def handle(self, scope, receive, send):
        started = False

        async def private_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message = dict(message)
                message["headers"] = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"cache-control"
                ] + [(b"cache-control", b"no-store")]
            await send(message)

        if scope.get("method") not in {"GET", "HEAD"} or not get_settings().workouts_api_enabled:
            # The ordinary WorkoutsRoute gate returns disabled404 before auth/DB.
            return await super().handle(scope, receive, private_send)
        db = None
        try:
            try:
                async with asyncio.timeout(GUARD_SECONDS):
                    db = self.session_factory()
                    await db.connection(execution_options={"isolation_level": "READ COMMITTED"})
                    await db.execute(text("SET LOCAL statement_timeout='2s'"))
                    # Bound an orphaned server-side transaction after connection
                    # loss; normal cancellation/error closes and rolls back now.
                    await db.execute(text("SET LOCAL idle_in_transaction_session_timeout='35s'"))
                    admitted = await db.scalar(
                        text("SELECT pg_try_advisory_xact_lock(:slot)"), {"slot": RESPONSE_LOCK}
                    )
            except (SQLAlchemyError, TimeoutError, OSError):
                await self.close_guard(db)
                db = None
                await JSONResponse(
                    {"detail": "export_snapshot_unavailable"},
                    status_code=503,
                    headers={"Cache-Control": "no-store"},
                )(scope, receive, send)
                return
            if not admitted:
                await self.close_guard(db)
                db = None
                await JSONResponse(
                    {"detail": "export_snapshot_busy"},
                    status_code=429,
                    headers={"Retry-After": "2", "Cache-Control": "no-store"},
                )(scope, receive, send)
                return
            # Starlette Route.handle calls its request app, which runs auth,
            # decryption, FastAPI serialization, and Response's final body send.
            # Holding this transaction also bounds bodies waiting on backpressure.
            # A timeout after response-start intentionally aborts the incomplete
            # download; it must never append a second JSON error to private bytes.
            try:
                async with asyncio.timeout(RESPONSE_SECONDS):
                    await super().handle(scope, receive, private_send)
            except TimeoutError:
                if started:
                    raise
                await JSONResponse(
                    {"detail": "export_snapshot_unavailable"},
                    status_code=503,
                    headers={"Cache-Control": "no-store"},
                )(scope, receive, send)
        finally:
            await self.close_guard(db)

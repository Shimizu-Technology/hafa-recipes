"""Gate the optional product before authentication, parsing, or database work."""

import asyncio
import threading

from fastapi import Depends, HTTPException, Request
from fastapi.routing import APIRoute
from starlette.responses import JSONResponse

from app.auth import ClerkUser, get_current_user
from app.config import get_settings

MAX_BODY_BYTES = 256 * 1024
# Shared by all bulk routes in this process, not by replicas. No waiting bodies.
_import_ingress = threading.Lock()
IMPORT_INGRESS_SECONDS = 60


class WorkoutsRoute(APIRoute):
    max_body_bytes = MAX_BODY_BYTES

    def get_route_handler(self):
        original = super().get_route_handler()

        async def bounded_handler(request: Request):
            if not get_settings().workouts_api_enabled:
                raise HTTPException(404, "Not found")
            # Bounded receive also covers chunked clients lacking Content-Length.
            if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                content_length = request.headers.get("content-length")
                if content_length is not None:
                    if not content_length.isdecimal():
                        raise HTTPException(400, "Invalid Content-Length")
                    if len(content_length) > 10 or int(content_length) > self.max_body_bytes:
                        raise HTTPException(413, "Workouts request exceeds the size limit")
                chunks = []
                total = 0
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > self.max_body_bytes:
                        raise HTTPException(413, "Workouts request exceeds the size limit")
                    chunks.append(chunk)
                # Starlette's body cache lets FastAPI perform its normal JSON
                # validation after the bounded receive, without reading twice.
                request._body = b"".join(chunks)
            response = await original(request)
            response.headers["Cache-Control"] = "no-store"
            return response

        return bounded_handler


async def require_workouts_user(
    request: Request, user: ClerkUser = Depends(get_current_user)
) -> ClerkUser:
    settings = get_settings()
    if not settings.workouts_api_enabled:
        raise HTTPException(404, "Not found")
    expected_owner = request.headers.get("X-Hafa-Account-ID")
    if expected_owner is not None and expected_owner != user.id:
        raise HTTPException(409, "Hafa account changed; refresh before using this request")
    if not settings.workouts_public_access_enabled and user.id not in settings.workouts_testers:
        raise HTTPException(403, "Workouts testing is not enabled for this account")
    return user


class WorkoutsImportRoute(WorkoutsRoute):
    # Native capture resizes images before transmission. Other private endpoints
    # retain their smaller account/content cap; imports admit bounded image/PDF data.
    max_body_bytes = 3 * 1024 * 1024

    async def handle(self, scope, receive, send):
        if (
            scope.get("method") not in {"POST", "PUT", "PATCH", "DELETE"}
            or not get_settings().workouts_api_enabled
        ):
            # Preserve disabled404 before parsing/auth/DB, even while another upload runs.
            return await super().handle(scope, receive, send)
        if not _import_ingress.acquire(blocking=False):
            await JSONResponse(
                {"detail": "workouts_import_busy"},
                status_code=429,
                headers={"Retry-After": "2", "Cache-Control": "no-store"},
            )(scope, receive, send)
            return
        started = False

        async def tracked_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            # Include final ASGI send: do not admit another body while the current
            # request/JSON graph is retained behind handler or response backpressure.
            deadline = asyncio.timeout(IMPORT_INGRESS_SECONDS)
            try:
                async with deadline:
                    await super().handle(scope, receive, tracked_send)
            except TimeoutError:
                if not deadline.expired():
                    raise  # An unrelated handler timeout keeps its original meaning.
                if started:
                    # Abort partial response; never append another JSON/status to it.
                    raise
                await JSONResponse(
                    {"detail": "workouts_import_timeout"},
                    status_code=408,
                    headers={"Retry-After": "2", "Cache-Control": "no-store"},
                )(scope, receive, send)
        finally:
            _import_ingress.release()

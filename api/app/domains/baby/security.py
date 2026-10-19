"""Private optional routes with pre-parse body bounds and no cached responses."""

import asyncio
import threading

from fastapi import Depends, HTTPException, Request
from fastapi.routing import APIRoute
from starlette.responses import JSONResponse

from app.auth import ClerkUser, get_current_user
from app.config import get_settings


class BabyRoute(APIRoute):
    max_body_bytes = 512 * 1024

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            if not getattr(get_settings(), "baby_api_enabled", False):
                raise HTTPException(404, "Not found")
            if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
                length = request.headers.get("content-length")
                if length and (
                    not length.isdecimal() or len(length) > 10 or int(length) > self.max_body_bytes
                ):
                    raise HTTPException(413, "Choose a smaller upload")
                total, chunks = 0, []
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > self.max_body_bytes:
                        raise HTTPException(413, "Choose a smaller upload")
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            response = await original(request)
            response.headers["Cache-Control"] = "private, no-store"
            return response

        return handler


_upload_ingress = threading.Lock()


class BabyUploadRoute(BabyRoute):
    max_body_bytes = 26 * 1024 * 1024

    async def handle(self, scope, receive, send):
        if not getattr(get_settings(), "baby_api_enabled", False):
            return await super().handle(scope, receive, send)
        if not _upload_ingress.acquire(blocking=False):
            await JSONResponse(
                {"detail": "Another file is uploading; try again shortly"},
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
            async with asyncio.timeout(90):
                await super().handle(scope, receive, tracked_send)
        except TimeoutError:
            if started:
                raise
            await JSONResponse({"detail": "Upload took too long; please retry"}, status_code=408)(
                scope, receive, send
            )
        finally:
            _upload_ingress.release()


async def require_baby_user(request: Request, user: ClerkUser = Depends(get_current_user)):
    expected = request.headers.get("X-Hafa-Account-ID")
    if expected is not None and expected != user.id:
        raise HTTPException(409, "Account changed; reopen Baby before saving")
    return user

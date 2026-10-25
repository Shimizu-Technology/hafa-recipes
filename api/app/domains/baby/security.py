"""Private optional routes with pre-parse body bounds and no cached responses."""

import asyncio
import threading
from contextlib import AsyncExitStack

from fastapi import Depends, HTTPException, Request
from fastapi.dependencies.utils import get_dependant, solve_dependencies
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse

from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.domains.workouts.privacy import PrivateFailureRoute


class BabyRoute(PrivateFailureRoute):
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


# Per-owner admission prevents one caller from monopolizing all process slots.
# The process cap also bounds concurrent multipart buffers to four uploads.
_upload_ingress = threading.Lock()
_upload_owners: set[str] = set()
MAX_CONCURRENT_UPLOADS = 4
UPLOAD_TIMEOUT_SECONDS = 90


async def authenticate_upload(request: Request, overrides_provider):
    """Resolve the existing auth graph without parsing or consuming a body.

    Use the same issuer verification, stable-owner resolution, account fence,
    and test dependency overrides as the endpoint. Keep auth sessions scoped to
    this preflight; the endpoint still runs its normal dependency chain.
    """

    async def identity(user: ClerkUser = Depends(require_baby_user)):
        return user

    async with AsyncExitStack() as stack:
        # FastAPI's dependency solver expects these request/function lifetimes.
        auth_scope = {
            **request.scope,
            "fastapi_inner_astack": stack,
            "fastapi_function_astack": stack,
        }
        solved = await solve_dependencies(
            request=Request(auth_scope),
            dependant=get_dependant(path=request.url.path, call=identity),
            dependency_overrides_provider=overrides_provider,
            async_exit_stack=stack,
            embed_body_fields=False,
        )
        if solved.errors:
            raise RequestValidationError(solved.errors)
        return solved.values["user"]


class BabyUploadRoute(BabyRoute):
    max_body_bytes = 26 * 1024 * 1024

    async def handle(self, scope, receive, send):
        if not getattr(get_settings(), "baby_api_enabled", False):
            return await super().handle(scope, receive, send)
        request = Request(scope)
        user = await authenticate_upload(request, self.dependency_overrides_provider or request.app)
        with _upload_ingress:
            admitted = (
                user.id not in _upload_owners and len(_upload_owners) < MAX_CONCURRENT_UPLOADS
            )
            if admitted:
                _upload_owners.add(user.id)
        if not admitted:
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
            async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
                await super().handle(scope, receive, tracked_send)
        except TimeoutError:
            if started:
                raise
            await JSONResponse({"detail": "Upload took too long; please retry"}, status_code=408)(
                scope, receive, send
            )
        finally:
            with _upload_ingress:
                _upload_owners.remove(user.id)


async def require_baby_user(request: Request, user: ClerkUser = Depends(get_current_user)):
    expected = request.headers.get("X-Hafa-Account-ID")
    if expected is not None and expected != user.id:
        raise HTTPException(409, "Account changed; reopen Baby before saving")
    return user

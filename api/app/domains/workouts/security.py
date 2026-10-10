"""Gate the optional product before authentication, parsing, or database work."""

from fastapi import Depends, HTTPException, Request
from fastapi.routing import APIRoute

from app.auth import ClerkUser, get_current_user
from app.config import get_settings

MAX_BODY_BYTES = 256 * 1024


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

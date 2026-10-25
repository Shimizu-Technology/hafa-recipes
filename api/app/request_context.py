"""Request tracing without buffering responses or shortening route guards."""

import re
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.ai_governance import ai_request_context
from app.domains.workouts.privacy import report_private_failure

SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class RequestContextMiddleware:
    """Keep the original ASGI send chain through streaming and backpressure.

    BaseHTTPMiddleware's call_next relays responses through an intermediate
    channel. A route can then finish while the outer network send still retains
    its body, releasing export/import admission and deadlines too early.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = Headers(scope=scope).get("x-request-id", "")
        request_id = supplied if SAFE_REQUEST_ID.fullmatch(supplied) else uuid4().hex

        reported = False

        def report(status):
            nonlocal reported
            if reported:
                return
            reported = True
            try:
                report_private_failure(scope, status)
            except Exception:
                # Diagnostics must never replace the original response/failure.
                pass

        async def send_with_context(message: Message) -> None:
            if message["type"] == "http.response.start":
                if message["status"] >= 400:
                    report(message["status"])
                message = dict(message)
                message["headers"] = list(message.get("headers", []))
                headers = MutableHeaders(scope=message)
                if scope["path"].startswith("/api/v1/workouts"):
                    headers["Cache-Control"] = "no-store"
                headers["X-Request-ID"] = request_id
            await send(message)

        with ai_request_context(request_id=request_id, route=scope["path"]):
            try:
                await self.app(scope, receive, send_with_context)
            except Exception as error:
                scope["private_failure_code"] = "timeout" if isinstance(error, TimeoutError) else "unexpected_error"
                report(500)
                raise

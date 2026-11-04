"""Shared endpoint dependencies, without router registration side effects."""

from typing import Annotated

from fastapi import Depends, Header, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser
from app.db import get_db
from app.domains.baby.security import require_baby_user

User = Annotated[ClerkUser, Depends(require_baby_user)]
Database = Annotated[AsyncSession, Depends(get_db)]
# Only clients that send 2 understand the kinds added after build 32.
Client = Annotated[str | None, Header(alias="X-Baby-Client")]
Generation = Annotated[int, Header(alias="X-Baby-Generation", ge=1, le=2_147_483_647)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=1000000)]


async def request_access(request: Request, user: User, db: Database):
    from app.domains.baby.access import access_for, family_enabled

    return await access_for(
        db,
        user.id,
        client=request.headers.get("X-Baby-Client"),
        space_id=request.headers.get("X-Baby-Space"),
        write=request.method in {"POST", "PATCH", "PUT", "DELETE"} or (
            not family_enabled() and getattr(request.scope.get("route"), "name", None) in {"get_attachment", "get_import"}
        ),
    )


Access = Annotated[object, Depends(request_access)]

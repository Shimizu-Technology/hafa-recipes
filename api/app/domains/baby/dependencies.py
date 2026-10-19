"""Shared endpoint dependencies, without router registration side effects."""

from typing import Annotated

from fastapi import Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser
from app.db import get_db
from app.domains.baby.security import require_baby_user

User = Annotated[ClerkUser, Depends(require_baby_user)]
Database = Annotated[AsyncSession, Depends(get_db)]
Generation = Annotated[int, Header(alias="X-Baby-Generation", ge=1, le=2_147_483_647)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=1000000)]

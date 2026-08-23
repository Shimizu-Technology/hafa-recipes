"""Server-side trust boundary for public recipe mutations."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.identity import AppUser

PUBLISHING_DISCLOSURE_VERSION = 1


async def require_current_publishing_disclosure(
    db: AsyncSession,
    user_id: str,
) -> None:
    """Lock the account and reject a public write without current acceptance.

    The row lock is intentionally held by the caller's transaction until its
    recipe write commits. This prevents disclosure acceptance and publication
    from being checked in separate, raceable transactions.
    """

    result = await db.execute(
        select(AppUser)
        .where(AppUser.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    app_user = result.scalar_one_or_none()
    if app_user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if (app_user.publishing_disclosure_version or 0) < PUBLISHING_DISCLOSURE_VERSION:
        raise HTTPException(
            status_code=409,
            detail="Accept the current publishing disclosure before sharing recipes",
        )

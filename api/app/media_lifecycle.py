"""Cross-process serialization for recipe media writes and deletion."""

import hashlib
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.models.recipe import Recipe


def recipe_media_lock_key(recipe_id: str | UUID) -> int:
    """Map a recipe UUID to PostgreSQL's signed 64-bit advisory-lock space."""
    normalized = UUID(str(recipe_id))
    digest = hashlib.sha256(normalized.bytes).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


async def acquire_recipe_media_lock(
    db: AsyncSession,
    recipe_id: str | UUID,
) -> None:
    """Hold the recipe's media lock until the caller's transaction ends."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": recipe_media_lock_key(recipe_id)},
    )


@asynccontextmanager
async def recipe_media_upload_guard(recipe_id: str | UUID):
    """Serialize an S3 write with deletion and reject deleted recipes."""
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await acquire_recipe_media_lock(db, recipe_id)
            result = await db.execute(select(Recipe.id).where(Recipe.id == recipe_id))
            yield result.scalar_one_or_none() is not None

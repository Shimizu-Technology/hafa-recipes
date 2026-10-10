"""Eight private synthetic recipes for real storage media-lock verification."""

import asyncio
from uuid import UUID

from capacity.safety import OWNERS, ensure
from capacity.transport import recipe

ensure()

from app.db.database import AsyncSessionLocal, engine
from app.models.recipe import Recipe
from app.models.schemas import RecipeExtracted


async def seed():
    async with AsyncSessionLocal.begin() as db:
        for index in range(1, 9):
            content = recipe()
            content["sourceUrl"] = ""
            RecipeExtracted.model_validate(content)
            db.add(
                Recipe(
                    id=UUID(int=100_000 + index),
                    user_id=OWNERS[0],
                    source_url=f"manual://capacity-legal-{index}",
                    source_type="manual",
                    is_public=False,
                    extracted=content,
                )
            )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())

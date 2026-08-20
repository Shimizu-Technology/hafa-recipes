"""Create an idempotent local schema and safe synthetic starter recipe."""

import asyncio
import importlib

from sqlalchemy import select

from app.config import get_settings
from app.db.database import AsyncSessionLocal, Base, engine
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import Recipe

SEED_USER_ID = "development_seed_user"
SEED_SOURCE_URL = "manual://development-seed/chamorro-red-rice"


async def seed() -> None:
    settings = get_settings()
    if settings.environment != "development":
        raise RuntimeError("Development seed is only allowed when ENVIRONMENT=development")
    if settings.allow_remote_database_in_development:
        raise RuntimeError("Development seed refuses the remote-database override")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    # create_all gives a new developer the base schema; the tracked migrations
    # add the same named invariants and verification markers production requires.
    migration_20 = importlib.import_module("migrations.020_add_database_invariants")
    migration_21 = importlib.import_module("migrations.021_add_ai_invocation_provenance")
    migration_22 = importlib.import_module("migrations.022_add_admin_moderation")
    await migration_20.run_migration()
    await migration_21.run_migration()
    await migration_22.run_migration()

    async with AsyncSessionLocal() as session:
        user = await session.get(AppUser, SEED_USER_ID)
        if user is None:
            session.add(AppUser(id=SEED_USER_ID))

        existing = await session.scalar(
            select(Recipe).where(Recipe.source_url == SEED_SOURCE_URL)
        )
        if existing is None:
            session.add(
                Recipe(
                    source_url=SEED_SOURCE_URL,
                    source_type="manual",
                    extraction_method="manual",
                    extraction_quality="high",
                    user_id=SEED_USER_ID,
                    extractor_display_name="Håfa Recipes",
                    is_public=True,
                    extracted={
                        "title": "Development Chamorro Red Rice",
                        "sourceUrl": SEED_SOURCE_URL,
                        "servings": 6,
                        "times": {"prep": "10 min", "cook": "30 min", "total": "40 min"},
                        "components": [
                            {
                                "name": "Main",
                                "ingredients": [
                                    {"name": "rice", "quantity": "2", "unit": "cups"},
                                    {"name": "achiote water", "quantity": "3", "unit": "cups"},
                                ],
                                "steps": [
                                    "Rinse the rice.",
                                    "Cook with achiote water until tender.",
                                ],
                            }
                        ],
                        "ingredients": [
                            {"name": "rice", "quantity": "2", "unit": "cups"},
                            {"name": "achiote water", "quantity": "3", "unit": "cups"},
                        ],
                        "steps": [
                            "Rinse the rice.",
                            "Cook with achiote water until tender.",
                        ],
                        "tags": ["Guam", "Side dish"],
                        "notes": "Synthetic local seed data. Not a production recipe.",
                    },
                )
            )
        elif not existing.extracted.get("sourceUrl"):
            # Keep existing developer databases compatible when the response
            # contract gains a required field.
            existing.extracted = {
                **existing.extracted,
                "sourceUrl": SEED_SOURCE_URL,
            }
        await session.commit()

    print("Local schema ready; synthetic development recipe is available in Discover.")


if __name__ == "__main__":
    asyncio.run(seed())

"""Create an idempotent local schema and safe synthetic starter recipe."""

import asyncio
from argparse import ArgumentParser

from sqlalchemy import select

from app.config import get_settings
from app.db.database import AsyncSessionLocal, Base, engine
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import Recipe
from migrations.run import run_migrations

SEED_USER_ID = "development_seed_user"
SEED_SOURCE_URL = "manual://development-seed/chamorro-red-rice"


async def prepare_schema() -> None:
    """Create the current base schema, then apply every tracked migration."""

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    # create_all gives a new developer the current base schema; the complete
    # tracked chain adds the same invariants and verification markers required
    # at API startup. Keeping one migration owner prevents local setup from
    # falling behind when a new startup contract is introduced.
    await run_migrations()


async def seed(*, apply: bool = False) -> None:
    """Describe or apply the local-only schema and synthetic record provisioner."""

    settings = get_settings()
    if settings.environment != "development":
        raise RuntimeError("Development seed is only allowed when ENVIRONMENT=development")
    if settings.allow_remote_database_in_development:
        raise RuntimeError("Development seed refuses the remote-database override")

    if not apply:
        print(
            "Dry run: would prepare the local schema and upsert one synthetic "
            "development recipe. Re-run with --apply to make changes."
        )
        return

    await prepare_schema()

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
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="prepare the local schema and upsert the synthetic recipe",
    )
    asyncio.run(seed(apply=parser.parse_args().apply))

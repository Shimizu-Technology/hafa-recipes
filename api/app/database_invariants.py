"""Startup verification and transaction helpers for database invariants."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.models.recipe import Recipe, RecipeVersion

REQUIRED_OWNER_CONSTRAINTS = {
    "fk_recipes_user_id_app_users",
    "fk_saved_recipes_user_id_app_users",
    "fk_collections_user_id_app_users",
    "fk_recipe_notes_user_id_app_users",
    "fk_recipe_versions_created_by_app_users",
    "fk_extraction_jobs_user_id_app_users",
    "fk_meal_plan_entries_user_id_app_users",
    "fk_grocery_list_members_user_id_app_users",
    "fk_grocery_items_user_id_app_users",
    "fk_grocery_list_invites_created_by_app_users",
    "fk_grocery_list_invites_accepted_by_app_users",
}


async def verify_database_invariants(session_factory=AsyncSessionLocal) -> None:
    """Fail startup before serving if migration 020 is absent or incomplete."""

    async with session_factory() as db:
        migration_applied = await db.scalar(
            text("""
                SELECT EXISTS (
                    SELECT 1 FROM schema_migrations WHERE version = 20
                )
            """)
        )
        indexes = set(
            (
                await db.execute(text("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND indexname IN (
                          'uq_recipes_user_canonical_source',
                          'uq_saved_recipes_user_recipe',
                          'uq_recipe_versions_recipe_number'
                      )
                """))
            ).scalars().all()
        )
        constraints = set(
            (
                await db.execute(text("""
                    SELECT conname
                    FROM pg_constraint
                    WHERE conname LIKE 'fk_%_app_users'
                      AND convalidated
                """))
            ).scalars().all()
        )
        if (
            not migration_applied
            or len(indexes) != 3
            or not REQUIRED_OWNER_CONSTRAINTS.issubset(constraints)
        ):
            raise RuntimeError("Database migration 020 is missing or incomplete")


async def next_recipe_version_number(db: AsyncSession, recipe_id: UUID) -> int:
    """Serialize version allocation on the recipe row within the caller's transaction."""

    locked_recipe_id = await db.scalar(
        select(Recipe.id).where(Recipe.id == recipe_id).with_for_update()
    )
    if locked_recipe_id is None:
        raise ValueError("Recipe no longer exists")

    current = await db.scalar(
        select(func.max(RecipeVersion.version_number)).where(
            RecipeVersion.recipe_id == recipe_id
        )
    )
    return (current or 0) + 1

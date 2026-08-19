"""Shared public-visibility and moderation helpers."""

import logging

from fastapi import Depends, HTTPException, Request
from sqlalchemy import and_, exists, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import AsyncSessionLocal
from app.models.identity import AppUser
from app.models.moderation import UserBlock
from app.models.recipe import Recipe

logger = logging.getLogger(__name__)


async def verify_moderation_schema(session_factory=AsyncSessionLocal) -> None:
    """Fail startup if the moderation boundary has not been installed."""
    async with session_factory() as db:
        migration_applied = await db.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 22)
        """))
        required_tables = set(
            (
                await db.execute(text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name IN (
                          'content_reports', 'user_blocks', 'admin_audit_events'
                      )
                """))
            ).scalars().all()
        )
        columns = set(
            (
                await db.execute(text("""
                    SELECT table_name || '.' || column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND (
                        (table_name = 'recipes' AND column_name IN (
                            'moderation_status', 'moderation_updated_at',
                            'is_featured', 'featured_order'
                        ))
                        OR
                        (table_name = 'app_users' AND column_name IN (
                            'moderation_status', 'moderation_updated_at'
                        ))
                      )
                """))
            ).scalars().all()
        )
        constraints = set(
            (
                await db.execute(text("""
                    SELECT conname FROM pg_constraint
                    WHERE conname IN (
                        'ck_recipes_moderation_status',
                        'ck_app_users_moderation_status',
                        'ck_recipes_featured_order',
                        'ck_content_reports_target_type',
                        'ck_content_reports_target',
                        'ck_content_reports_category',
                        'ck_content_reports_status',
                        'uq_user_blocks_pair',
                        'ck_user_blocks_not_self',
                        'ck_admin_audit_reason'
                    )
                      AND connamespace = 'public'::regnamespace
                      AND convalidated
                """))
            ).scalars().all()
        )
        report_constraints_current = False
        if "content_reports" in required_tables:
            report_constraints_current = bool(await db.scalar(text("""
                SELECT
                    position(
                        'appeal' IN pg_get_constraintdef(category_constraint.oid)
                    ) > 0
                    AND position(
                        'IS NOT NULL' IN pg_get_constraintdef(target_constraint.oid)
                    ) = 0
                FROM pg_constraint AS category_constraint
                JOIN pg_constraint AS target_constraint
                  ON target_constraint.conrelid = category_constraint.conrelid
                WHERE category_constraint.conrelid = 'content_reports'::regclass
                  AND category_constraint.conname = 'ck_content_reports_category'
                  AND target_constraint.conname = 'ck_content_reports_target'
            """)))
        featured_order_index = await db.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = 'uq_recipes_featured_order'
            )
        """))
        append_only_trigger = False
        if "admin_audit_events" in required_tables:
            append_only_trigger = bool(await db.scalar(text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_trigger
                    WHERE tgname = 'admin_audit_events_append_only'
                      AND tgrelid = 'admin_audit_events'::regclass
                      AND NOT tgisinternal
                )
            """)))
        if (
            not migration_applied
            or required_tables != {"content_reports", "user_blocks", "admin_audit_events"}
            or columns != {
                "recipes.moderation_status",
                "recipes.moderation_updated_at",
                "recipes.is_featured",
                "recipes.featured_order",
                "app_users.moderation_status",
                "app_users.moderation_updated_at",
            }
            or len(constraints) != 10
            or not report_constraints_current
            or not featured_order_index
            or not append_only_trigger
        ):
            raise RuntimeError("Database migration 022 is missing or incomplete")


def public_recipe_conditions(viewer_user_id: str | None = None):
    """Return the complete policy for recipes shown on public surfaces."""
    conditions = [
        Recipe.is_public.is_(True),
        Recipe.moderation_status == "active",
        or_(
            Recipe.user_id.is_(None),
            ~exists(
                select(AppUser.id).where(
                    AppUser.id == Recipe.user_id,
                    AppUser.moderation_status == "hidden",
                )
            ),
        ),
    ]
    if viewer_user_id:
        conditions.append(
            or_(
                Recipe.user_id.is_(None),
                ~exists(
                    select(UserBlock.id).where(
                        UserBlock.blocker_user_id == viewer_user_id,
                        UserBlock.blocked_user_id == Recipe.user_id,
                    )
                ),
            )
        )
    return tuple(conditions)


def accessible_recipe_conditions(viewer_user_id: str):
    """Return SQL policy for recipes a signed-in user may open."""
    return (
        or_(
            Recipe.user_id == viewer_user_id,
            and_(*public_recipe_conditions(viewer_user_id)),
        ),
    )


async def is_publicly_viewable(
    db: AsyncSession,
    recipe: Recipe,
    viewer_user_id: str | None,
) -> bool:
    """Evaluate the same public policy for an already-loaded recipe."""
    if not recipe.is_public or recipe.moderation_status != "active":
        return False
    if recipe.user_id is None:
        return True

    owner_status = await db.scalar(
        select(AppUser.moderation_status).where(AppUser.id == recipe.user_id)
    )
    if owner_status == "hidden":
        return False
    if viewer_user_id:
        blocked = await db.scalar(
            select(UserBlock.id).where(
                UserBlock.blocker_user_id == viewer_user_id,
                UserBlock.blocked_user_id == recipe.user_id,
            )
        )
        if blocked is not None:
            return False
    return True


async def require_admin(
    request: Request,
    user: ClerkUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClerkUser:
    """Enforce Clerk admin metadata on the API, logging bounded denials."""
    del db  # Keep the same request-scoped DB dependency available to endpoints.
    if not user.is_admin:
        logger.warning(
            "admin_access_denied actor_user_id=%s method=%s route=%s",
            user.id,
            request.method,
            request.url.path,
        )
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

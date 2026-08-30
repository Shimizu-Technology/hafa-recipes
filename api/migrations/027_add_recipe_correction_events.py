"""Migration 027: privacy-minimized recipe correction telemetry."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    """Create the additive correction-event table without backfilling content."""

    async with engine.begin() as conn:
        migration_026_ready = await conn.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 26
            )
        """))
        if not migration_026_ready:
            raise RuntimeError("Migration 026 must run before migration 027")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS recipe_correction_events (
                id UUID PRIMARY KEY,
                recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                event_kind VARCHAR(24) NOT NULL,
                source_type VARCHAR(32) NOT NULL,
                extraction_method VARCHAR(64),
                from_review_state VARCHAR(24),
                to_review_state VARCHAR(24),
                content_revision INTEGER NOT NULL,
                changed_field_count INTEGER NOT NULL,
                ingredient_name_change_count INTEGER NOT NULL,
                quantity_change_count INTEGER NOT NULL,
                unit_change_count INTEGER NOT NULL,
                ingredient_note_change_count INTEGER NOT NULL,
                step_change_count INTEGER NOT NULL,
                time_change_count INTEGER NOT NULL,
                title_changed BOOLEAN NOT NULL,
                servings_changed BOOLEAN NOT NULL,
                other_change_count INTEGER NOT NULL,
                resolved_missing_quantity_count INTEGER NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_recipe_correction_events_kind CHECK (
                    event_kind IN (
                        'review_correction', 'review_verification', 'customization'
                    )
                ),
                CONSTRAINT ck_recipe_correction_events_from_state CHECK (
                    from_review_state IS NULL OR from_review_state IN (
                        'source_incomplete', 'needs_review', 'ready'
                    )
                ),
                CONSTRAINT ck_recipe_correction_events_to_state CHECK (
                    to_review_state IS NULL OR to_review_state IN (
                        'source_incomplete', 'needs_review', 'ready'
                    )
                ),
                CONSTRAINT ck_recipe_correction_events_nonnegative CHECK (
                    content_revision >= 1 AND changed_field_count >= 0
                    AND ingredient_name_change_count >= 0
                    AND quantity_change_count >= 0 AND unit_change_count >= 0
                    AND ingredient_note_change_count >= 0 AND step_change_count >= 0
                    AND time_change_count >= 0 AND other_change_count >= 0
                    AND resolved_missing_quantity_count >= 0
                )
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_recipe_correction_events_recipe_id
            ON recipe_correction_events (recipe_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_recipe_correction_events_user_id
            ON recipe_correction_events (user_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_recipe_correction_events_created_at
            ON recipe_correction_events (created_at)
        """))
        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (27, 'privacy-minimized recipe correction events')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

    print("Recipe correction-event schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

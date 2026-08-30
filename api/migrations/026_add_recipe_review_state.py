"""Migration 026: durable recipe review state and privacy-bounded evidence."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        migration_025_ready = await conn.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 25
            )
        """))
        if not migration_025_ready:
            raise RuntimeError("Migration 025 must run before migration 026")

        await conn.execute(text("""
            ALTER TABLE recipes
              ADD COLUMN IF NOT EXISTS review_state VARCHAR(24),
              ADD COLUMN IF NOT EXISTS extraction_evidence JSONB,
              ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1
        """))
        await conn.execute(text("""
            ALTER TABLE recipe_versions
              ADD COLUMN IF NOT EXISTS review_state VARCHAR(24),
              ADD COLUMN IF NOT EXISTS extraction_evidence JSONB,
              ADD COLUMN IF NOT EXISTS content_revision INTEGER
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_recipes_review_state'
                ) THEN
                    ALTER TABLE recipes
                    ADD CONSTRAINT ck_recipes_review_state
                    CHECK (
                        review_state IS NULL OR review_state IN (
                            'source_incomplete', 'needs_review', 'ready'
                        )
                    );
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_recipes_content_revision'
                ) THEN
                    ALTER TABLE recipes
                    ADD CONSTRAINT ck_recipes_content_revision
                    CHECK (content_revision >= 1);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_recipe_versions_review_state'
                ) THEN
                    ALTER TABLE recipe_versions
                    ADD CONSTRAINT ck_recipe_versions_review_state
                    CHECK (
                        review_state IS NULL OR review_state IN (
                            'source_incomplete', 'needs_review', 'ready'
                        )
                    );
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_recipe_versions_content_revision'
                ) THEN
                    ALTER TABLE recipe_versions
                    ADD CONSTRAINT ck_recipe_versions_content_revision
                    CHECK (content_revision IS NULL OR content_revision >= 1);
                END IF;
            END $$
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_recipes_review_state
            ON recipes (review_state)
        """))
        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (26, 'recipe review state and extraction evidence')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

    print("Recipe review-state schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

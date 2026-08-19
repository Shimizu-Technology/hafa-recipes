"""Migration 020: canonical sources, ownership FKs, and concurrency invariants."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine
from app.source_urls import canonicalize_source

OWNER_COLUMNS = (
    ("recipes", "user_id", "CASCADE"),
    ("saved_recipes", "user_id", "CASCADE"),
    ("collections", "user_id", "CASCADE"),
    ("recipe_notes", "user_id", "CASCADE"),
    ("recipe_versions", "created_by", "SET NULL"),
    ("extraction_jobs", "user_id", "CASCADE"),
    ("meal_plan_entries", "user_id", "CASCADE"),
    ("grocery_list_members", "user_id", "CASCADE"),
    ("grocery_items", "user_id", "CASCADE"),
    ("grocery_list_invites", "created_by", "CASCADE"),
    ("grocery_list_invites", "accepted_by", "SET NULL"),
)


async def _add_owner_constraint(conn, table: str, column: str, on_delete: str) -> None:
    constraint = f"fk_{table}_{column}_app_users"
    exists = await conn.scalar(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = :constraint
                  AND conrelid = to_regclass(:table_name)
            )
        """),
        {"constraint": constraint, "table_name": f"public.{table}"},
    )
    if not exists:
        # Identifiers and actions come exclusively from OWNER_COLUMNS above.
        await conn.execute(
            text(
                f"ALTER TABLE {table} ADD CONSTRAINT {constraint} "
                f"FOREIGN KEY ({column}) REFERENCES app_users(id) "
                f"ON DELETE {on_delete} NOT VALID"
            )
        )
    await conn.execute(text(f"ALTER TABLE {table} VALIDATE CONSTRAINT {constraint}"))


async def run_migration() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(
            text("ALTER TABLE recipes ADD COLUMN IF NOT EXISTS canonical_source_key VARCHAR(96)")
        )

        rows = (
            await conn.execute(text("""
                SELECT id, user_id, source_url
                FROM recipes
                WHERE source_url ~* '^https?://'
                ORDER BY created_at NULLS LAST, id
            """))
        ).mappings().all()
        for row in rows:
            canonical = canonicalize_source(row["source_url"])
            occupied = False
            if row["user_id"] and canonical.key:
                occupied = bool(
                    await conn.scalar(
                        text("""
                            SELECT EXISTS (
                                SELECT 1 FROM recipes
                                WHERE user_id = :user_id
                                  AND canonical_source_key = :source_key
                                  AND id <> :recipe_id
                            )
                        """),
                        {
                            "user_id": row["user_id"],
                            "source_key": canonical.key,
                            "recipe_id": row["id"],
                        },
                    )
                )
            await conn.execute(
                text("""
                    UPDATE recipes
                    SET source_url = :source_url,
                        canonical_source_key = :source_key
                    WHERE id = :recipe_id
                """),
                {
                    "source_url": canonical.url,
                    "source_key": None if occupied else canonical.key,
                    "recipe_id": row["id"],
                },
            )

        # Preserve all legacy duplicates but choose one canonical representative.
        # Future writes are constrained to one logical external source per user.
        await conn.execute(text("""
            WITH duplicates AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY user_id, canonical_source_key
                           ORDER BY created_at NULLS LAST, id
                       ) AS duplicate_rank
                FROM recipes
                WHERE user_id IS NOT NULL
                  AND canonical_source_key IS NOT NULL
            )
            UPDATE recipes
            SET canonical_source_key = NULL
            FROM duplicates
            WHERE recipes.id = duplicates.id
              AND duplicates.duplicate_rank > 1
        """))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_recipes_user_canonical_source
            ON recipes (user_id, canonical_source_key)
            WHERE user_id IS NOT NULL AND canonical_source_key IS NOT NULL
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_recipes_canonical_source_key
            ON recipes (canonical_source_key)
            WHERE canonical_source_key IS NOT NULL
        """))

        # Older installations may have created these tables outside the numbered
        # scripts. Remove only exact duplicate junction/history rows before adding
        # the intended constraints.
        await conn.execute(text("""
            DELETE FROM saved_recipes AS duplicate
            USING saved_recipes AS keeper
            WHERE duplicate.user_id = keeper.user_id
              AND duplicate.recipe_id = keeper.recipe_id
              AND duplicate.id > keeper.id
        """))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_recipes_user_recipe
            ON saved_recipes (user_id, recipe_id)
        """))
        # Duplicate version numbers may contain distinct user-restorable history.
        # Resequence every row for affected recipes instead of deleting snapshots.
        await conn.execute(text("""
            CREATE TEMP TABLE recipe_version_resequence ON COMMIT DROP AS
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY recipe_id
                       ORDER BY version_number, created_at NULLS LAST, id
                   )::INTEGER AS new_number,
                   MAX(version_number) OVER (PARTITION BY recipe_id) AS max_number
            FROM recipe_versions
            WHERE recipe_id IN (
                SELECT recipe_id
                FROM recipe_versions
                GROUP BY recipe_id, version_number
                HAVING COUNT(*) > 1
            )
        """))
        # Move out of the existing number range before assigning the compact
        # sequence, so this also works if an installation already has a unique
        # index with deferred/legacy rows being repaired manually.
        await conn.execute(text("""
            UPDATE recipe_versions AS version
            SET version_number = resequence.max_number + resequence.new_number
            FROM recipe_version_resequence AS resequence
            WHERE version.id = resequence.id
        """))
        await conn.execute(text("""
            UPDATE recipe_versions AS version
            SET version_number = resequence.new_number
            FROM recipe_version_resequence AS resequence
            WHERE version.id = resequence.id
        """))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_versions_recipe_number
            ON recipe_versions (recipe_id, version_number)
        """))

        owner_union = " UNION ".join(
            f"SELECT {column} AS user_id FROM {table} WHERE {column} IS NOT NULL"
            for table, column, _ in OWNER_COLUMNS
        )
        await conn.execute(text(f"""
            INSERT INTO app_users (id)
            SELECT DISTINCT owners.user_id
            FROM ({owner_union}) AS owners
            ON CONFLICT (id) DO NOTHING
        """))
        for table, column, on_delete in OWNER_COLUMNS:
            await _add_owner_constraint(conn, table, column, on_delete)

        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (20, 'canonical sources and database invariants')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

        canonical_count = await conn.scalar(
            text("SELECT COUNT(*) FROM recipes WHERE canonical_source_key IS NOT NULL")
        )
        print(
            "Database invariants ready: "
            f"canonical_sources={canonical_count} ownership_constraints={len(OWNER_COLUMNS)}"
        )


if __name__ == "__main__":
    asyncio.run(run_migration())

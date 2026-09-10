"""Migration 029: permit useful recipes with advisory extraction warnings.

Changes the publication constraint only. Existing visibility, ownership,
recipe content, and review evidence are left intact.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

settings = get_settings()


def _require_production_restore_point(*, migration_already_applied: bool) -> None:
    """Require a named verified restore point before the first production run."""
    if settings.environment != "production" or migration_already_applied:
        return
    if not (settings.migration_029_restore_point or "").strip():
        raise RuntimeError(
            "MIGRATION_029_RESTORE_POINT must name a verified production restore "
            "point before migration 029 can run"
        )


async def run_migration() -> None:
    """Replace the review constraint atomically without changing any recipe."""
    async with engine.begin() as connection:
        prior_ready = await connection.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 28)
        """))
        if not prior_ready:
            raise RuntimeError("Migration 028 must run before migration 029")
        applied = await connection.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 29)
        """))
        _require_production_restore_point(migration_already_applied=bool(applied))
        if applied:
            return
        await connection.execute(text("""
            ALTER TABLE recipes DROP CONSTRAINT IF EXISTS ck_recipes_review_public
        """))
        await connection.execute(text("""
            ALTER TABLE recipes ADD CONSTRAINT ck_recipes_review_public CHECK (
                review_state IS NULL
                OR review_state != 'source_incomplete'
                OR is_public = FALSE
            )
        """))
        await connection.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (29, 'advisory recipe publishing')
        """))
    print("Advisory recipe publishing constraint ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

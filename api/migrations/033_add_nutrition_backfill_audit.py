"""Migration 033: immutable plans and events for bounded nutrition repair."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine


async def install_nutrition_backfill_schema(connection) -> None:
    await connection.execute(
        text("""
        CREATE TABLE IF NOT EXISTS nutrition_backfill_runs (
            backfill_id VARCHAR(96) PRIMARY KEY,
            restore_point VARCHAR(160) NOT NULL,
            database_fingerprint CHAR(64) NOT NULL,
            release_id VARCHAR(160) NOT NULL,
            plan_digest CHAR(64) NOT NULL,
            plan JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    )
    await connection.execute(
        text("""
        CREATE TABLE IF NOT EXISTS nutrition_backfill_events (
            id UUID PRIMARY KEY,
            backfill_id VARCHAR(96) NOT NULL REFERENCES nutrition_backfill_runs(backfill_id),
            recipe_id UUID NOT NULL,
            attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 5),
            outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('started','succeeded','failed','conflict','not_found')),
            failure_code VARCHAR(64),
            result_digest CHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (backfill_id, recipe_id, attempt, outcome)
        )
    """)
    )
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION prevent_nutrition_backfill_audit_mutation()
        RETURNS TRIGGER AS $$ BEGIN
            RAISE EXCEPTION 'Nutrition backfill audit is append-only';
        END $$ LANGUAGE plpgsql
    """)
    )
    for table in ("nutrition_backfill_runs", "nutrition_backfill_events"):
        await connection.execute(
            text(f"DROP TRIGGER IF EXISTS immutable_nutrition_audit ON {table}")
        )
        await connection.execute(
            text(f"""
            CREATE TRIGGER immutable_nutrition_audit BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION prevent_nutrition_backfill_audit_mutation()
        """)
        )


async def run_migration() -> None:
    settings = get_settings()
    async with engine.begin() as connection:
        applied = await connection.scalar(
            text("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version=33)")
        )
        if applied:
            return
        if (
            settings.environment == "production"
            and not (settings.migration_033_restore_point or "").strip()
        ):
            raise RuntimeError(
                "MIGRATION_033_RESTORE_POINT must name a verified production restore point"
            )
        if not await connection.scalar(
            text("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version=31)")
        ):
            raise RuntimeError("Migration 031 must run before migration 033")
        await install_nutrition_backfill_schema(connection)
        await connection.execute(
            text(
                "INSERT INTO schema_migrations(version,name) VALUES (33,'nutrition backfill audit')"
            )
        )
    print("Nutrition backfill audit ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

"""Migration 028: append-only audit schema for legacy thumbnail repair."""

from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db.database import engine

settings = get_settings()


def _require_production_restore_point(*, migration_already_applied: bool) -> None:
    """Stop the first production run unless a named restore point is recorded."""
    if settings.environment != "production" or migration_already_applied:
        return
    restore_point = (settings.migration_028_restore_point or "").strip()
    if not restore_point:
        raise RuntimeError(
            "MIGRATION_028_RESTORE_POINT must name a verified production restore "
            "point before migration 028 can run"
        )


async def install_thumbnail_backfill_audit_schema(
    connection: AsyncConnection,
) -> None:
    """Install the idempotent audit schema without inspecting recipe content."""
    await connection.execute(text("""
        CREATE TABLE IF NOT EXISTS thumbnail_backfill_runs (
            backfill_id VARCHAR(96) PRIMARY KEY,
            restore_point VARCHAR(160) NOT NULL,
            after_recipe_id UUID,
            batch_size INTEGER NOT NULL,
            scanned_rows INTEGER NOT NULL,
            planned_items INTEGER NOT NULL,
            expected_source_bytes BIGINT NOT NULL,
            destination_fingerprint CHAR(64) NOT NULL,
            transform_version VARCHAR(96) NOT NULL,
            release_id VARCHAR(160) NOT NULL,
            visibility_scope VARCHAR(16) NOT NULL,
            next_after_recipe_id UUID,
            plan_digest CHAR(64) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_thumbnail_backfill_run_counts CHECK (
                batch_size BETWEEN 1 AND 100
                AND scanned_rows >= 0
                AND planned_items >= 0
                AND expected_source_bytes >= 0
            )
        )
    """))
    await connection.execute(text("""
        CREATE TABLE IF NOT EXISTS thumbnail_backfill_items (
            backfill_id VARCHAR(96) NOT NULL
                REFERENCES thumbnail_backfill_runs(backfill_id),
            recipe_id UUID NOT NULL,
            source_url_hash CHAR(64),
            source_kind VARCHAR(16),
            source_content_revision INTEGER NOT NULL,
            source_bytes BIGINT,
            source_sha256 CHAR(64),
            preflight_status VARCHAR(16) NOT NULL,
            failure_code VARCHAR(32),
            planned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (backfill_id, recipe_id),
            CONSTRAINT ck_thumbnail_backfill_item_status CHECK (
                preflight_status IN ('missing', 'ready', 'eligible', 'failed')
            ),
            CONSTRAINT ck_thumbnail_backfill_item_source_kind CHECK (
                source_kind IS NULL OR source_kind IN ('app_owned', 'external')
            ),
            CONSTRAINT ck_thumbnail_backfill_item_revision CHECK (
                source_content_revision >= 1
            ),
            CONSTRAINT ck_thumbnail_backfill_item_bytes CHECK (
                source_bytes IS NULL OR source_bytes >= 0
            )
        )
    """))
    await connection.execute(text("""
        CREATE TABLE IF NOT EXISTS thumbnail_backfill_events (
            id UUID PRIMARY KEY,
            backfill_id VARCHAR(96) NOT NULL,
            recipe_id UUID NOT NULL,
            attempt INTEGER NOT NULL,
            outcome VARCHAR(24) NOT NULL,
            failure_code VARCHAR(32),
            source_bytes BIGINT,
            list_bytes BIGINT,
            hero_bytes BIGINT,
            result_url_hash CHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (backfill_id, recipe_id, attempt),
            FOREIGN KEY (backfill_id, recipe_id)
                REFERENCES thumbnail_backfill_items(backfill_id, recipe_id),
            CONSTRAINT ck_thumbnail_backfill_event_attempt CHECK (attempt >= 1),
            CONSTRAINT ck_thumbnail_backfill_event_outcome CHECK (
                outcome IN (
                    'succeeded', 'failed', 'conflict', 'not_found', 'source_changed'
                )
            )
        )
    """))
    await connection.execute(text("""
        CREATE OR REPLACE FUNCTION prevent_thumbnail_backfill_audit_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'thumbnail backfill audit is append-only';
        END;
        $$ LANGUAGE plpgsql
    """))
    for table_name in (
        "thumbnail_backfill_events",
        "thumbnail_backfill_items",
        "thumbnail_backfill_runs",
    ):
        await connection.execute(text(f"""
            DROP TRIGGER IF EXISTS thumbnail_backfill_append_only
            ON {table_name}
        """))
        await connection.execute(text(f"""
            CREATE TRIGGER thumbnail_backfill_append_only
            BEFORE UPDATE OR DELETE ON {table_name}
            FOR EACH ROW
            EXECUTE FUNCTION prevent_thumbnail_backfill_audit_mutation()
        """))


async def run_migration() -> None:
    """Install the audit schema after the recipe-correction migration."""
    async with engine.begin() as connection:
        migration_027_ready = await connection.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 27
            )
        """))
        if not migration_027_ready:
            raise RuntimeError("Migration 027 must run before migration 028")

        migration_028_applied = await connection.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 28
            )
        """))
        _require_production_restore_point(
            migration_already_applied=bool(migration_028_applied),
        )

        await install_thumbnail_backfill_audit_schema(connection)
        await connection.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (28, 'append-only legacy thumbnail backfill audit')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

    print("Thumbnail backfill audit schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

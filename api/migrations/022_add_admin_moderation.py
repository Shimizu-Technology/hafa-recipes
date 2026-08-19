"""Migration 022: user safety, reversible moderation, and admin audit history."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("""
            ALTER TABLE recipes
                ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16) NOT NULL DEFAULT 'active',
                ADD COLUMN IF NOT EXISTS moderation_updated_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS featured_order INTEGER
        """))
        await conn.execute(text("""
            ALTER TABLE app_users
                ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16) NOT NULL DEFAULT 'active',
                ADD COLUMN IF NOT EXISTS moderation_updated_at TIMESTAMPTZ
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_recipes_moderation_status'
                      AND conrelid = 'recipes'::regclass
                ) THEN
                    ALTER TABLE recipes ADD CONSTRAINT ck_recipes_moderation_status
                    CHECK (moderation_status IN ('active', 'hidden'));
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_app_users_moderation_status'
                      AND conrelid = 'app_users'::regclass
                ) THEN
                    ALTER TABLE app_users ADD CONSTRAINT ck_app_users_moderation_status
                    CHECK (moderation_status IN ('active', 'hidden'));
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_recipes_featured_order'
                      AND conrelid = 'recipes'::regclass
                ) THEN
                    ALTER TABLE recipes ADD CONSTRAINT ck_recipes_featured_order
                    CHECK (
                        (is_featured AND featured_order IS NOT NULL AND featured_order >= 0)
                        OR (NOT is_featured AND featured_order IS NULL)
                    );
                END IF;
            END $$
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS content_reports (
                id UUID PRIMARY KEY,
                reporter_user_id VARCHAR(64) REFERENCES app_users(id) ON DELETE SET NULL,
                target_type VARCHAR(16) NOT NULL,
                recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
                target_user_id VARCHAR(64) REFERENCES app_users(id) ON DELETE SET NULL,
                category VARCHAR(24) NOT NULL,
                details TEXT,
                status VARCHAR(16) NOT NULL DEFAULT 'open',
                resolution_note TEXT,
                reviewed_by VARCHAR(64),
                resolved_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_content_reports_target_type
                    CHECK (target_type IN ('recipe', 'contributor')),
                CONSTRAINT ck_content_reports_target CHECK (
                    (target_type = 'recipe' AND target_user_id IS NULL)
                    OR
                    (target_type = 'contributor' AND recipe_id IS NULL)
                ),
                CONSTRAINT ck_content_reports_category CHECK (
                    category IN ('spam', 'unsafe', 'inappropriate', 'copyright', 'impersonation', 'other', 'appeal')
                ),
                CONSTRAINT ck_content_reports_status
                    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_blocks (
                id UUID PRIMARY KEY,
                blocker_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                blocked_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_user_blocks_pair UNIQUE (blocker_user_id, blocked_user_id),
                CONSTRAINT ck_user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
            )
        """))
        await conn.execute(text("""
            DO $$
            DECLARE
                category_definition TEXT;
                target_definition TEXT;
            BEGIN
                SELECT pg_get_constraintdef(oid) INTO category_definition
                FROM pg_constraint
                WHERE conrelid = 'content_reports'::regclass
                  AND conname = 'ck_content_reports_category';
                IF category_definition IS NULL OR position('appeal' IN category_definition) = 0 THEN
                    ALTER TABLE content_reports
                    DROP CONSTRAINT IF EXISTS ck_content_reports_category;
                    ALTER TABLE content_reports
                    ADD CONSTRAINT ck_content_reports_category CHECK (
                        category IN (
                            'spam', 'unsafe', 'inappropriate', 'copyright',
                            'impersonation', 'other', 'appeal'
                        )
                    );
                END IF;

                SELECT pg_get_constraintdef(oid) INTO target_definition
                FROM pg_constraint
                WHERE conrelid = 'content_reports'::regclass
                  AND conname = 'ck_content_reports_target';
                IF target_definition IS NULL OR position('IS NOT NULL' IN target_definition) > 0 THEN
                    ALTER TABLE content_reports
                    DROP CONSTRAINT IF EXISTS ck_content_reports_target;
                    ALTER TABLE content_reports
                    ADD CONSTRAINT ck_content_reports_target CHECK (
                        (target_type = 'recipe' AND target_user_id IS NULL)
                        OR
                        (target_type = 'contributor' AND recipe_id IS NULL)
                    );
                END IF;
            END $$
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_audit_events (
                id UUID PRIMARY KEY,
                actor_user_id VARCHAR(64) NOT NULL,
                action VARCHAR(48) NOT NULL,
                target_type VARCHAR(24) NOT NULL,
                target_id VARCHAR(128) NOT NULL,
                reason VARCHAR(500) NOT NULL,
                before_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                after_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_admin_audit_reason CHECK (char_length(reason) BETWEEN 3 AND 500)
            )
        """))
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation()
            RETURNS TRIGGER AS $$
            BEGIN
                RAISE EXCEPTION 'admin_audit_events is append-only';
            END;
            $$ LANGUAGE plpgsql
        """))
        await conn.execute(text("""
            DROP TRIGGER IF EXISTS admin_audit_events_append_only ON admin_audit_events
        """))
        await conn.execute(text("""
            CREATE TRIGGER admin_audit_events_append_only
                BEFORE UPDATE OR DELETE ON admin_audit_events
                FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation()
        """))
        for statement in (
            "CREATE INDEX IF NOT EXISTS ix_recipes_moderation_status ON recipes (moderation_status)",
            "CREATE INDEX IF NOT EXISTS ix_recipes_featured_order ON recipes (featured_order)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_recipes_featured_order ON recipes (featured_order) WHERE is_featured",
            "CREATE INDEX IF NOT EXISTS ix_app_users_moderation_status ON app_users (moderation_status)",
            "CREATE INDEX IF NOT EXISTS ix_content_reports_status_created ON content_reports (status, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS ix_content_reports_reporter ON content_reports (reporter_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_content_reports_recipe ON content_reports (recipe_id)",
            "CREATE INDEX IF NOT EXISTS ix_content_reports_target_user ON content_reports (target_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_user_blocks_blocker ON user_blocks (blocker_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_user_blocks_blocked ON user_blocks (blocked_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_admin_audit_created ON admin_audit_events (created_at DESC)",
            "CREATE INDEX IF NOT EXISTS ix_admin_audit_actor ON admin_audit_events (actor_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_admin_audit_target ON admin_audit_events (target_type, target_id)",
        ):
            await conn.execute(text(statement))
        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (22, 'admin_moderation')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))
    print("Admin moderation schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

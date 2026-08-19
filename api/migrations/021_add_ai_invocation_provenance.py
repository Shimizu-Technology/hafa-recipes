"""Migration 021: privacy-bounded AI invocation provenance and usage."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS ai_invocations (
                id UUID PRIMARY KEY,
                request_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64),
                job_id UUID,
                capability VARCHAR(32) NOT NULL,
                provider VARCHAR(24) NOT NULL DEFAULT 'openai',
                model VARCHAR(96) NOT NULL,
                prompt_version VARCHAR(64) NOT NULL,
                schema_version VARCHAR(64),
                rollout_variant VARCHAR(24) NOT NULL DEFAULT 'primary',
                fallback_reason VARCHAR(64),
                status VARCHAR(32) NOT NULL,
                error_code VARCHAR(64),
                provider_request_id VARCHAR(128),
                latency_ms INTEGER NOT NULL,
                input_tokens INTEGER,
                cached_input_tokens INTEGER,
                output_tokens INTEGER,
                reasoning_tokens INTEGER,
                estimated_cost_microusd BIGINT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_ai_invocations_user_id_app_users
                    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
                CONSTRAINT fk_ai_invocations_job_id_extraction_jobs
                    FOREIGN KEY (job_id) REFERENCES extraction_jobs(id) ON DELETE SET NULL
            )
        """)
        )
        column_definitions = (
            "id UUID",
            "request_id VARCHAR(64)",
            "user_id VARCHAR(64)",
            "job_id UUID",
            "capability VARCHAR(32)",
            "provider VARCHAR(24) DEFAULT 'openai'",
            "model VARCHAR(96)",
            "prompt_version VARCHAR(64)",
            "schema_version VARCHAR(64)",
            "rollout_variant VARCHAR(24) DEFAULT 'primary'",
            "fallback_reason VARCHAR(64)",
            "status VARCHAR(32)",
            "error_code VARCHAR(64)",
            "provider_request_id VARCHAR(128)",
            "latency_ms INTEGER",
            "input_tokens INTEGER",
            "cached_input_tokens INTEGER",
            "output_tokens INTEGER",
            "reasoning_tokens INTEGER",
            "estimated_cost_microusd BIGINT",
            "created_at TIMESTAMPTZ DEFAULT NOW()",
        )
        for definition in column_definitions:
            await conn.execute(
                text(f"ALTER TABLE ai_invocations ADD COLUMN IF NOT EXISTS {definition}")
            )

        await conn.execute(
            text("""
            ALTER TABLE ai_invocations
                ALTER COLUMN id SET NOT NULL,
                ALTER COLUMN request_id SET NOT NULL,
                ALTER COLUMN capability SET NOT NULL,
                ALTER COLUMN provider SET DEFAULT 'openai',
                ALTER COLUMN provider SET NOT NULL,
                ALTER COLUMN model SET NOT NULL,
                ALTER COLUMN prompt_version SET NOT NULL,
                ALTER COLUMN rollout_variant SET DEFAULT 'primary',
                ALTER COLUMN rollout_variant SET NOT NULL,
                ALTER COLUMN status SET NOT NULL,
                ALTER COLUMN latency_ms SET NOT NULL,
                ALTER COLUMN created_at SET DEFAULT NOW(),
                ALTER COLUMN created_at SET NOT NULL
        """)
        )
        await conn.execute(
            text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[1]
                    WHERE c.conrelid = 'ai_invocations'::regclass
                      AND c.contype = 'p'
                      AND cardinality(c.conkey) = 1
                      AND a.attname = 'id'
                ) THEN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'ai_invocations'::regclass
                          AND conname = 'pk_ai_invocations'
                    ) THEN
                        ALTER TABLE ai_invocations
                        DROP CONSTRAINT pk_ai_invocations;
                    END IF;
                    ALTER TABLE ai_invocations
                    ADD CONSTRAINT pk_ai_invocations PRIMARY KEY (id);
                END IF;
            END $$
        """)
        )
        await conn.execute(
            text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[1]
                    WHERE c.conrelid = 'ai_invocations'::regclass
                      AND c.contype = 'f'
                      AND cardinality(c.conkey) = 1
                      AND a.attname = 'user_id'
                      AND c.confrelid = 'app_users'::regclass
                      AND c.confdeltype = 'c'
                      AND c.convalidated
                ) THEN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'ai_invocations'::regclass
                          AND conname = 'fk_ai_invocations_user_id_app_users'
                    ) THEN
                        ALTER TABLE ai_invocations
                        DROP CONSTRAINT fk_ai_invocations_user_id_app_users;
                    END IF;
                    ALTER TABLE ai_invocations
                    ADD CONSTRAINT fk_ai_invocations_user_id_app_users
                    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
                END IF;
            END $$
        """)
        )
        await conn.execute(
            text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[1]
                    WHERE c.conrelid = 'ai_invocations'::regclass
                      AND c.contype = 'f'
                      AND cardinality(c.conkey) = 1
                      AND a.attname = 'job_id'
                      AND c.confrelid = 'extraction_jobs'::regclass
                      AND c.confdeltype = 'n'
                      AND c.convalidated
                ) THEN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'ai_invocations'::regclass
                          AND conname = 'fk_ai_invocations_job_id_extraction_jobs'
                    ) THEN
                        ALTER TABLE ai_invocations
                        DROP CONSTRAINT fk_ai_invocations_job_id_extraction_jobs;
                    END IF;
                    ALTER TABLE ai_invocations
                    ADD CONSTRAINT fk_ai_invocations_job_id_extraction_jobs
                    FOREIGN KEY (job_id) REFERENCES extraction_jobs(id) ON DELETE SET NULL;
                END IF;
            END $$
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_request_id
            ON ai_invocations (request_id)
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_created_at
            ON ai_invocations (created_at)
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_capability_created_at
            ON ai_invocations (capability, created_at DESC)
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_model_created_at
            ON ai_invocations (model, created_at DESC)
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_status_created_at
            ON ai_invocations (status, created_at DESC)
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_user_id
            ON ai_invocations (user_id)
            WHERE user_id IS NOT NULL
        """)
        )
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_ai_invocations_job_id
            ON ai_invocations (job_id)
            WHERE job_id IS NOT NULL
        """)
        )
        await conn.execute(
            text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (21, 'ai_invocation_provenance')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """)
        )
    print("AI invocation provenance schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())

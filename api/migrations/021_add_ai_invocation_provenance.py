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

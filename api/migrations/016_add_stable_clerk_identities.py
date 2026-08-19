"""Migration 016: add stable application users and issuer-scoped Clerk aliases.

The existing development Clerk subject becomes the stable application user ID.
Ownership rows are intentionally not rewritten. This script is idempotent and
must run with the development (or legacy) Clerk issuer configured.
"""

import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

OWNERS_SQL = """
    SELECT user_id FROM recipes WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM saved_recipes WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM collections WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM recipe_notes WHERE user_id IS NOT NULL
    UNION SELECT created_by FROM recipe_versions WHERE created_by IS NOT NULL
    UNION SELECT user_id FROM extraction_jobs WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM meal_plan_entries WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM grocery_list_members WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM grocery_items WHERE user_id IS NOT NULL
    UNION SELECT created_by FROM grocery_list_invites WHERE created_by IS NOT NULL
    UNION SELECT accepted_by FROM grocery_list_invites WHERE accepted_by IS NOT NULL
"""


async def run_migration() -> None:
    settings = get_settings()
    development = next(
        (item for item in settings.clerk_environments if item.is_development),
        None,
    )
    if development is None:
        raise RuntimeError("A development or legacy Clerk issuer must be configured")

    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS app_users (
                id VARCHAR(64) PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS clerk_identities (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_user_id VARCHAR(64) NOT NULL
                    REFERENCES app_users(id) ON DELETE CASCADE,
                issuer VARCHAR(512) NOT NULL,
                clerk_user_id VARCHAR(64) NOT NULL,
                email_hash VARCHAR(64),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_authenticated_at TIMESTAMPTZ,
                CONSTRAINT uq_clerk_identity_subject
                    UNIQUE (issuer, clerk_user_id),
                CONSTRAINT uq_clerk_identity_user_issuer
                    UNIQUE (app_user_id, issuer)
            )
        """))
        # ``Base.metadata.create_all`` uses the model's Python-side UUID default,
        # so an already-created local table may not have a database default.
        # The migration's set-based backfill must work in either case.
        await conn.execute(text("""
            ALTER TABLE clerk_identities
            ALTER COLUMN id SET DEFAULT gen_random_uuid()
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_clerk_identities_app_user_id
            ON clerk_identities (app_user_id)
        """))

        await conn.execute(text(f"""
            INSERT INTO app_users (id)
            SELECT DISTINCT owners.user_id FROM ({OWNERS_SQL}) AS owners
            ON CONFLICT (id) DO NOTHING
        """))
        await conn.execute(
            text("""
                INSERT INTO clerk_identities (app_user_id, issuer, clerk_user_id)
                SELECT id, :issuer, id
                FROM app_users
                ON CONFLICT (issuer, clerk_user_id) DO NOTHING
            """),
            {"issuer": development.issuer},
        )

        missing = await conn.scalar(text("""
            SELECT COUNT(*)
            FROM app_users AS app_user
            LEFT JOIN clerk_identities AS identity
              ON identity.app_user_id = app_user.id
             AND identity.issuer = :issuer
             AND identity.clerk_user_id = app_user.id
            WHERE identity.id IS NULL
        """).bindparams(issuer=development.issuer))
        if missing:
            raise RuntimeError(
                f"Stable identity backfill is incomplete for {missing} application users"
            )

        user_count = await conn.scalar(text("SELECT COUNT(*) FROM app_users"))
        identity_count = await conn.scalar(
            text("SELECT COUNT(*) FROM clerk_identities WHERE issuer = :issuer")
            .bindparams(issuer=development.issuer)
        )
        print(
            "Stable identity migration complete: "
            f"app_users={user_count} development_identities={identity_count}"
        )


if __name__ == "__main__":
    asyncio.run(run_migration())

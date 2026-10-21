"""Optional additive native Baby sharing; old clients and API remain usable."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.baby.share_models import BabyShareCapture, BabyShareCredential


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
        if not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=50)")
        ):
            raise RuntimeError("Baby050 must precede Baby051")
        restore = os.environ.get("MIGRATION_051_RESTORE_POINT", "").strip()
        if (
            (configured.environment == "production" and not restore)
            or len(restore) > 160
            or any(ord(char) < 32 for char in restore)
        ):
            raise RuntimeError("MIGRATION_051_RESTORE_POINT must name a verified restore point")
        for model in (BabyShareCredential, BabyShareCapture):
            await connection.run_sync(lambda sync: model.__table__.create(sync, checkfirst=True))
        await connection.execute(
            text(
                "ALTER TABLE baby_share_captures ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO schema_migrations(version,name) VALUES (51,'Baby native sharing') ON CONFLICT(version) DO NOTHING"
            )
        )


if __name__ == "__main__":
    asyncio.run(run_migration())

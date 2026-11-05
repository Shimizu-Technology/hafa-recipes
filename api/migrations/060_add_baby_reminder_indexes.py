"""Indexes for reminder work and visit lookups. Not mapped in the ORM, so running code is unaffected.

Everything these serve works without them, only slower, and schema_complete doesn't look for them.
"""
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from migrations._baby_expand import finish, prepare, verify

LINKED = "deleted_at IS NULL AND (data->>'event_id') IS NOT NULL"
DDL = (
    """CREATE INDEX IF NOT EXISTS ix_baby_notifications_receipts_due ON baby_notifications(receipt_due_at, id)
        WHERE status = 'accepted' AND receipt_due_at IS NOT NULL""",
    """CREATE INDEX IF NOT EXISTS ix_baby_notification_prefs_enabled ON baby_notification_prefs(app_user_id, kind)
        WHERE enabled IS TRUE""",
    f"""CREATE INDEX IF NOT EXISTS ix_baby_records_owner_event_link
        ON baby_records(app_user_id, generation, (data->>'event_id')) WHERE {LINKED}""",
    f"""CREATE INDEX IF NOT EXISTS ix_baby_records_space_event_link
        ON baby_records(space_id, generation, (data->>'event_id')) WHERE {LINKED}""",
)
INDEXES = (
    "ix_baby_notifications_receipts_due", "ix_baby_notification_prefs_enabled",
    "ix_baby_records_owner_event_link", "ix_baby_records_space_event_link",
)


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    # One transaction: all four or none. Writes to these tables wait while each builds, so a
    # lock_timeout stops this rather than a writer. Recipes and Workouts tables aren't touched.
    async with (migration_engine or engine).begin() as db:
        recorded = await prepare(db, configured, 60, 59)
        if not recorded:
            for ddl in DDL:
                await db.execute(text(ddl))
        await verify(db, {}, {}, INDEXES)
        await finish(db, 60, "Baby reminder indexes")


if __name__ == "__main__":
    asyncio.run(run_migration())

"""Unused durable push storage; delivery remains disabled."""
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from migrations._baby_expand import finish, prepare, verify

DDL = (
    """CREATE TABLE IF NOT EXISTS baby_push_devices (
        id UUID PRIMARY KEY, app_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        installation_id VARCHAR(128) NOT NULL, token TEXT NOT NULL UNIQUE,
        platform VARCHAR(16) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(app_user_id,installation_id),
        CONSTRAINT ck_baby_push_platform CHECK (platform IN ('ios','android')))""",
    """CREATE TABLE IF NOT EXISTS baby_notification_prefs (
        space_id UUID NOT NULL REFERENCES baby_spaces(id) ON DELETE CASCADE,
        app_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        kind VARCHAR(64) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(space_id,app_user_id,kind))""",
    """CREATE TABLE IF NOT EXISTS baby_notifications (
        id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES baby_spaces(id) ON DELETE CASCADE,
        app_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        device_id UUID REFERENCES baby_push_devices(id) ON DELETE SET NULL,
        idempotency_key VARCHAR(240) NOT NULL UNIQUE, collapse_id VARCHAR(64) NOT NULL,
        kind VARCHAR(64) NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        due_at TIMESTAMPTZ NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'queued',
        lease_token UUID, lease_until TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
        unknown_retries INTEGER NOT NULL DEFAULT 0, provider_ticket TEXT,
        receipt_due_at TIMESTAMPTZ, last_error VARCHAR(240), dismissed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ck_baby_notification_status CHECK (status IN ('queued','sending','accepted','failed','unknown')),
        CONSTRAINT ck_baby_notification_attempts CHECK (attempts >= 0),
        CONSTRAINT ck_baby_notification_unknown_retry CHECK (unknown_retries BETWEEN 0 AND 1))""",
    """CREATE INDEX IF NOT EXISTS ix_baby_push_devices_actor ON baby_push_devices(app_user_id)""",
    """CREATE INDEX IF NOT EXISTS ix_baby_notifications_due ON baby_notifications(status,due_at,lease_until)""",
    """CREATE INDEX IF NOT EXISTS ix_baby_notifications_today ON baby_notifications(space_id,app_user_id,due_at)""",
)
COLUMNS = {
    "baby_push_devices": {"id": "uuid", "app_user_id": "varchar", "installation_id": "varchar",
        "token": "text", "platform": "varchar", "enabled": "bool", "updated_at": "timestamptz"},
    "baby_notification_prefs": {"space_id": "uuid", "app_user_id": "varchar", "kind": "varchar",
        "enabled": "bool", "settings": "jsonb"},
    "baby_notifications": {"id": "uuid", "space_id": "uuid", "app_user_id": "varchar",
        "device_id": "uuid", "idempotency_key": "varchar", "collapse_id": "varchar",
        "kind": "varchar", "payload": "jsonb", "due_at": "timestamptz", "status": "varchar",
        "lease_token": "uuid", "lease_until": "timestamptz", "attempts": "int4",
        "unknown_retries": "int4", "provider_ticket": "text", "receipt_due_at": "timestamptz",
        "last_error": "varchar", "dismissed_at": "timestamptz", "created_at": "timestamptz", "updated_at": "timestamptz"},
}
CONSTRAINTS = {
    "baby_push_devices": ("baby_push_devices_pkey", "ck_baby_push_platform"),
    "baby_notification_prefs": ("baby_notification_prefs_pkey",),
    "baby_notifications": ("baby_notifications_pkey", "ck_baby_notification_status",
        "ck_baby_notification_attempts", "ck_baby_notification_unknown_retry"),
}
INDEXES = ("ix_baby_push_devices_actor", "ix_baby_notifications_due", "ix_baby_notifications_today")


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    async with (migration_engine or engine).begin() as db:
        recorded = await prepare(db, configured, 57, 56)
        if not recorded:
            for ddl in DDL:
                await db.execute(text(ddl))
        await verify(db, COLUMNS, CONSTRAINTS, INDEXES)
        await finish(db, 57, "Baby push storage")


if __name__ == "__main__":
    asyncio.run(run_migration())

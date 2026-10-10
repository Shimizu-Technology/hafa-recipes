"""Optional automation startup is database-free while Workouts is dormant."""

from sqlalchemy import text

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.automation_models import AUTOMATION_TABLES


async def verify_automation_schema(session_factory=AsyncSessionLocal, *, settings=None):
    configured = settings or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with session_factory() as db:
        ledger = await db.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not ledger or not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            raise RuntimeError("Optional Workouts migration035 is missing")
        rows = (
            await db.execute(
                text("""
            SELECT table_name,column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name LIKE 'workouts_%'
        """)
            )
        ).all()
        columns = {}
        for table, column in rows:
            columns.setdefault(table, set()).add(column)
        for table in AUTOMATION_TABLES:
            if not set(table.columns.keys()) <= columns.get(table.name, set()):
                raise RuntimeError("Optional Workouts automation schema is incomplete")
        owners = set(
            (
                await db.execute(
                    text("""
            SELECT DISTINCT relation.relname FROM pg_constraint constraint_record
            JOIN pg_class relation ON relation.oid=constraint_record.conrelid
            JOIN pg_class parent ON parent.oid=constraint_record.confrelid
            JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
            JOIN pg_attribute attribute ON attribute.attrelid=relation.oid
                AND attribute.attnum=ANY(constraint_record.conkey)
            WHERE namespace.nspname='public' AND constraint_record.contype='f'
                AND constraint_record.confdeltype='c' AND constraint_record.convalidated
                AND parent.relname='app_users' AND attribute.attname='app_user_id'
        """)
                )
            )
            .scalars()
            .all()
        )
        if not {table.name for table in AUTOMATION_TABLES} <= owners:
            raise RuntimeError("Workouts automation owner-deletion cascades are incomplete")

"""Readiness for optional connection/sharing tables; off remains database-free."""

from sqlalchemy import text

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.connection_models import CONNECTION_TABLES


async def verify_connections_schema(session_factory=AsyncSessionLocal, *, settings=None):
    configured = settings or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with session_factory() as db:
        if not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=37)")
        ):
            raise RuntimeError("Optional Workouts connections migration 037 is missing")
        columns = (
            await db.execute(
                text(
                    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'workouts_%'"
                )
            )
        ).all()
        found = {}
        for table, column in columns:
            found.setdefault(table, set()).add(column)
        for table in CONNECTION_TABLES:
            if not set(table.columns.keys()) <= found.get(table.name, set()):
                raise RuntimeError("Optional Workouts connections migration 037 is incomplete")
        required = {
            ("workouts_shares", "immutable_published_training_snapshot"),
            ("workouts_recipe_connection_receipts", "immutable_workouts_connection_receipt"),
            ("workouts_copy_receipts", "immutable_workouts_connection_receipt"),
        }
        installed = set(
            (
                await db.execute(
                    text("""
            SELECT relation.relname,trigger_record.tgname FROM pg_trigger trigger_record
            JOIN pg_class relation ON relation.oid=trigger_record.tgrelid
            WHERE trigger_record.tgtype=19 AND trigger_record.tgenabled <> 'D'
        """)
                )
            ).all()
        )
        if not required <= installed:
            raise RuntimeError("Workouts connection snapshot protections are incomplete")
        cascades = set(
            (
                await db.execute(
                    text("""
            SELECT table_relation.relname FROM pg_constraint constraint_record
            JOIN pg_class table_relation ON table_relation.oid=constraint_record.conrelid
            JOIN pg_namespace namespace ON namespace.oid=table_relation.relnamespace
            JOIN pg_class parent_relation ON parent_relation.oid=constraint_record.confrelid
            JOIN pg_attribute column_record ON column_record.attrelid=table_relation.oid
                AND column_record.attnum=ANY(constraint_record.conkey)
            WHERE namespace.nspname='public' AND parent_relation.relname='app_users'
                AND column_record.attname='app_user_id' AND constraint_record.contype='f'
                AND constraint_record.convalidated AND constraint_record.confdeltype='c'
        """)
                )
            )
            .scalars()
            .all()
        )
        if not {table.name for table in CONNECTION_TABLES} <= cascades:
            raise RuntimeError("Workouts connection account-deletion cascades are incomplete")

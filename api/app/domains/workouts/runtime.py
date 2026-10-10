"""Optional domain readiness. Disabled Workouts never queries its schema."""

from sqlalchemy import text

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.models import WORKOUTS_TABLES

SNAPSHOT_TABLES = frozenset(
    {"workouts_library_versions", "workouts_program_versions", "workouts_sessions"}
)


async def verify_workouts_schema(session_factory=AsyncSessionLocal, *, settings=None):
    configured = settings or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with session_factory() as db:
        exists = await db.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not exists or not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=34)")
        ):
            raise RuntimeError("Optional Workouts migration 034 is missing")
        columns = (
            await db.execute(
                text("""
            SELECT table_name,column_name,data_type FROM information_schema.columns
            WHERE table_schema='public' AND table_name LIKE 'workouts_%'
        """)
            )
        ).all()
        found = {}
        for table, column, data_type in columns:
            found.setdefault(table, set()).add(column)
            if column == "content" and data_type != "jsonb":
                raise RuntimeError("Workouts saved content must use JSONB")
        for table in WORKOUTS_TABLES:
            if not set(table.columns.keys()) <= found.get(table.name, set()):
                raise RuntimeError("Optional Workouts migration 034 is incomplete")
        cascades = set(
            (
                await db.execute(
                    text("""
            SELECT DISTINCT table_relation.relname
            FROM pg_constraint constraint_record
            JOIN pg_class table_relation ON table_relation.oid=constraint_record.conrelid
            JOIN pg_namespace namespace ON namespace.oid=table_relation.relnamespace
            JOIN pg_class parent_relation ON parent_relation.oid=constraint_record.confrelid
            JOIN pg_attribute column_record ON column_record.attrelid=table_relation.oid
                AND column_record.attnum=ANY(constraint_record.conkey)
            WHERE namespace.nspname='public' AND constraint_record.contype='f'
                AND constraint_record.convalidated AND constraint_record.confdeltype='c'
                AND parent_relation.relname='app_users' AND column_record.attname='app_user_id'
        """)
                )
            )
            .scalars()
            .all()
        )
        if not {table.name for table in WORKOUTS_TABLES} <= cascades:
            raise RuntimeError("Workouts account-deletion cascades are incomplete")
        triggers = set(
            (
                await db.execute(
                    text("""
            SELECT relation.relname FROM pg_trigger trigger_record
            JOIN pg_class relation ON relation.oid=trigger_record.tgrelid
            JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
            JOIN pg_proc trigger_function ON trigger_function.oid=trigger_record.tgfoid
            WHERE namespace.nspname='public' AND trigger_record.tgname='immutable_workouts_snapshot'
                AND trigger_record.tgenabled <> 'D' AND NOT trigger_record.tgisinternal
                AND trigger_record.tgtype=19
                AND trigger_function.proname='prevent_workouts_snapshot_update'
        """)
                )
            )
            .scalars()
            .all()
        )
        if not SNAPSHOT_TABLES <= triggers:
            raise RuntimeError("Workouts immutable snapshot protections are incomplete")

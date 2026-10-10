"""Verified installed045 governs shared admission even when async UI is OFF."""

from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.export_job_definitions import (
    EXPORT_JOB_CONSTRAINTS,
    EXPORT_JOB_FUNCTION_BODIES,
    EXPORT_JOB_TRIGGERS,
)
from app.domains.workouts.export_job_models import EXPORT_JOB_TABLES

TABLE_FILTER = "('workouts_export_jobs','workouts_export_job_slot','workouts_export_job_recovery')"


def pg_type(column):
    value = column.type.compile(dialect=postgresql.dialect()).lower()
    return value.replace("varchar", "character varying")


async def verify_export_job_schema(target_engine=engine, *, settings=None):
    configured = settings or get_settings()
    if not configured.workouts_api_enabled:
        return False
    async with target_engine.connect() as db:
        installed = [
            bool(
                await db.scalar(
                    text("SELECT to_regclass(:name) IS NOT NULL"), {"name": "public." + table.name}
                )
            )
            for table in EXPORT_JOB_TABLES
        ]
        ledger = await db.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        version = bool(
            ledger
            and await db.scalar(
                text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=45)")
            )
        )
        if not any(installed) and not version and not configured.workouts_export_jobs_enabled:
            return False
        if not all(installed) or not version:
            raise RuntimeError("Optional Workouts export jobs migration045 is incomplete")
        columns = set(
            (
                await db.execute(
                    text(f"""
            SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull
            FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname IN {TABLE_FILTER}
            AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        """)
                )
            ).all()
        )
        expected_columns = {
            (table.name, column.name, pg_type(column), not column.nullable)
            for table in EXPORT_JOB_TABLES
            for column in table.columns
        }
        if columns != expected_columns:
            raise RuntimeError("Export job column types and nullability must match045")
        constraints = (
            await db.execute(
                text(f"""
            SELECT r.relname,c.conname,c.contype::text,pg_get_constraintdef(c.oid),
                   c.convalidated,c.condeferrable,c.condeferred,
                   coalesce(i.indisvalid AND i.indisready, true)
            FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=r.relnamespace
            LEFT JOIN pg_index i ON i.indexrelid=c.conindid
            WHERE n.nspname='public' AND r.relname IN {TABLE_FILTER}
        """)
            )
        ).all()
        expected_constraints = {
            (table, name, kind, definition, True, False, False, True)
            for (table, name), (kind, definition) in EXPORT_JOB_CONSTRAINTS.items()
        }
        if set(constraints) != expected_constraints:
            raise RuntimeError("Export job keys and exact validated constraints must match045")
        triggers = (
            await db.execute(
                text(f"""
            SELECT r.relname,t.tgname,t.tgtype,t.tgenabled::text,t.tgattr::text,
                   t.tgqual::text,t.tgnargs,encode(t.tgargs,'hex'),t.tgdeferrable,t.tginitdeferred,
                   p.proname,nf.nspname,p.prosrc,l.lanname,p.prorettype::regtype::text,
                   p.prosecdef,p.proconfig,p.provolatile::text,p.proisstrict,p.proleakproof,
                   p.pronargs,p.prokind::text
            FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
            JOIN pg_namespace n ON n.oid=r.relnamespace
            JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace
            JOIN pg_language l ON l.oid=p.prolang
            WHERE n.nspname='public' AND r.relname IN {TABLE_FILTER} AND NOT t.tgisinternal
        """)
            )
        ).all()
        expected_triggers = {
            (
                table,
                name,
                kind,
                "O",
                "",
                None,
                0,
                "",
                False,
                False,
                function,
                "public",
                EXPORT_JOB_FUNCTION_BODIES[function],
                "plpgsql",
                "trigger",
                False,
                None,
                "v",
                False,
                False,
                0,
                "f",
            )
            for (table, name), (kind, function) in EXPORT_JOB_TRIGGERS.items()
        }
        if {
            tuple(tuple(v) if isinstance(v, list) else v for v in row) for row in triggers
        } != expected_triggers:
            raise RuntimeError("Canonical export job trigger bodies and security are required")
        if (
            await db.scalar(text("SELECT count(*) FROM workouts_export_job_slot")) != 1
            or await db.scalar(text("SELECT count(*) FROM workouts_export_job_slot WHERE slot=1"))
            != 1
        ):
            raise RuntimeError("Persistent singleton export job slot is required")
    return True

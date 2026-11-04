"""Transaction-local guards shared by the additive Baby DDL migrations."""
import os

from sqlalchemy import text


async def prepare(connection, configured, version, predecessor):
    await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
    await connection.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
    if not await connection.scalar(text(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=:version)"
    ), {"version": predecessor}):
        raise RuntimeError(f"Baby{predecessor:03} must precede Baby{version:03}")
    recorded = await connection.scalar(text(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=:version)"
    ), {"version": version})
    restore = os.environ.get(f"MIGRATION_{version:03}_RESTORE_POINT", "").strip()
    if not recorded and ((configured.environment == "production" and not restore)
            or len(restore) > 160 or any(ord(char) < 32 for char in restore)):
        raise RuntimeError(f"MIGRATION_{version:03}_RESTORE_POINT must name a verified restore point")
    return recorded


async def verify(connection, columns, constraints, indexes):
    for table, names in columns.items():
        actual = dict((await connection.execute(text("""SELECT column_name, udt_name
            FROM information_schema.columns WHERE table_schema='public' AND table_name=:table"""),
            {"table": table})).all())
        if any(actual.get(name) != udt for name, udt in names.items()):
            raise RuntimeError(f"Baby schema drift: {table} columns")
    for table, names in constraints.items():
        actual = set((await connection.execute(text("""SELECT conname FROM pg_constraint
            WHERE conrelid=to_regclass(:table) AND convalidated"""),
            {"table": "public." + table})).scalars())
        if not set(names) <= actual:
            raise RuntimeError(f"Baby schema drift: {table} constraints")
    for name in indexes:
        if not await connection.scalar(text("""SELECT EXISTS(SELECT 1 FROM pg_index i
            JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname=:name AND i.indisvalid)"""), {"name": name}):
            raise RuntimeError(f"Baby schema drift: {name}")


async def finish(connection, version, name):
    await connection.execute(text("""INSERT INTO schema_migrations(version,name)
        VALUES(:version,:name) ON CONFLICT(version) DO NOTHING"""),
        {"version": version, "name": name})

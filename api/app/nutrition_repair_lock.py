"""Session advisory locking on a dedicated direct PostgreSQL connection."""

from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.db.database import ssl_context

LOCK_NAME = "hafa:nutrition-backfill:v2"
_LOCAL_HOSTS = {None, "localhost", "127.0.0.1", "::1"}


class NutritionBackfillBlocked(RuntimeError):
    pass


def direct_lock_url(data_engine):
    """Change only Neon's pooled endpoint suffix, preserving the approved target."""
    url = data_engine.url
    host = url.host
    if host in _LOCAL_HOSTS:
        return url
    if not host.endswith(".neon.tech"):
        raise NutritionBackfillBlocked("Repair locking requires direct Neon or local PostgreSQL")
    endpoint, domain = host.split(".", 1)
    if not endpoint.startswith("ep-"):
        raise NutritionBackfillBlocked("Unrecognized Neon repair-lock endpoint")
    if endpoint.endswith("-pooler"):
        return url.set(host=f"{endpoint.removesuffix('-pooler')}.{domain}")
    return url


def create_lock_engine(data_engine):
    url = direct_lock_url(data_engine)
    connect_args = {"server_settings": {"application_name": "hafa-nutrition-repair-lock"}}
    if url.host not in _LOCAL_HOSTS:
        connect_args["ssl"] = ssl_context
    return create_async_engine(
        url,
        poolclass=NullPool,
        isolation_level="AUTOCOMMIT",
        connect_args=connect_args,
    )


class RepairLockSession:
    def __init__(self, connection):
        self.connection = connection
        self.pid = None
        self.acquired = False

    async def acquire(self):
        row = (
            (
                await self.connection.execute(
                    text(
                        "SELECT pg_backend_pid() AS pid, pg_try_advisory_lock(hashtext(:name)) AS acquired"
                    ),
                    {"name": LOCK_NAME},
                )
            )
            .mappings()
            .one()
        )
        await self.connection.commit()
        if not row["acquired"]:
            raise NutritionBackfillBlocked("Another nutrition repair is running")
        self.pid = row["pid"]
        self.acquired = True
        await self.verify()

    async def verify(self):
        """Fail closed if the original session or held lock was lost."""
        if not self.acquired or self.connection.closed or self.connection.invalidated:
            raise NutritionBackfillBlocked("Nutrition repair lock connection was lost")
        try:
            row = (
                (
                    await self.connection.execute(
                        text("""
                SELECT pg_backend_pid() AS pid, EXISTS (
                    SELECT 1 FROM pg_locks
                    WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
                    AND classid=((hashtext(:name)::bigint >> 32) & 4294967295)
                    AND objid=(hashtext(:name)::bigint & 4294967295) AND objsubid=1
                ) AS held
            """),
                        {"name": LOCK_NAME},
                    )
                )
                .mappings()
                .one()
            )
            await self.connection.commit()
        except SQLAlchemyError as exc:
            raise NutritionBackfillBlocked("Nutrition repair lock connection was lost") from exc
        if row["pid"] != self.pid or not row["held"]:
            raise NutritionBackfillBlocked("Nutrition repair lock session changed or was released")

    async def release(self):
        if not self.acquired:
            return
        if self.connection.closed or self.connection.invalidated:
            raise NutritionBackfillBlocked("Nutrition repair lock connection was lost")
        # The session check and unlock are one statement. Never unlock a different
        # backend if a driver/pool unexpectedly changes the physical connection.
        released = await self.connection.scalar(
            text("""
            SELECT CASE WHEN pg_backend_pid()=:pid
            THEN pg_advisory_unlock(hashtext(:name)) ELSE false END
        """),
            {"pid": self.pid, "name": LOCK_NAME},
        )
        await self.connection.commit()
        if not released:
            raise NutritionBackfillBlocked("Nutrition repair lock was not released safely")
        self.acquired = False


@asynccontextmanager
async def dedicated_lock_session(data_engine):
    """Always close the physical session, including failed/cancelled operations."""
    lock_engine = create_lock_engine(data_engine)
    try:
        async with lock_engine.connect() as connection:
            yield RepairLockSession(connection)
    finally:
        await lock_engine.dispose()

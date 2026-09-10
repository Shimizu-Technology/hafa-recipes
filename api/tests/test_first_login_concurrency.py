"""Real PostgreSQL races when simultaneous requests adopt a first-time owner."""

import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth import _attach_identity
from app.models.identity import AppUser, ClerkIdentity

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.fixture
async def first_login_database():
    assert TEST_DATABASE_URL
    schema = f"first_login_{uuid4().hex}"
    admin = create_async_engine(TEST_DATABASE_URL)
    engine = create_async_engine(
        TEST_DATABASE_URL, connect_args={"server_settings": {"search_path": schema}}
    )
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        async with engine.begin() as connection:
            await connection.run_sync(AppUser.__table__.create)
            await connection.run_sync(ClerkIdentity.__table__.create)
        yield engine
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("owners", "subjects", "expected_successes"),
    [
        (("new_owner", "new_owner"), ("new_subject", "new_subject"), 2),
        (("new_owner", "new_owner"), ("subject_one", "subject_two"), 1),
        (("owner_one", "owner_two"), ("new_subject", "new_subject"), 1),
    ],
)
async def test_first_login_race_is_atomic_and_conflict_stopping(
    first_login_database, owners, subjects, expected_successes
):
    barrier = asyncio.Barrier(2)

    class SimultaneousFirstLoginSession(AsyncSession):
        async def get(self, entity, ident, **kwargs):
            result = await super().get(entity, ident, **kwargs)
            if entity is AppUser:
                assert result is None
                # Both real transactions must observe the owner as absent before
                # either can insert. Without this, scheduling can hide the race.
                await asyncio.wait_for(barrier.wait(), timeout=10)
            return result

    sessions = async_sessionmaker(
        first_login_database,
        class_=SimultaneousFirstLoginSession,
        expire_on_commit=False,
    )

    async def attach(owner, subject):
        async with sessions() as db:
            identity = await _attach_identity(
                db,
                app_user_id=owner,
                issuer="https://first-login.clerk.accounts.dev",
                clerk_user_id=subject,
                allow_create_user=True,
            )
            if identity is not None:
                assert (identity.app_user_id, identity.clerk_user_id) == (owner, subject)
                return identity.id
            return None

    results = await asyncio.wait_for(
        asyncio.gather(*(attach(owner, subject) for owner, subject in zip(owners, subjects))),
        timeout=20,
    )
    assert sum(result is not None for result in results) == expected_successes
    if expected_successes == 2:
        assert results[0] == results[1]

    async with AsyncSession(first_login_database) as db:
        stored_owners = (await db.scalars(select(AppUser.id))).all()
        identities = (await db.scalars(select(ClerkIdentity))).all()
        assert len(identities) == 1
        # A conflicting request must not leave an orphaned owner behind.
        assert stored_owners == [identities[0].app_user_id]

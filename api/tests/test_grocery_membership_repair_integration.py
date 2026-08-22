"""PostgreSQL coverage for the legacy empty-list membership repair."""

import os

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.grocery_membership_repair import (
    GroceryMembershipRepairBlocked,
    run_repair,
)

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration coverage",
)


async def _reset_schema(engine) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))


async def _create_grocery_schema(engine) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text("""
            CREATE TABLE grocery_lists (
                id UUID PRIMARY KEY,
                name VARCHAR(255) NOT NULL DEFAULT 'Grocery List',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE grocery_list_members (
                list_id UUID NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
                user_id VARCHAR(64) NOT NULL,
                joined_at TIMESTAMPTZ,
                PRIMARY KEY (list_id, user_id)
            )
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE grocery_items (
                id UUID PRIMARY KEY,
                list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE,
                archived BOOLEAN NOT NULL DEFAULT FALSE
            )
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE grocery_list_invites (
                id UUID PRIMARY KEY,
                list_id UUID NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE
            )
        """)
        )


@pytest.mark.asyncio
async def test_repair_is_dry_run_audited_and_idempotent():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _reset_schema(database_engine)
        await _create_grocery_schema(database_engine)
        async with database_engine.begin() as connection:
            await connection.execute(
                text("""
                INSERT INTO grocery_lists (id) VALUES
                    ('10000000-0000-4000-8000-000000000001'),
                    ('10000000-0000-4000-8000-000000000002'),
                    ('10000000-0000-4000-8000-000000000003'),
                    ('20000000-0000-4000-8000-000000000001'),
                    ('20000000-0000-4000-8000-000000000002')
            """)
            )
            await connection.execute(
                text("""
                INSERT INTO grocery_list_members (list_id, user_id, joined_at) VALUES
                    ('10000000-0000-4000-8000-000000000001', 'user-one', '2026-01-01'),
                    ('10000000-0000-4000-8000-000000000002', 'user-one', '2026-01-02'),
                    ('10000000-0000-4000-8000-000000000003', 'user-one', '2026-01-03'),
                    ('20000000-0000-4000-8000-000000000001', 'user-two', '2026-02-01'),
                    ('20000000-0000-4000-8000-000000000002', 'user-two', '2026-02-02')
            """)
            )

        dry_run = await run_repair(database_engine=database_engine)
        assert dry_run["status"] == "would_apply"
        assert dry_run["duplicate_users"] == 2
        assert dry_run["duplicate_memberships"] == 5
        assert dry_run["remove_lists"] == 3
        async with database_engine.connect() as connection:
            assert await connection.scalar(text("SELECT COUNT(*) FROM grocery_lists")) == 5
            assert (
                await connection.scalar(
                    text("SELECT to_regclass('public.grocery_membership_repair_audit')")
                )
                is None
            )

        applied = await run_repair(
            apply=True,
            repair_id="integration-empty-list-repair",
            expected_users=2,
            expected_memberships=5,
            database_engine=database_engine,
        )
        assert applied["status"] == "applied"
        assert applied["remove_lists"] == 3

        async with database_engine.connect() as connection:
            memberships = (
                await connection.execute(
                    text("""
                    SELECT user_id, list_id::text
                    FROM grocery_list_members
                    ORDER BY user_id
                """)
                )
            ).all()
            audits = (
                await connection.execute(
                    text("""
                    SELECT repair_id, actor_hash, kept_list_id::text, removed_list_id::text
                    FROM grocery_membership_repair_audit
                    ORDER BY kept_list_id, removed_list_id
                """)
                )
            ).all()

        assert memberships == [
            ("user-one", "10000000-0000-4000-8000-000000000001"),
            ("user-two", "20000000-0000-4000-8000-000000000001"),
        ]
        assert len(audits) == 3
        assert {audit.repair_id for audit in audits} == {"integration-empty-list-repair"}
        assert all(audit.actor_hash not in {"user-one", "user-two"} for audit in audits)

        unchanged = await run_repair(
            apply=True,
            repair_id="integration-empty-list-repair",
            expected_users=2,
            expected_memberships=5,
            database_engine=database_engine,
        )
        assert unchanged["status"] == "unchanged"
        async with database_engine.connect() as connection:
            assert (
                await connection.scalar(
                    text("SELECT COUNT(*) FROM grocery_membership_repair_audit")
                )
                == 3
            )
        with pytest.raises(DBAPIError, match="append-only"):
            async with database_engine.begin() as connection:
                await connection.execute(
                    text("""
                    UPDATE grocery_membership_repair_audit
                    SET reason = 'changed'
                """)
                )
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "unsafe_change",
    [
        """
            INSERT INTO grocery_items (id, list_id) VALUES (
                '30000000-0000-4000-8000-000000000010',
                '30000000-0000-4000-8000-000000000002'
            )
        """,
        """
            INSERT INTO grocery_items (id, list_id, archived) VALUES (
                '30000000-0000-4000-8000-000000000011',
                '30000000-0000-4000-8000-000000000002',
                TRUE
            )
        """,
        """
            INSERT INTO grocery_list_invites (id, list_id) VALUES (
                '30000000-0000-4000-8000-000000000012',
                '30000000-0000-4000-8000-000000000002'
            )
        """,
        """
            INSERT INTO grocery_list_members (list_id, user_id, joined_at) VALUES (
                '30000000-0000-4000-8000-000000000002',
                'another-member',
                '2026-03-03'
            )
        """,
        """
            UPDATE grocery_lists
            SET name = 'My weekly shop'
            WHERE id = '30000000-0000-4000-8000-000000000002'
        """,
    ],
    ids=["active-item", "archived-item", "invite", "another-member", "custom-name"],
)
async def test_repair_stops_if_a_duplicate_list_contains_data(unsafe_change):
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _reset_schema(database_engine)
        await _create_grocery_schema(database_engine)
        async with database_engine.begin() as connection:
            await connection.execute(
                text("""
                INSERT INTO grocery_lists (id) VALUES
                    ('30000000-0000-4000-8000-000000000001'),
                    ('30000000-0000-4000-8000-000000000002')
            """)
            )
            await connection.execute(
                text("""
                INSERT INTO grocery_list_members (list_id, user_id, joined_at) VALUES
                    ('30000000-0000-4000-8000-000000000001', 'unsafe-user', '2026-03-01'),
                    ('30000000-0000-4000-8000-000000000002', 'unsafe-user', '2026-03-02')
            """)
            )
            await connection.execute(text(unsafe_change))

        dry_run = await run_repair(database_engine=database_engine)
        assert dry_run["status"] == "blocked"
        assert dry_run["unsafe_lists"] == 1
        with pytest.raises(GroceryMembershipRepairBlocked, match="contains user data"):
            await run_repair(
                apply=True,
                repair_id="unsafe-repair",
                expected_users=1,
                expected_memberships=2,
                database_engine=database_engine,
            )

        async with database_engine.connect() as connection:
            assert await connection.scalar(text("SELECT COUNT(*) FROM grocery_lists")) == 2
            assert (
                await connection.scalar(
                    text("SELECT to_regclass('public.grocery_membership_repair_audit')")
                )
                is None
            )
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_repair_stops_on_expected_count_drift():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _reset_schema(database_engine)
        await _create_grocery_schema(database_engine)
        async with database_engine.begin() as connection:
            await connection.execute(
                text("""
                INSERT INTO grocery_lists (id) VALUES
                    ('40000000-0000-4000-8000-000000000001'),
                    ('40000000-0000-4000-8000-000000000002')
            """)
            )
            await connection.execute(
                text("""
                INSERT INTO grocery_list_members (list_id, user_id, joined_at) VALUES
                    ('40000000-0000-4000-8000-000000000001', 'drift-user', '2026-04-01'),
                    ('40000000-0000-4000-8000-000000000002', 'drift-user', '2026-04-02')
            """)
            )

        with pytest.raises(GroceryMembershipRepairBlocked, match="count changed"):
            await run_repair(
                apply=True,
                repair_id="drift-repair",
                expected_users=2,
                expected_memberships=2,
                database_engine=database_engine,
            )
        async with database_engine.connect() as connection:
            assert await connection.scalar(text("SELECT COUNT(*) FROM grocery_lists")) == 2
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()


@pytest.mark.asyncio
async def test_repair_is_not_applicable_before_grocery_schema_exists():
    assert TEST_DATABASE_URL
    database_engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _reset_schema(database_engine)
        result = await run_repair(
            apply=True,
            repair_id="fresh-database",
            expected_users=11,
            expected_memberships=31,
            database_engine=database_engine,
        )
        assert result == {
            "status": "not_applicable",
            "apply": True,
            "repair_id": "fresh-database",
        }
    finally:
        await _reset_schema(database_engine)
        await database_engine.dispose()

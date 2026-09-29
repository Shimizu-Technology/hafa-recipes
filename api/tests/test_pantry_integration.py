"""PostgreSQL coverage for private and shared pantry inventory transitions."""

import asyncio
import importlib
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models import grocery, identity, pantry, recipe  # noqa: F401
from app.models.grocery import GroceryItem, GroceryList, GroceryListInvite, GroceryListMember
from app.models.identity import AppUser
from app.models.pantry import PantryItem, PantrySpace
from app.routers.grocery import create_invite, join_list, leave_list
from app.routers.pantry import (
    PantryCopyRequest,
    PantryItemChanges,
    PantryMutationRequest,
    PantryTransferRequest,
    copy_personal_pantry,
    get_pantry_snapshot,
    sync_pantry_mutation,
    transfer_checked_groceries,
)
from app.routers.users import delete_account

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration coverage",
)


def _user(user_id: str) -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://development.clerk.example.test",
        clerk_environment="development",
        first_name=user_id.title(),
    )


@pytest.fixture
async def pantry_database():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


async def _seed_user(sessions, user_id: str) -> None:
    async with sessions() as db:
        db.add(AppUser(id=user_id))
        await db.commit()


async def _add_pantry_item(sessions, user_id: str, space_id, name: str, *, scope="active"):
    item_id = uuid4()
    async with sessions() as db:
        result = await sync_pantry_mutation(
            PantryMutationRequest(
                mutation_id=uuid4(),
                space_id=space_id,
                scope=scope,
                operation="add",
                item_id=item_id,
                item={"name": name, "quantity": "2", "unit": "cup"},
            ),
            db,
            _user(user_id),
        )
    return item_id, result


@pytest.mark.asyncio
async def test_copy_personal_only_adds_new_lots_and_is_replay_safe(pantry_database):
    await _seed_user(pantry_database, "alice")
    async with pantry_database() as db:
        personal = await get_pantry_snapshot("personal", db, _user("alice"))
    await _add_pantry_item(pantry_database, "alice", personal.space_id, "Rice", scope="personal")

    async with pantry_database() as db:
        await create_invite(db, _user("alice"))
    async with pantry_database() as db:
        household = await get_pantry_snapshot("active", db, _user("alice"))
    assert household.scope == "household"
    assert household.items == []

    request = PantryCopyRequest(mutation_id=uuid4(), space_id=household.space_id)
    async with pantry_database() as db:
        copied = await copy_personal_pantry(request, db, _user("alice"))
    async with pantry_database() as db:
        replay = await copy_personal_pantry(request, db, _user("alice"))
    async with pantry_database() as db:
        no_op = await copy_personal_pantry(
            PantryCopyRequest(mutation_id=uuid4(), space_id=household.space_id),
            db,
            _user("alice"),
        )
    assert [item.name for item in copied.snapshot.items] == ["Rice"]
    assert copied.snapshot.revision == 1
    assert len(copied.snapshot.copied_personal_item_ids) == 1
    assert replay.replayed is True
    assert no_op.snapshot.revision == 1

    copied_item_id = copied.snapshot.items[0].id
    async with pantry_database() as db:
        await sync_pantry_mutation(
            PantryMutationRequest(
                mutation_id=uuid4(),
                space_id=household.space_id,
                operation="delete",
                item_id=copied_item_id,
                base_revision=1,
            ),
            db,
            _user("alice"),
        )
    async with pantry_database() as db:
        after_delete = await copy_personal_pantry(
            PantryCopyRequest(mutation_id=uuid4(), space_id=household.space_id),
            db,
            _user("alice"),
        )
    assert after_delete.snapshot.items == []

    await _add_pantry_item(pantry_database, "alice", personal.space_id, "Flour", scope="personal")
    async with pantry_database() as db:
        later = await copy_personal_pantry(
            PantryCopyRequest(mutation_id=uuid4(), space_id=household.space_id),
            db,
            _user("alice"),
        )
    assert {item.name for item in later.snapshot.items} == {"Flour"}
    assert later.snapshot.revision == 3
    async with pantry_database() as db:
        assert await db.scalar(select(func.count()).select_from(PantryItem)) == 3


@pytest.mark.asyncio
async def test_pantry_update_rejects_null_name_and_stale_revision(pantry_database):
    await _seed_user(pantry_database, "alice")
    async with pantry_database() as db:
        snapshot = await get_pantry_snapshot("active", db, _user("alice"))
    item_id, added = await _add_pantry_item(pantry_database, "alice", snapshot.space_id, "Milk")
    with pytest.raises(ValidationError):
        PantryItemChanges(name=None)

    async with pantry_database() as db:
        changed = await sync_pantry_mutation(
            PantryMutationRequest(
                mutation_id=uuid4(),
                space_id=snapshot.space_id,
                operation="update",
                item_id=item_id,
                changes={"name": "  Oat milk  "},
                base_revision=added.snapshot.revision,
            ),
            db,
            _user("alice"),
        )
    assert changed.snapshot.items[0].name == "Oat milk"
    async with pantry_database() as db:
        with pytest.raises(HTTPException) as stale:
            await sync_pantry_mutation(
                PantryMutationRequest(
                    mutation_id=uuid4(),
                    space_id=snapshot.space_id,
                    operation="delete",
                    item_id=item_id,
                    base_revision=added.snapshot.revision,
                ),
                db,
                _user("alice"),
            )
    assert stale.value.status_code == 409


@pytest.mark.asyncio
async def test_checked_groceries_transfer_once_and_report_source_ids(pantry_database):
    await _seed_user(pantry_database, "alice")
    async with pantry_database() as db:
        snapshot = await get_pantry_snapshot("active", db, _user("alice"))
        list_id = await db.scalar(
            select(GroceryListMember.list_id).where(GroceryListMember.user_id == "alice")
        )
        grocery_item = GroceryItem(user_id="alice", list_id=list_id, name="Eggs", checked=True)
        db.add(grocery_item)
        await db.commit()
        grocery_item_id = grocery_item.id
    request = PantryTransferRequest(
        mutation_id=uuid4(),
        space_id=snapshot.space_id,
        list_id=list_id,
        items=[{"grocery_item_id": grocery_item_id, "quantity": "12", "unit": "each"}],
    )
    async with pantry_database() as db:
        transferred = await transfer_checked_groceries(request, db, _user("alice"))
    async with pantry_database() as db:
        replay = await transfer_checked_groceries(request, db, _user("alice"))
    assert transferred.snapshot.transferred_grocery_item_ids == [grocery_item_id]
    assert transferred.snapshot.items[0].quantity == 12
    assert replay.replayed is True
    async with pantry_database() as db:
        with pytest.raises(HTTPException) as duplicate:
            await transfer_checked_groceries(
                request.model_copy(update={"mutation_id": uuid4()}),
                db,
                _user("alice"),
            )
    assert duplicate.value.status_code == 409


@pytest.mark.asyncio
async def test_join_preserves_sole_members_household_pantry(pantry_database):
    await _seed_user(pantry_database, "alice")
    await _seed_user(pantry_database, "bob")
    async with pantry_database() as db:
        personal = await get_pantry_snapshot("personal", db, _user("alice"))
    await _add_pantry_item(pantry_database, "alice", personal.space_id, "Rice", scope="personal")
    async with pantry_database() as db:
        await create_invite(db, _user("alice"))
    async with pantry_database() as db:
        household = await get_pantry_snapshot("active", db, _user("alice"))
    async with pantry_database() as db:
        await copy_personal_pantry(
            PantryCopyRequest(mutation_id=uuid4(), space_id=household.space_id),
            db,
            _user("alice"),
        )
    await _add_pantry_item(pantry_database, "alice", household.space_id, "Beans")
    async with pantry_database() as db:
        await get_pantry_snapshot("active", db, _user("bob"))
        target_list_id = await db.scalar(
            select(GroceryListMember.list_id).where(GroceryListMember.user_id == "bob")
        )
        db.add(
            GroceryListInvite(
                list_id=target_list_id,
                invite_code="MOVE12345",
                created_by="bob",
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
        )
        await db.commit()
    async with pantry_database() as db:
        await join_list("MOVE12345", db, _user("alice"))
    async with pantry_database() as db:
        private_after = await get_pantry_snapshot("personal", db, _user("alice"))
        assert {item.name for item in private_after.items} == {"Rice", "Beans"}
        assert len(private_after.items) == 2
        assert await db.get(GroceryList, household.list_id) is None
        assert await db.get(PantrySpace, household.space_id) is None


@pytest.mark.asyncio
async def test_manager_departure_promotes_surviving_member(pantry_database):
    await _seed_user(pantry_database, "alice")
    await _seed_user(pantry_database, "bob")
    async with pantry_database() as db:
        await create_invite(db, _user("alice"))
        invite = await db.scalar(
            select(GroceryListInvite).where(GroceryListInvite.created_by == "alice")
        )
        code = invite.invite_code
    async with pantry_database() as db:
        await join_list(code, db, _user("bob"))
    async with pantry_database() as db:
        await leave_list(db, _user("alice"))
    async with pantry_database() as db:
        member = await db.scalar(
            select(GroceryListMember).where(GroceryListMember.user_id == "bob")
        )
        assert member.role == "manager"
    async with pantry_database() as db:
        new_invite = await create_invite(db, _user("bob"))
    assert new_invite.invite_code


@pytest.mark.asyncio
async def test_account_deletion_preserves_shared_pantry_and_manager(pantry_database):
    await _seed_user(pantry_database, "alice")
    await _seed_user(pantry_database, "bob")
    async with pantry_database() as db:
        invite = await create_invite(db, _user("alice"))
    async with pantry_database() as db:
        await join_list(invite.invite_code, db, _user("bob"))
    async with pantry_database() as db:
        shared = await get_pantry_snapshot("active", db, _user("alice"))
    await _add_pantry_item(pantry_database, "alice", shared.space_id, "Taro")
    async with pantry_database() as db:
        await delete_account(db, _user("alice"))
    async with pantry_database() as db:
        remaining = await get_pantry_snapshot("active", db, _user("bob"))
        member = await db.scalar(
            select(GroceryListMember).where(GroceryListMember.user_id == "bob")
        )
    assert [item.name for item in remaining.items] == ["Taro"]
    assert remaining.space_id == shared.space_id
    assert member.role == "manager"


@pytest.mark.asyncio
async def test_concurrent_stale_pantry_updates_do_not_overwrite(pantry_database):
    await _seed_user(pantry_database, "alice")
    async with pantry_database() as db:
        snapshot = await get_pantry_snapshot("active", db, _user("alice"))
    item_id, added = await _add_pantry_item(pantry_database, "alice", snapshot.space_id, "Rice")

    async def change(name: str):
        async with pantry_database() as db:
            return await sync_pantry_mutation(
                PantryMutationRequest(
                    mutation_id=uuid4(),
                    space_id=snapshot.space_id,
                    operation="update",
                    item_id=item_id,
                    changes={"name": name},
                    base_revision=added.snapshot.revision,
                ),
                db,
                _user("alice"),
            )

    results = await asyncio.gather(
        change("Brown rice"), change("White rice"), return_exceptions=True
    )
    assert len([result for result in results if not isinstance(result, Exception)]) == 1
    conflicts = [result for result in results if isinstance(result, HTTPException)]
    assert len(conflicts) == 1
    assert conflicts[0].status_code == 409


@pytest.mark.asyncio
async def test_migration_backfills_existing_households_and_creates_copy_constraint(
    pantry_database, monkeypatch
):
    engine = pantry_database.kw["bind"]
    async with engine.begin() as connection:
        await connection.execute(text("DROP TABLE pantry_mutation_receipts"))
        await connection.execute(text("DROP TABLE pantry_transfer_receipts"))
        await connection.execute(text("DROP TABLE pantry_copy_receipts"))
        await connection.execute(text("DROP TABLE pantry_items"))
        await connection.execute(text("DROP TABLE pantry_spaces"))
        await connection.execute(text("ALTER TABLE grocery_lists DROP COLUMN household_enabled"))
        await connection.execute(text("ALTER TABLE grocery_list_members DROP COLUMN role"))
        await connection.execute(text("ALTER TABLE grocery_list_invites DROP COLUMN expires_at"))
        await connection.execute(text("ALTER TABLE grocery_list_invites DROP COLUMN revoked_at"))
        await connection.execute(
            text(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name VARCHAR(160) NOT NULL)"
            )
        )
        await connection.execute(
            text("INSERT INTO schema_migrations (version, name) VALUES (30, 'capture idempotency')")
        )
        await connection.execute(text("INSERT INTO app_users (id) VALUES ('alice'), ('bob'), ('charlie')"))
        await connection.execute(
            text(
                "INSERT INTO grocery_lists (id, name) VALUES ('10000000-0000-4000-8000-000000000001', 'First'), ('10000000-0000-4000-8000-000000000002', 'Second')"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO grocery_list_members (list_id, user_id) VALUES ('10000000-0000-4000-8000-000000000001', 'alice'), ('10000000-0000-4000-8000-000000000002', 'bob')"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO grocery_list_members (list_id, user_id, joined_at) VALUES ('10000000-0000-4000-8000-000000000001', 'charlie', NOW() + INTERVAL '1 minute')"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO grocery_list_invites (id, list_id, invite_code, created_by) VALUES ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'OLDINVITE', 'alice')"
            )
        )

    migration = importlib.import_module("migrations.031_add_household_pantry")
    monkeypatch.setattr(migration, "engine", engine)
    await migration.run_migration()
    await migration.run_migration()
    async with engine.connect() as connection:
        rows = (
            await connection.execute(
                text("SELECT id::text, household_enabled FROM grocery_lists ORDER BY id")
            )
        ).all()
        source_column = await connection.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pantry_items' AND column_name = 'source_personal_item_id'"
            )
        )
        roles = (
            await connection.execute(
                text("SELECT user_id, role FROM grocery_list_members ORDER BY user_id")
            )
        ).all()
    assert rows == [
        ("10000000-0000-4000-8000-000000000001", True),
        ("10000000-0000-4000-8000-000000000002", False),
    ]
    assert source_column == 1
    assert roles == [('alice', 'manager'), ('bob', 'manager'), ('charlie', 'member')]

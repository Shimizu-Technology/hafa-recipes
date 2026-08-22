"""PostgreSQL coverage for durable grocery mutation ordering and isolation."""

import asyncio
import importlib
import os
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.routers.grocery as grocery_router_module
from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import Base
from app.grocery_sync import verify_grocery_sync_schema
from app.models import grocery, identity, recipe  # noqa: F401
from app.models.grocery import (
    GroceryItem,
    GroceryList,
    GroceryListInvite,
    GroceryListMember,
    GroceryMutationReceipt,
)
from app.models.identity import AppUser
from app.routers.grocery import (
    GroceryItemCreate,
    GroceryMutationRequest,
    add_grocery_item,
    get_grocery_snapshot,
    join_list,
    sync_grocery_mutation,
    toggle_grocery_item,
)
from app.routers.grocery import router as grocery_router

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
        first_name=user_id.replace("_", " ").title(),
    )


@pytest.fixture
async def grocery_database(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)

    migration = importlib.import_module("migrations.023_add_grocery_sync_contract")
    monkeypatch.setattr(migration, "engine", engine)
    await migration.run_migration()
    await migration.run_migration()

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    await verify_grocery_sync_schema(sessions)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


async def _seed_list(sessions, *user_ids: str) -> GroceryList:
    async with sessions() as db:
        db.add_all(AppUser(id=user_id) for user_id in user_ids)
        grocery_list = GroceryList(name="Saturday shopping")
        db.add(grocery_list)
        await db.flush()
        db.add_all(
            GroceryListMember(
                list_id=grocery_list.id,
                user_id=user_id,
                display_name=user_id.replace("_", " ").title(),
            )
            for user_id in user_ids
        )
        await db.commit()
        return grocery_list


async def _seed_invite(sessions, grocery_list: GroceryList, creator_id: str, code: str):
    async with sessions() as db:
        db.add(
            GroceryListInvite(
                list_id=grocery_list.id,
                invite_code=code,
                created_by=creator_id,
            )
        )
        await db.commit()


@pytest.mark.asyncio
async def test_add_replay_returns_one_item_and_rejects_changed_payload(grocery_database):
    grocery_list = await _seed_list(grocery_database, "stable_user")
    mutation_id = uuid4()
    item_id = uuid4()

    def request(name: str) -> GroceryMutationRequest:
        return GroceryMutationRequest(
            mutation_id=mutation_id,
            operation="add",
            list_id=grocery_list.id,
            item_id=item_id,
            item={"name": name, "quantity": "1", "unit": "carton"},
        )

    async with grocery_database() as db:
        created = await sync_grocery_mutation(request("Milk"), db, _user("stable_user"))
    async with grocery_database() as db:
        replayed = await sync_grocery_mutation(request("Milk"), db, _user("stable_user"))
    async with grocery_database() as db:
        with pytest.raises(HTTPException) as conflict:
            await sync_grocery_mutation(request("Oat milk"), db, _user("stable_user"))

    assert created.replayed is False
    assert created.snapshot.list.id == grocery_list.id
    assert created.snapshot.list.revision == 1
    assert created.snapshot.account_scope_id.startswith("gacct_")
    assert "stable_user" not in created.snapshot.account_scope_id
    assert [item.name for item in created.snapshot.items] == ["Milk"]
    assert replayed.replayed is True
    assert replayed.snapshot.list.revision == 1
    assert replayed.snapshot.total == 1
    assert conflict.value.status_code == 409

    async with grocery_database() as db:
        assert await db.scalar(select(func.count()).select_from(GroceryItem)) == 1
        assert await db.scalar(select(func.count()).select_from(GroceryMutationReceipt)) == 1


@pytest.mark.asyncio
async def test_desired_checked_state_is_safe_after_lost_response(grocery_database):
    grocery_list = await _seed_list(grocery_database, "stable_user")
    item_id = uuid4()
    add = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="add",
        list_id=grocery_list.id,
        item_id=item_id,
        item={"name": "Rice"},
    )
    checked = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="set_checked",
        list_id=grocery_list.id,
        item_id=item_id,
        checked=True,
    )

    async with grocery_database() as db:
        await sync_grocery_mutation(add, db, _user("stable_user"))
    async with grocery_database() as db:
        first = await sync_grocery_mutation(checked, db, _user("stable_user"))
    async with grocery_database() as db:
        retry = await sync_grocery_mutation(checked, db, _user("stable_user"))

    assert first.snapshot.items[0].checked is True
    assert retry.replayed is True
    assert retry.snapshot.items[0].checked is True
    assert retry.snapshot.list.revision == 2


@pytest.mark.asyncio
async def test_concurrent_replay_executes_exactly_once(grocery_database):
    grocery_list = await _seed_list(grocery_database, "stable_user")
    request = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="add",
        list_id=grocery_list.id,
        item_id=uuid4(),
        item={"name": "Eggs"},
    )

    async def send():
        async with grocery_database() as db:
            return await sync_grocery_mutation(request, db, _user("stable_user"))

    responses = await asyncio.gather(send(), send())

    assert sorted(response.replayed for response in responses) == [False, True]
    assert {response.snapshot.list.revision for response in responses} == {1}
    async with grocery_database() as db:
        assert await db.scalar(select(func.count()).select_from(GroceryItem)) == 1
        assert await db.scalar(select(func.count()).select_from(GroceryMutationReceipt)) == 1


@pytest.mark.asyncio
async def test_shared_member_cannot_mutate_another_lists_item(grocery_database):
    first_list = await _seed_list(grocery_database, "first_user")
    second_list = await _seed_list(grocery_database, "second_user")
    item = GroceryItem(
        user_id="first_user",
        list_id=first_list.id,
        name="Chicken",
        checked=False,
    )
    async with grocery_database() as db:
        db.add(item)
        await db.commit()
        item_id = item.id

    request = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="set_checked",
        list_id=second_list.id,
        item_id=item_id,
        checked=True,
    )
    async with grocery_database() as db:
        with pytest.raises(HTTPException) as missing:
            await sync_grocery_mutation(request, db, _user("second_user"))

    assert missing.value.status_code == 404
    async with grocery_database() as db:
        stored_item = await db.get(GroceryItem, item_id)
        stored_second_list = await db.get(GroceryList, second_list.id)
        receipt_count = await db.scalar(
            select(func.count()).select_from(GroceryMutationReceipt)
        )
    assert stored_item is not None and stored_item.checked is False
    assert stored_second_list is not None and stored_second_list.revision == 0
    assert receipt_count == 0


@pytest.mark.asyncio
async def test_stale_queue_cannot_cross_a_list_scope_change(grocery_database):
    old_list = await _seed_list(grocery_database, "old_user")
    new_list = await _seed_list(grocery_database, "current_user")
    request = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="add",
        list_id=old_list.id,
        item_id=uuid4(),
        item={"name": "Stale item"},
    )

    async with grocery_database() as db:
        with pytest.raises(HTTPException) as conflict:
            await sync_grocery_mutation(request, db, _user("current_user"))

    assert conflict.value.status_code == 409
    async with grocery_database() as db:
        current = await db.get(GroceryList, new_list.id)
        item_count = await db.scalar(select(func.count()).select_from(GroceryItem))
    assert current is not None and current.revision == 0
    assert item_count == 0


@pytest.mark.asyncio
async def test_snapshot_returns_stable_account_and_current_list_scope(grocery_database):
    grocery_list = await _seed_list(grocery_database, "stable_user", "housemate")
    async with grocery_database() as db:
        snapshot = await get_grocery_snapshot(db, _user("stable_user"))

    assert snapshot.account_scope_id.startswith("gacct_")
    assert "stable_user" not in snapshot.account_scope_id
    assert snapshot.list.id == grocery_list.id
    assert snapshot.list.is_shared is True
    assert snapshot.total == snapshot.checked == snapshot.unchecked == 0
    assert {member.user_id for member in snapshot.list.members} == {
        "housemate",
        "stable_user",
    }


@pytest.mark.asyncio
async def test_legacy_app_writes_advance_the_shared_revision(grocery_database):
    await _seed_list(grocery_database, "stable_user")
    async with grocery_database() as db:
        item = await add_grocery_item(
            GroceryItemCreate(name="Bananas"),
            db,
            _user("stable_user"),
        )
    async with grocery_database() as db:
        await toggle_grocery_item(item.id, db, _user("stable_user"))
    async with grocery_database() as db:
        snapshot = await get_grocery_snapshot(db, _user("stable_user"))

    assert snapshot.list.revision == 2
    assert snapshot.items[0].checked is True


@pytest.mark.asyncio
async def test_concurrent_first_reads_create_one_personal_list(grocery_database):
    async with grocery_database() as db:
        db.add(AppUser(id="new_user"))
        await db.commit()

    async def read_snapshot():
        async with grocery_database() as db:
            return await get_grocery_snapshot(db, _user("new_user"))

    snapshots = await asyncio.gather(read_snapshot(), read_snapshot())

    assert snapshots[0].list.id == snapshots[1].list.id
    async with grocery_database() as db:
        membership_count = await db.scalar(
            select(func.count())
            .select_from(GroceryListMember)
            .where(GroceryListMember.user_id == "new_user")
        )
    assert membership_count == 1


@pytest.mark.asyncio
async def test_http_contract_serializes_snapshot_and_replay(grocery_database):
    grocery_list = await _seed_list(grocery_database, "stable_user")
    app = FastAPI()
    app.include_router(grocery_router)

    async def database_override():
        async with grocery_database() as db:
            yield db

    async def user_override():
        return _user("stable_user")

    app.dependency_overrides[get_db] = database_override
    app.dependency_overrides[get_current_user] = user_override
    transport = httpx.ASGITransport(app=app)
    payload = {
        "mutation_id": str(uuid4()),
        "operation": "add",
        "list_id": str(grocery_list.id),
        "item_id": str(uuid4()),
        "item": {"name": "Coffee"},
    }

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post("/api/grocery/sync", json=payload)
        replayed = await client.post("/api/grocery/sync", json=payload)
        snapshot = await client.get("/api/grocery/snapshot")

    assert created.status_code == 200
    assert created.json()["replayed"] is False
    assert replayed.status_code == 200
    assert replayed.json()["replayed"] is True
    assert snapshot.status_code == 200
    assert snapshot.json()["list"]["revision"] == 1
    assert snapshot.json()["items"][0]["name"] == "Coffee"


@pytest.mark.asyncio
async def test_sync_revalidates_scope_after_overlapping_membership_change(
    grocery_database,
    monkeypatch,
):
    old_list = await _seed_list(grocery_database, "moving_user")
    target_list = await _seed_list(grocery_database, "target_owner")
    await _seed_invite(grocery_database, target_list, "target_owner", "MOVE1234")
    list_locks_acquired = asyncio.Event()
    allow_join_to_finish = asyncio.Event()
    original_lock_many = grocery_router_module._lock_grocery_lists

    async def delayed_lock_many(db, list_ids):
        locked = await original_lock_many(db, list_ids)
        list_locks_acquired.set()
        await allow_join_to_finish.wait()
        return locked

    monkeypatch.setattr(grocery_router_module, "_lock_grocery_lists", delayed_lock_many)

    async def move_user():
        async with grocery_database() as db:
            return await join_list("MOVE1234", db, _user("moving_user"))

    stale_request = GroceryMutationRequest(
        mutation_id=uuid4(),
        operation="add",
        list_id=old_list.id,
        item_id=uuid4(),
        item={"name": "Must not cross lists"},
    )

    async def send_stale_mutation():
        async with grocery_database() as db:
            return await sync_grocery_mutation(stale_request, db, _user("moving_user"))

    join_task = asyncio.create_task(move_user())
    await asyncio.wait_for(list_locks_acquired.wait(), timeout=2)
    sync_task = asyncio.create_task(send_stale_mutation())
    await asyncio.sleep(0.05)
    assert sync_task.done() is False
    allow_join_to_finish.set()
    await asyncio.wait_for(join_task, timeout=2)
    with pytest.raises(HTTPException) as conflict:
        await asyncio.wait_for(sync_task, timeout=2)

    assert conflict.value.status_code == 409
    async with grocery_database() as db:
        moved_membership = await db.scalar(
            select(GroceryListMember.list_id).where(
                GroceryListMember.user_id == "moving_user"
            )
        )
        item_count = await db.scalar(select(func.count()).select_from(GroceryItem))
    assert moved_membership == target_list.id
    assert item_count == 0


@pytest.mark.asyncio
async def test_reciprocal_joins_lock_lists_in_one_order_without_deadlock(grocery_database):
    first_list = await _seed_list(grocery_database, "first_user", "first_anchor")
    second_list = await _seed_list(grocery_database, "second_user", "second_anchor")
    await _seed_invite(grocery_database, first_list, "first_anchor", "FIRST123")
    await _seed_invite(grocery_database, second_list, "second_anchor", "SECOND12")

    async def join(code: str, user_id: str):
        async with grocery_database() as db:
            return await join_list(code, db, _user(user_id))

    responses = await asyncio.wait_for(
        asyncio.gather(
            join("SECOND12", "first_user"),
            join("FIRST123", "second_user"),
        ),
        timeout=3,
    )

    assert {response["message"] for response in responses} == {
        "Successfully joined the grocery list!"
    }
    async with grocery_database() as db:
        memberships = dict(
            (
                await db.execute(
                    select(GroceryListMember.user_id, GroceryListMember.list_id).where(
                        GroceryListMember.user_id.in_({"first_user", "second_user"})
                    )
                )
            ).all()
        )
    assert memberships == {
        "first_user": second_list.id,
        "second_user": first_list.id,
    }

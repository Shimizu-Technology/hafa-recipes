"""PostgreSQL and HTTP coverage for the native grocery-widget contract."""

import importlib
import os
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import Base
from app.models import grocery, identity, recipe  # noqa: F401
from app.models.grocery import (
    GroceryItem,
    GroceryList,
    GroceryListMember,
    GroceryWidgetCredential,
)
from app.models.identity import AppUser
from app.routers.grocery_widget import router as grocery_widget_router
from app.widget_credentials import utc_now, verify_widget_credential_schema

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration coverage",
)


def _user(user_id: str = "stable_user") -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://development.clerk.example.test",
        clerk_environment="development",
        first_name=user_id.replace("_", " ").title(),
    )


@pytest.fixture
async def widget_database(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)

    for module_name in (
        "migrations.023_add_grocery_sync_contract",
        "migrations.024_add_grocery_widget_credentials",
    ):
        migration = importlib.import_module(module_name)
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    await verify_widget_credential_schema(sessions)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


async def _seed_list(sessions) -> tuple[GroceryList, GroceryItem]:
    async with sessions() as db:
        db.add_all([AppUser(id="stable_user"), AppUser(id="housemate")])
        grocery_list = GroceryList(name="Saturday shopping")
        db.add(grocery_list)
        await db.flush()
        db.add_all(
            [
                GroceryListMember(
                    list_id=grocery_list.id,
                    user_id="stable_user",
                    display_name="Stable User",
                ),
                GroceryListMember(
                    list_id=grocery_list.id,
                    user_id="housemate",
                    display_name="Housemate",
                ),
            ]
        )
        item = GroceryItem(
            user_id="stable_user",
            list_id=grocery_list.id,
            name="Rice",
            quantity="1",
            unit="bag",
            checked=False,
        )
        db.add(item)
        await db.commit()
        return grocery_list, item


def _app(sessions, *, user_id: str = "stable_user") -> FastAPI:
    app = FastAPI()
    app.include_router(grocery_widget_router)

    async def database_override():
        async with sessions() as db:
            yield db

    async def user_override():
        return _user(user_id)

    app.dependency_overrides[get_db] = database_override
    app.dependency_overrides[get_current_user] = user_override
    return app


async def _issue(client: httpx.AsyncClient, installation_id=None) -> dict:
    response = await client.post(
        "/api/grocery/widget/credentials",
        json={"installation_id": str(installation_id or uuid4())},
        headers={"Authorization": "Bearer clerk-test-token"},
    )
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def _widget_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_issue_snapshot_and_replay_safe_checkoff(widget_database):
    grocery_list, item = await _seed_list(widget_database)
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = await _issue(client)
        snapshot = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(issued["token"]),
        )
        mutation_id = uuid4()
        payload = {
            "mutation_id": str(mutation_id),
            "list_id": str(grocery_list.id),
            "item_id": str(item.id),
            "checked": True,
        }
        checked = await client.post(
            "/api/grocery/widget/set-checked",
            json=payload,
            headers=_widget_headers(issued["token"]),
        )
        replay = await client.post(
            "/api/grocery/widget/set-checked",
            json=payload,
            headers=_widget_headers(issued["token"]),
        )

    assert issued["list_id"] == str(grocery_list.id)
    assert issued["scopes"] == ["grocery:read", "grocery:set_checked"]
    assert "stable_user" not in snapshot.text
    assert snapshot.status_code == 200
    assert snapshot.json()["list"]["is_shared"] is True
    assert snapshot.json()["items"][0]["name"] == "Rice"
    assert checked.status_code == replay.status_code == 200
    assert checked.json()["replayed"] is False
    assert replay.json()["replayed"] is True
    assert replay.json()["snapshot"]["items"][0]["checked"] is True
    assert replay.json()["snapshot"]["list"]["revision"] == 1

    async with widget_database() as db:
        stored = await db.get(GroceryWidgetCredential, issued["credential_id"])
        stored_item = await db.get(GroceryItem, item.id)
        assert stored is not None
        assert issued["token"] != stored.token_hash
        assert issued["token"].split(".", 2)[2] not in stored.token_hash
        assert stored.last_used_at is not None
        assert stored_item is not None and stored_item.checked is True


@pytest.mark.asyncio
async def test_rotation_invalidates_the_previous_installation_secret(widget_database):
    await _seed_list(widget_database)
    installation_id = uuid4()
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await _issue(client, installation_id)
        rotated = await _issue(client, installation_id)
        old_snapshot = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(first["token"]),
        )
        new_snapshot = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(rotated["token"]),
        )

    assert rotated["credential_id"] == first["credential_id"]
    assert rotated["token"] != first["token"]
    assert old_snapshot.status_code == 401
    assert new_snapshot.status_code == 200
    async with widget_database() as db:
        count = await db.scalar(select(func.count()).select_from(GroceryWidgetCredential))
    assert count == 1


@pytest.mark.asyncio
async def test_widget_token_can_revoke_itself(widget_database):
    await _seed_list(widget_database)
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = await _issue(client)
        revoked = await client.delete(
            "/api/grocery/widget/session",
            headers=_widget_headers(issued["token"]),
        )
        snapshot = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(issued["token"]),
        )

    assert revoked.status_code == 204
    assert snapshot.status_code == 401


@pytest.mark.asyncio
async def test_clerk_session_can_revoke_only_its_own_widget_credential(widget_database):
    await _seed_list(widget_database)
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = await _issue(client)
        revoked = await client.delete(
            f"/api/grocery/widget/credentials/{issued['credential_id']}",
            headers={"Authorization": "Bearer clerk-test-token"},
        )
        snapshot = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(issued["token"]),
        )

    assert revoked.status_code == 204
    assert snapshot.status_code == 401


@pytest.mark.asyncio
async def test_membership_change_invalidates_the_bound_list_scope(widget_database):
    grocery_list, _ = await _seed_list(widget_database)
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = await _issue(client)
        async with widget_database() as db:
            await db.execute(
                delete(GroceryListMember).where(
                    GroceryListMember.user_id == "stable_user"
                )
            )
            replacement = GroceryList(name="Replacement")
            db.add(replacement)
            await db.flush()
            db.add(
                GroceryListMember(
                    list_id=replacement.id,
                    user_id="stable_user",
                    display_name="Stable User",
                )
            )
            await db.commit()

        snapshot = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(issued["token"]),
        )

    assert snapshot.status_code == 409
    assert "reconnect" in snapshot.json()["detail"]
    async with widget_database() as db:
        original = await db.get(GroceryList, grocery_list.id)
        assert original is not None


@pytest.mark.asyncio
async def test_widget_cannot_check_an_item_from_another_list(widget_database):
    grocery_list, _ = await _seed_list(widget_database)
    async with widget_database() as db:
        db.add(AppUser(id="other_user"))
        other_list = GroceryList(name="Other")
        db.add(other_list)
        await db.flush()
        db.add(
            GroceryListMember(
                list_id=other_list.id,
                user_id="other_user",
                display_name="Other User",
            )
        )
        other_item = GroceryItem(
            user_id="other_user",
            list_id=other_list.id,
            name="Private item",
            checked=False,
        )
        db.add(other_item)
        await db.commit()
        other_item_id = other_item.id

    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = await _issue(client)
        response = await client.post(
            "/api/grocery/widget/set-checked",
            json={
                "mutation_id": str(uuid4()),
                "list_id": str(grocery_list.id),
                "item_id": str(other_item_id),
                "checked": True,
            },
            headers=_widget_headers(issued["token"]),
        )

    assert response.status_code == 404
    async with widget_database() as db:
        stored = await db.get(GroceryItem, other_item_id)
        assert stored is not None and stored.checked is False


@pytest.mark.asyncio
async def test_expired_credential_and_unversioned_bearer_are_rejected(widget_database):
    await _seed_list(widget_database)
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = await _issue(client)
        async with widget_database() as db:
            credential = await db.get(
                GroceryWidgetCredential, issued["credential_id"]
            )
            now = utc_now()
            credential.issued_at = now - timedelta(days=2)
            credential.expires_at = now - timedelta(days=1)
            await db.commit()

        expired = await client.get(
            "/api/grocery/widget/snapshot",
            headers=_widget_headers(issued["token"]),
        )
        clerk_token = await client.get(
            "/api/grocery/widget/snapshot",
            headers={"Authorization": "Bearer not-a-widget-token"},
        )

    assert expired.status_code == clerk_token.status_code == 401


@pytest.mark.asyncio
async def test_installation_cap_is_enforced_without_leaking_tokens(widget_database):
    await _seed_list(widget_database)
    transport = httpx.ASGITransport(app=_app(widget_database))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        issued = [await _issue(client) for _ in range(5)]
        overflow = await client.post(
            "/api/grocery/widget/credentials",
            json={"installation_id": str(uuid4())},
            headers={"Authorization": "Bearer clerk-test-token"},
        )

    assert overflow.status_code == 409
    assert len({item["credential_id"] for item in issued}) == 5
    async with widget_database() as db:
        stored_hashes = set(
            (
                await db.execute(select(GroceryWidgetCredential.token_hash))
            ).scalars().all()
        )
    assert all(item["token"] not in stored_hashes for item in issued)

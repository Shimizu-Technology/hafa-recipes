"""Collections list previews and malformed collection IDs."""

import os
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.db.database import Base, get_db
from app.models import ai, deletion, grocery, identity, meal_plan, moderation  # noqa: F401
from app.models import recipe as recipe_models  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import Collection, CollectionRecipe, Recipe
from app.routers import collections
from tests.database_safety import require_disposable_test_database

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def _user(user_id: str) -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )


def _recipe(owner: str, title: str, *, is_public: bool = False) -> Recipe:
    return Recipe(
        source_url=f"https://example.com/{title}",
        source_type="web",
        extracted={
            "title": title,
            "components": [],
            "ingredients": [],
            "steps": [],
            "nutrition": {"perServing": {}, "total": {}},
        },
        user_id=owner,
        is_public=is_public,
        thumbnail_url=f"https://media.example.com/thumbnails/{title}.webp",
        review_state="ready",
    )


def test_malformed_collection_ids_are_not_found_instead_of_server_errors():
    app = FastAPI()
    app.include_router(collections.router)
    app.dependency_overrides[get_current_user] = lambda: _user("owner")

    async def no_db():
        yield None

    app.dependency_overrides[get_db] = no_db

    with TestClient(app) as client:
        responses = [
            client.get("/api/collections/not-a-uuid"),
            client.put("/api/collections/not-a-uuid", json={"name": "x"}),
            client.delete("/api/collections/not-a-uuid"),
            client.get("/api/collections/not-a-uuid/recipes"),
            client.get("/api/collections/not-a-uuid/recipe-ids"),
            client.post("/api/collections/not-a-uuid/recipes", json={"recipe_id": "x"}),
            client.delete("/api/collections/not-a-uuid/recipes/not-a-uuid"),
        ]
        recipe_collections = client.get("/api/collections/recipe/not-a-uuid/collections")

    assert [response.status_code for response in responses] == [404] * len(responses)
    assert responses[0].json() == {"detail": "Collection not found"}
    assert recipe_collections.status_code == 200
    assert recipe_collections.json() == []


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)
@pytest.mark.asyncio
async def test_collection_previews_load_in_constant_queries_and_respect_access():
    assert TEST_DATABASE_URL
    require_disposable_test_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    owner = _user("collections_owner")
    other = _user("collections_other")
    now = datetime.now(UTC)

    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as db:
            db.add_all([AppUser(id=owner.id), AppUser(id=other.id)])
            await db.flush()
            mine = [_recipe(owner.id, f"mine-{index}") for index in range(6)]
            foreign_private = _recipe(other.id, "foreign-private")
            db.add_all([*mine, foreign_private])
            await db.flush()
            full = Collection(user_id=owner.id, name="Full", created_at=now)
            small = Collection(
                user_id=owner.id, name="Small", created_at=now - timedelta(days=1)
            )
            empty = Collection(
                user_id=owner.id, name="Empty", created_at=now - timedelta(days=2)
            )
            db.add_all([full, small, empty])
            await db.flush()
            db.add_all(
                [
                    CollectionRecipe(
                        collection_id=full.id,
                        recipe_id=recipe.id,
                        added_at=now - timedelta(minutes=index),
                    )
                    for index, recipe in enumerate(mine)
                ]
                + [
                    CollectionRecipe(
                        collection_id=small.id, recipe_id=mine[5].id, added_at=now
                    ),
                    CollectionRecipe(
                        collection_id=small.id,
                        recipe_id=foreign_private.id,
                        added_at=now + timedelta(minutes=1),
                    ),
                ]
            )
            await db.commit()

        statements: list[str] = []

        def record(_conn, _cursor, statement, *_args):
            statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", record)
        try:
            async with sessions() as db:
                result = await collections.get_collections(current_user=owner, db=db)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", record)

        assert [item.name for item in result] == ["Full", "Small", "Empty"]
        assert result[0].recipe_count == 6
        full_previews = result[0].preview_thumbnails
        assert len(full_previews) == 4
        assert all(f"mine-{index}" in url for index, url in enumerate(full_previews))
        assert len(result[1].preview_thumbnails) == 1
        assert "mine-5" in result[1].preview_thumbnails[0]
        assert result[1].recipe_count == 1
        assert result[2].preview_thumbnails == []
        assert len([s for s in statements if s.lstrip().upper().startswith("SELECT")]) == 2
    finally:
        await engine.dispose()

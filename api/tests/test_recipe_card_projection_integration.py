"""Stored PostgreSQL cards retain legacy rendering without loading unused payloads."""

import os
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import Base
from app.models.identity import AppUser
from app.models.recipe import Recipe
from app.recipe_review import apply_recipe_review
from app.routers.recipes import recipe_card_columns, recipe_to_list_item, router
from tests.database_safety import require_disposable_test_database

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.fixture
async def cards_database():
    require_disposable_test_database(DATABASE_URL)
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as db:
        await db.execute(text("DROP SCHEMA public CASCADE"))
        await db.execute(text("CREATE SCHEMA public"))
        await db.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as db:
            await db.execute(text("DROP SCHEMA public CASCADE"))
            await db.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


def content(title="Rice", *, quantity="1", incomplete=False):
    return {
        "title": title, "servings": None, "times": {"total": "20 minutes"},
        "tags": ["rice", "dinner"], "mealTypes": ["dinner"],
        "components": [{"name": "Main", "ingredients": [] if incomplete else [
            {"name": "rice", "quantity": quantity, "unit": "cup"},
        ], "steps": [] if incomplete else ["Cook the rice"]}],
        "notes": "Ordinary cooking tip. " * 20000,
        "media": {"unused": "large media metadata" * 20000},
        "nutrition": {"unused": "large nutrition metadata" * 20000},
        "derivedData": {"unused": "large derivation metadata" * 20000},
    }


async def seed(sessions):
    async with sessions.begin() as db:
        db.add_all([AppUser(id="card_owner"), AppUser(id="other_owner")])
        await db.flush()
        recipes = []
        for index, (title, method, quantity, incomplete) in enumerate([
            ("Manual Rice", "manual", "1", False),
            ("Uncertain Rice", "whisper", None, False),
            ("Incomplete Rice", "whisper", "1", True),
        ]):
            recipe = Recipe(
                user_id="card_owner", source_url=f"manual://card-{index}",
                source_type="manual" if method == "manual" else "youtube",
                extraction_method=method, extracted=content(title, quantity=quantity, incomplete=incomplete),
                raw_text="unused private transcript" * 20000,
                original_extracted={"unused": "large original content" * 20000},
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=index),
                total_minutes=20, is_public=False,
            )
            apply_recipe_review(recipe, recipe.extracted, increment_revision=False)
            recipes.append(recipe)
        legacy = Recipe(
            user_id="card_owner", source_url="legacy://card", source_type="youtube",
            extraction_method="source-draft", is_public=True, review_state=None,
            extracted={**content("Legacy Rice"), "notes":
                       "The caption does not include the ingredients. " + "ordinary tips " * 20000},
            created_at=datetime(2026, 1, 4, tzinfo=timezone.utc), total_minutes=20,
        )
        recipes.append(legacy)
        fallback = Recipe(
            user_id="card_owner", source_url="legacy://fallback", source_type="youtube",
            extraction_method=None, extracted=content("Evidence Rice"),
            created_at=datetime(2026, 1, 5, tzinfo=timezone.utc), is_public=False,
        )
        apply_recipe_review(fallback, fallback.extracted, increment_revision=False)
        # Legacy records can recover the method from evidence when the column is absent.
        fallback.extraction_evidence["source"]["method"] = "whisper"
        recipes.append(fallback)
        missing = content()
        del missing["title"]
        recipes.append(Recipe(
            user_id="card_owner", source_url="manual://missing", source_type="manual",
            extracted=missing, created_at=datetime(2026, 1, 6, tzinfo=timezone.utc), is_public=False,
        ))
        recipes.append(Recipe(
            user_id="other_owner", source_url="private://other", source_type="manual",
            extracted=content("Secret Rice"), is_public=False,
            created_at=datetime(2026, 1, 7, tzinfo=timezone.utc),
        ))
        recipes.extend([
            Recipe(user_id="other_owner", source_url="legacy://json-null", source_type="manual",
                   extracted=None, is_public=False,
                   created_at=datetime(2020, 1, 1, tzinfo=timezone.utc)),
            Recipe(user_id="other_owner", source_url="legacy://empty-object", source_type="manual",
                   extracted={}, is_public=False,
                   created_at=datetime(2020, 1, 2, tzinfo=timezone.utc)),
        ])
        db.add_all(recipes)


async def test_database_projection_matches_full_renderer_without_lazy_loads(cards_database):
    await seed(cards_database)
    async with cards_database() as db:
        full = (await db.execute(select(Recipe).order_by(Recipe.created_at))).scalars().all()
        expected = {row.id: recipe_to_list_item(row, "card_owner").model_dump(mode="json")
                    for row in full}
    async with cards_database() as db:
        cards = (await db.execute(select(*recipe_card_columns()).order_by(Recipe.created_at))).all()
    # Rendering after closing both sessions proves the projection has no ORM lazy IO.
    assert {row.id: recipe_to_list_item(row, "card_owner").model_dump(mode="json")
            for row in cards} == expected
    by_title = {(row.extracted or {}).get("title"): row for row in cards}
    assert cards[0].extracted is None
    assert cards[1].extracted == {}
    manual = by_title["Manual Rice"]
    assert "notes" not in manual.extracted
    assert len(str(manual.extracted)) < 1000
    assert "notes" not in by_title[None].extracted
    assert "notes" in by_title["Evidence Rice"].extracted
    assert "caption does not include" in by_title["Legacy Rice"].extracted["notes"]
    assert all("nutrition" not in (row.extracted or {}) and "media" not in (row.extracted or {})
               and "derivedData" not in (row.extracted or {}) for row in cards)
    assert "raw_text" not in manual._mapping and "original_extracted" not in manual._mapping
    assert expected[by_title["Uncertain Rice"].id]["review_state"] == "needs_review"
    assert expected[by_title["Incomplete Rice"].id]["review_state"] == "source_incomplete"
    assert expected[by_title["Legacy Rice"].id]["is_public"] is False
    assert expected[by_title[None].id]["title"] == "Untitled Recipe"
    foreign = expected[by_title["Secret Rice"].id]
    assert foreign["user_id"].startswith("chef_") and foreign["user_id"] != "other_owner"
    assert foreign["is_owner"] is False


async def test_http_list_search_keep_owner_filters_sort_and_page_contract(cards_database):
    await seed(cards_database)
    user = ClerkUser(id="card_owner", clerk_user_id="card_subject", clerk_issuer="https://test.invalid",
                     clerk_environment="test")
    app = FastAPI()
    app.include_router(router)

    async def owned_session():
        async with cards_database() as db:
            yield db

    app.dependency_overrides[get_db] = owned_session
    app.dependency_overrides[get_current_user] = lambda: user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        listed = await client.get("/api/recipes/?limit=2&offset=1")
        assert listed.status_code == 200
        page = listed.json()
        assert (page["total"], page["limit"], page["offset"], page["has_more"]) == (6, 2, 1, True)
        assert [item["title"] for item in page["items"]] == ["Evidence Rice", "Legacy Rice"]
        assert all(item["is_owner"] and item["user_id"] == user.id for item in page["items"])
        assert all("extracted" not in item and "extraction_evidence" not in item for item in page["items"])
        search = await client.get("/api/recipes/search?q=rice&source_type=youtube&limit=2&offset=1")
        assert search.status_code == 200
        result = search.json()
        assert (result["total"], result["has_more"]) == (4, True)
        assert [item["title"] for item in result["items"]] == ["Legacy Rice", "Incomplete Rice"]
        assert "Secret Rice" not in str(result)
        filtered = await client.get("/api/recipes/search?q=rice&time_filter=quick&tags=dinner&meal_type=dinner")
        assert filtered.status_code == 200
        assert filtered.json()["total"] == 4
        assert all(item["title"] != "Secret Rice" for item in filtered.json()["items"])

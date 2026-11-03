"""Both search surfaces apply token AND before count and pagination."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.routers.recipes import search_public_recipes, search_recipes


@pytest.mark.asyncio
@pytest.mark.parametrize("public", [False, True])
@pytest.mark.parametrize("query,tokens", [
    ("Filled cookies ORANGE", ["filled", "cookies", "orange"]),
    ("  orange\tFilled   cookies  ", ["orange", "filled", "cookies"]),
    ("cookies", ["cookies"]),
    ("   ", []),
])
async def test_token_and_search_preserves_filters_and_pagination(public, query, tokens):
    result = MagicMock()
    result.scalar.return_value = 0
    result.all.return_value = []
    result.scalars.return_value.all.return_value = []
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    kwargs = dict(q=query, limit=20, offset=0, source_type=None, time_filter=None,
                  tags=None, meal_type=None, db=db)
    if public:
        response = await search_public_recipes(**kwargs, extractor_id=None, user=None)
    else:
        response = await search_recipes(**kwargs, ownership="own", user=SimpleNamespace(id="owner"))
    assert response.model_dump() == dict(items=[], total=0, limit=20, offset=0, has_more=False)
    assert db.execute.call_count == 2
    for call in db.execute.call_args_list:
        compiled = call.args[0].compile(dialect=postgresql.dialect())
        sql = str(compiled)
        values = list(compiled.params.values())
        for token in tokens:
            assert values.count(f"%{token}%") == 4
        assert sql.count(" OR ") >= 3 * len(tokens)
        assert sql.count(" AND ") >= len(tokens)
        assert "recipes.user_id" in sql if not public else "recipes.is_public" in sql


@pytest.mark.asyncio
async def test_search_matches_reordered_words_across_fields_in_postgres():
    import os
    from uuid import uuid4

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.db.database import Base
    from app.models.identity import AppUser
    from app.models.recipe import Recipe
    from tests.database_safety import require_disposable_test_database

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL required for PostgreSQL search execution")
    require_disposable_test_database(url)
    schema = f"search_tokens_{uuid4().hex}"
    admin = create_async_engine(url)
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add(AppUser(id="search-owner"))
            await db.flush()
            recipe = Recipe(
                id=uuid4(), user_id="search-owner", source_type="manual", is_public=True,
                source_url="manual://search-test", raw_text="",
                extracted={"title": "Filled Cookies with Chocolate and Orange",
                           "tags": ["festive"], "components": [{"ingredients": [{"name": "butter"}]}],
                           "steps": []},
            )
            db.add(recipe)
            await db.commit()
            for public in [False, True]:
                for query, expected in [
                    ("Filled cookies orange", 1), ("ORANGE filled COOKIES", 1),
                    ("  orange\tfilled  ", 1), ("cookies festive butter", 1),
                    ("cookies missing", 0),
                ]:
                    kwargs = dict(q=query, limit=20, offset=0, source_type=None,
                                  time_filter=None, tags=None, meal_type=None, db=db)
                    if public:
                        response = await search_public_recipes(**kwargs, extractor_id=None, user=None)
                    else:
                        response = await search_recipes(**kwargs, ownership="own", user=SimpleNamespace(id="search-owner"))
                    assert response.total == expected
                    assert len(response.items) == expected
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


def test_search_tokens_caps_long_queries():
    from app.routers.recipes import MAX_SEARCH_TOKENS, search_tokens
    assert search_tokens("Filled cookies ORANGE") == ["filled", "cookies", "orange"]
    assert search_tokens("   ") == []
    words = " ".join(f"w{i}" for i in range(50))
    assert search_tokens(words) == [f"w{i}" for i in range(MAX_SEARCH_TOKENS)]

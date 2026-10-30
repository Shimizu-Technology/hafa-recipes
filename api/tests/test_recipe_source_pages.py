"""Private originals, schema rollout, authorization and durable deletion receipts."""
import importlib
import io
import os
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.deletion_cleanup import is_allowed_cleanup_prefix
from app.models.deletion import DeletionCleanupJob
from app.models.identity import AppUser
from app.models.recipe import Recipe
from app.recipe_source_pages import (
    RecipeSourcePages,
    read_pages,
    remove_pages,
    source_prefix,
    upload_pages,
)
from tests.database_safety import require_disposable_test_database

URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL required")


@pytest.fixture
async def pages_db(monkeypatch):
    require_disposable_test_database(URL)
    expected = make_url(URL).database
    engine = create_async_engine(URL)
    async with engine.begin() as conn:
        assert await conn.scalar(text("select current_database()")) == expected
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
    storage = SimpleNamespace(is_enabled=True, bucket_name="test-private", client=Mock(), presign_client=Mock())
    storage.presign_client.generate_presigned_url.return_value = "https://signed.invalid/private"
    monkeypatch.setattr("app.recipe_source_pages.storage_service", storage)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([AppUser(id="owner"), AppUser(id="other")])
        await db.flush()
        recipe = Recipe(user_id="owner", source_url="photo-upload", source_type="photo", extracted={"title": "Family"}, is_public=True)
        db.add(recipe)
        await db.commit()
        yield db, recipe, storage
    await engine.dispose()


def user(owner="owner"):
    return ClerkUser(id=owner, clerk_user_id="clerk-test", clerk_issuer="https://development.clerk.accounts.dev", clerk_environment="development")


def page():
    data = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(data, "JPEG")
    data.seek(0)
    return UploadFile(file=data, filename="original.jpg")


@pytest.mark.asyncio
async def test_originals_owner_only_even_for_public_recipe(pages_db):
    db, recipe, storage = pages_db
    await upload_pages(recipe.id, [page(), page()], db, user())
    with pytest.raises(HTTPException) as error:
        await read_pages(recipe.id, db, user("other"))
    assert error.value.status_code == 404
    result = await read_pages(recipe.id, db, user())
    assert [item["page"] for item in result["pages"]] == [1, 2]
    assert storage.client.put_object.call_count == 2
    assert "ACL" not in storage.client.put_object.call_args.kwargs
    assert "source_pages" not in recipe.extracted
    assert storage.presign_client.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 60
    with pytest.raises(HTTPException) as conflict:
        await upload_pages(recipe.id, [page()], db, user())
    assert conflict.value.status_code == 409


@pytest.mark.asyncio
async def test_remove_queues_exact_batch_and_allows_safe_reupload(pages_db):
    db, recipe, _ = pages_db
    await upload_pages(recipe.id, [page()], db, user())
    old = (await db.get(RecipeSourcePages, recipe.id)).pages[0]["key"]
    await remove_pages(recipe.id, db, user())
    assert await read_pages(recipe.id, db, user()) == {"pages": []}
    queued = await db.scalar(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued"))
    assert queued.storage_prefixes == [old.rsplit("/", 1)[0] + "/"]
    assert is_allowed_cleanup_prefix(queued.storage_prefixes[0])
    await upload_pages(recipe.id, [page()], db, user())
    new = (await db.get(RecipeSourcePages, recipe.id)).pages[0]["key"]
    assert not new.startswith(queued.storage_prefixes[0])
    assert is_allowed_cleanup_prefix(source_prefix(recipe.id))
    assert not is_allowed_cleanup_prefix("recipe-originals/../")


@pytest.mark.asyncio
async def test_unmigrated_api_and_additive_replay(pages_db):
    db, recipe, _ = pages_db
    await db.execute(text("DROP TABLE recipe_source_pages"))
    await db.commit()
    assert await read_pages(recipe.id, db, user()) == {"pages": []}
    with pytest.raises(HTTPException) as error:
        await upload_pages(recipe.id, [page()], db, user())
    assert error.value.status_code == 503
    await db.rollback()
    await db.refresh(recipe)
    migration = importlib.import_module("migrations.054_add_recipe_source_pages")
    await migration.run_migration(migration_engine=db.bind)
    await migration.run_migration(migration_engine=db.bind)
    assert await db.get(Recipe, recipe.id) is not None
    await upload_pages(recipe.id, [page()], db, user())
    await db.delete(recipe)
    await db.commit()
    assert await db.get(RecipeSourcePages, recipe.id) is None


@pytest.mark.asyncio
async def test_page_bounds_and_orphan_receipt_survive_failed_storage(pages_db):
    db, recipe, storage = pages_db
    with pytest.raises(HTTPException) as error:
        await upload_pages(recipe.id, [page() for _ in range(11)], db, user())
    assert error.value.status_code == 422
    with pytest.raises(HTTPException):
        await upload_pages(recipe.id, [UploadFile(file=io.BytesIO(b"not an image"))], db, user())
    storage.client.put_object.side_effect = RuntimeError("storage offline")
    with pytest.raises(RuntimeError):
        await upload_pages(recipe.id, [page()], db, user())
    await db.rollback()
    await db.refresh(recipe)
    assert await db.get(RecipeSourcePages, recipe.id) is None
    queued = await db.scalar(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued"))
    assert queued is not None and queued.next_attempt_at is not None

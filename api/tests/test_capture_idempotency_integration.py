"""PostgreSQL capture retry, race, ownership, and response-loss contracts."""

import asyncio
import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.auth import ClerkUser
from app.models.identity import AppUser
from app.models.recipe import Recipe
from app.routers.recipes import CaptureRecipeCreate, _save_captured_recipe

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.fixture
async def capture_database():
    assert TEST_DATABASE_URL
    schema = f"capture_retry_{uuid4().hex}"
    admin = create_async_engine(TEST_DATABASE_URL)
    engine = create_async_engine(
        TEST_DATABASE_URL, connect_args={"server_settings": {"search_path": schema}}
    )
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        async with engine.begin() as connection:
            await connection.run_sync(AppUser.__table__.create)
            await connection.run_sync(Recipe.__table__.create)
            await connection.execute(AppUser.__table__.insert(), [
                {"id": "capture_owner"}, {"id": "other_owner"},
            ])
        yield engine
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


def _user(owner="capture_owner"):
    return ClerkUser(
        id=owner, clerk_user_id=f"clerk_{owner}", clerk_environment="test",
        clerk_issuer="https://capture.clerk.example.test",
    )


def _capture(**overrides):
    return CaptureRecipeCreate(**{
        "capture_id": uuid4(), "source_type": "text", "is_public": False,
        "extracted": {"title": "Rice", "components": [{"name": "Main", "ingredients": [
            {"name": "rice", "quantity": 1, "unit": "cup"},
        ], "steps": ["Cook the rice."]}]},
        **overrides,
    })


async def _save(engine, capture, owner="capture_owner", session_class=AsyncSession):
    async with session_class(engine, expire_on_commit=False) as db:
        return await _save_captured_recipe(capture, db, _user(owner))


@pytest.mark.asyncio
async def test_retry_after_commit_then_response_loss_returns_original_recipe(capture_database):
    class LostResponseSession(AsyncSession):
        async def refresh(self, *args, **kwargs):
            # The route commits before refreshing/serializing its response.
            # Lose that response only after the real database commit succeeded.
            raise TimeoutError("synthetic lost response after commit")

    capture = _capture()
    with pytest.raises(TimeoutError, match="after commit"):
        await _save(capture_database, capture, session_class=LostResponseSession)
    async with AsyncSession(capture_database) as db:
        saved_id = await db.scalar(select(Recipe.id))
    response = await _save(capture_database, capture)
    assert str(response.id) == str(saved_id)
    async with AsyncSession(capture_database) as db:
        assert await db.scalar(select(func.count()).select_from(Recipe)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("mismatch", [False, True])
async def test_concurrent_capture_commits_replay_or_conflict(capture_database, mismatch):
    barrier = asyncio.Barrier(2)

    class ConcurrentSaveSession(AsyncSession):
        async def commit(self):
            # Both requests finish their empty replay lookup before either writes.
            await asyncio.wait_for(barrier.wait(), timeout=10)
            await super().commit()

    first = _capture()
    second = first.model_copy(deep=True)
    if mismatch:
        second.extracted["title"] = "Different rice"

    async def attempt(payload):
        try:
            return await _save(capture_database, payload, session_class=ConcurrentSaveSession)
        except HTTPException as exc:
            assert exc.status_code == 409
            return None

    responses = await asyncio.wait_for(asyncio.gather(attempt(first), attempt(second)), timeout=20)
    successful = [response for response in responses if response is not None]
    assert len(successful) == (1 if mismatch else 2)
    assert len({str(response.id) for response in successful}) == 1
    async with AsyncSession(capture_database) as db:
        assert await db.scalar(select(func.count()).select_from(Recipe)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["privacy", "content", "source"])
async def test_key_reuse_with_changed_payload_cannot_overwrite(capture_database, change):
    capture = _capture()
    original = await _save(capture_database, capture)
    altered = capture.model_copy(deep=True)
    if change == "privacy":
        altered.is_public = True
    elif change == "source":
        altered.source_type = "photo"
    else:
        altered.extracted["title"] = "Changed"
    with pytest.raises(HTTPException) as error:
        await _save(capture_database, altered)
    assert error.value.status_code == 409
    replay = await _save(capture_database, capture)
    assert replay.id == original.id
    assert replay.is_public is False
    assert replay.extracted.title == "Rice"


@pytest.mark.asyncio
async def test_same_key_is_isolated_by_owner_and_cascades_with_account(capture_database):
    capture = _capture()
    first = await _save(capture_database, capture)
    second = await _save(capture_database, capture, owner="other_owner")
    assert first.id != second.id
    async with AsyncSession(capture_database) as db:
        await db.execute(delete(AppUser).where(AppUser.id == "capture_owner"))
        await db.commit()
        assert (await db.scalars(select(Recipe.user_id))).all() == ["other_owner"]
    assert (await _save(capture_database, capture, owner="other_owner")).id == second.id


@pytest.mark.asyncio
async def test_legacy_omission_keeps_independent_capture_saves(capture_database):
    capture = _capture(capture_id=None)
    first = await _save(capture_database, capture)
    second = await _save(capture_database, capture)
    assert first.id != second.id


@pytest.mark.asyncio
async def test_replay_preserves_later_edits_and_does_not_publish_again(capture_database):
    capture = _capture()
    original = await _save(capture_database, capture)
    async with AsyncSession(capture_database) as db:
        recipe = await db.get(Recipe, original.id)
        recipe.extracted = {**recipe.extracted, "title": "Owner correction"}
        await db.commit()
    replay = await _save(capture_database, capture)
    assert replay.id == original.id
    assert replay.extracted.title == "Owner correction"

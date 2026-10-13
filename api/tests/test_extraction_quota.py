"""Per-user budgets on paid recipe extraction routes."""

import io
import os
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.extraction_quota import (
    EXTRACTION_CAPABILITY,
    EXTRACTION_QUOTA_MESSAGE,
    EXTRACTION_QUOTA_WINDOWS,
)
from app.rate_limit import QuotaWindow, RateLimitExceeded, UserRateLimiter, ai_rate_limiter
from app.routers import extract
from app.services.llm_client import ExtractionResult
from tests.database_safety import require_disposable_test_database

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def _user(user_id: str = "quota_user", *, admin: bool = False) -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
        role="admin" if admin else None,
    )


def _client(user: ClerkUser) -> TestClient:
    app = FastAPI()
    app.include_router(extract.router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


async def _exhaust(user_id: str) -> None:
    """Consume whatever remains of the user's hourly extraction budget."""
    for _ in range(EXTRACTION_QUOTA_WINDOWS[0].limit + 1):
        try:
            await ai_rate_limiter.consume_quota(
                user_id=user_id,
                capability=EXTRACTION_CAPABILITY,
                windows=EXTRACTION_QUOTA_WINDOWS,
            )
        except RateLimitExceeded:
            return
    raise AssertionError("extraction budget was never exhausted")


def _png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(output, format="PNG")
    return output.getvalue()


@pytest.mark.asyncio
async def test_quota_enforces_every_window_and_reports_the_longest_wait():
    now = [1_000.0]
    limiter = UserRateLimiter(clock=lambda: now[0])
    windows = (QuotaWindow(seconds=60, limit=2), QuotaWindow(seconds=600, limit=3))

    await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    now[0] += 1
    await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    with pytest.raises(RateLimitExceeded) as minute:
        await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    assert minute.value.reason == "quota_exceeded"
    assert minute.value.retry_after == 59

    now[0] += 60
    await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    now[0] += 60
    with pytest.raises(RateLimitExceeded) as ten_minutes:
        await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    assert ten_minutes.value.retry_after == 600 - 121

    # Other users and capabilities have independent budgets.
    await limiter.consume_quota(user_id="other", capability="x", windows=windows)
    await limiter.consume_quota(user_id="u", capability="y", windows=windows)

    now[0] += 600
    await limiter.consume_quota(user_id="u", capability="x", windows=windows)


@pytest.mark.asyncio
async def test_quota_refund_returns_one_admission_and_idle_keys_are_pruned():
    now = [0.0]
    limiter = UserRateLimiter(clock=lambda: now[0])
    windows = (QuotaWindow(seconds=3600, limit=1),)

    token = await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    await limiter.refund_quota(user_id="u", capability="x", token=token)
    await limiter.refund_quota(user_id="u", capability="x", token=token)
    await limiter.consume_quota(user_id="u", capability="x", windows=windows)
    with pytest.raises(RateLimitExceeded):
        await limiter.consume_quota(user_id="u", capability="x", windows=windows)

    now[0] += 3600
    await limiter.consume_quota(user_id="v", capability="x", windows=windows)
    assert ("u", "x") not in limiter._quota_events


def test_text_extraction_returns_friendly_429_after_the_hourly_budget(monkeypatch):
    extractor = AsyncMock(
        return_value=ExtractionResult(success=True, recipe={"title": "Rice"})
    )
    monkeypatch.setattr("app.routers.extract.llm_service.extract_from_text", extractor)
    hourly = EXTRACTION_QUOTA_WINDOWS[0].limit

    with _client(_user()) as client:
        accepted = [
            client.post("/api/extract/text", json={"text": "1 cup rice. Cook it."})
            for _ in range(hourly)
        ]
        limited = client.post("/api/extract/text", json={"text": "1 cup rice. Cook it."})
    with _client(_user("someone_else")) as client:
        other = client.post("/api/extract/text", json={"text": "1 cup rice. Cook it."})

    assert all(response.status_code == 200 for response in accepted)
    assert limited.status_code == 429
    assert limited.json() == {"detail": EXTRACTION_QUOTA_MESSAGE}
    assert 0 < int(limited.headers["Retry-After"]) <= 3600
    assert extractor.await_count == hourly + 1
    assert other.status_code == 200


@pytest.mark.asyncio
async def test_admins_are_exempt_from_the_extraction_budget(monkeypatch):
    monkeypatch.setattr(
        "app.routers.extract.llm_service.extract_from_text",
        AsyncMock(return_value=ExtractionResult(success=True, recipe={"title": "Rice"})),
    )
    admin = _user("admin_user", admin=True)
    await _exhaust(admin.id)

    with _client(admin) as client:
        response = client.post("/api/extract/text", json={"text": "1 cup rice. Cook it."})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_ocr_routes_share_the_budget_and_reject_invalid_images_first(monkeypatch):
    monkeypatch.setattr(
        "app.routers.extract.settings.image_input_classification_enabled", False
    )
    extractor = AsyncMock()
    monkeypatch.setattr("app.routers.extract.llm_service.extract_from_image", extractor)
    monkeypatch.setattr("app.routers.extract.llm_service.extract_from_images", extractor)
    user = _user("ocr_user")
    await _exhaust(user.id)

    with _client(user) as client:
        oversized = client.post(
            "/api/extract/ocr",
            files={
                "image": (
                    "big.png",
                    b"\x89PNG" + b"0" * extract.MAX_OCR_IMAGE_BYTES,
                    "image/png",
                )
            },
        )
        single = client.post(
            "/api/extract/ocr",
            files={"image": ("recipe.png", _png_bytes(), "image/png")},
        )
        multi = client.post(
            "/api/extract/ocr/multi",
            files=[("images", ("recipe.png", _png_bytes(), "image/png"))],
        )

    assert oversized.status_code == 422
    assert "limit" in oversized.json()["detail"]
    assert single.status_code == 429
    assert multi.status_code == 429
    extractor.assert_not_awaited()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)
@pytest.mark.asyncio
async def test_async_extraction_replays_do_not_consume_or_need_quota(monkeypatch):
    from app.db.database import Base
    from app.models import ai, deletion, grocery, identity, meal_plan, moderation  # noqa: F401
    from app.models import recipe as recipe_models  # noqa: F401
    from app.models.identity import AppUser

    assert TEST_DATABASE_URL
    require_disposable_test_database(TEST_DATABASE_URL)
    monkeypatch.setattr(
        "app.services.video.VideoService.normalize_url", AsyncMock(side_effect=lambda url: url)
    )
    monkeypatch.setattr("app.routers.extract.job_worker.wake", lambda: None)
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    user = _user("async_quota_user")

    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add(AppUser(id=user.id))
            await db.commit()

        request = extract.ExtractRequest(url="https://example.com/rice")
        async with sessions() as db:
            first = await extract.start_extraction_job(
                request, idempotency_key="share:one", db=db, user=user
            )
        assert first["status"] == "queued"
        assert len(ai_rate_limiter._quota_events[(user.id, EXTRACTION_CAPABILITY)]) == 1

        await _exhaust(user.id)

        async with sessions() as db:
            replay = await extract.start_extraction_job(
                request, idempotency_key="share:one", db=db, user=user
            )
            in_progress = await extract.start_extraction_job(request, db=db, user=user)
        assert replay["job_id"] == first["job_id"]
        assert replay["is_existing"] is True
        assert in_progress["job_id"] == first["job_id"]

        async with sessions() as db:
            with pytest.raises(extract.HTTPException) as limited:
                await extract.start_extraction_job(
                    extract.ExtractRequest(url="https://example.com/beans"),
                    idempotency_key="share:two",
                    db=db,
                    user=user,
                )
        assert limited.value.status_code == 429
        assert limited.value.headers["Retry-After"]
    finally:
        await engine.dispose()

"""The optional account domain must stay dormant in the actual shared app."""

import httpx
import pytest

from app.auth import get_current_user
from app.db import get_db
from app.main import app


@pytest.mark.asyncio
async def test_actual_app_disabled_workouts_never_authenticates_or_queries_database():
    def forbidden():
        raise AssertionError("Disabled optional product reached a shared dependency")

    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_current_user] = forbidden
    app.dependency_overrides[get_db] = forbidden
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://api.example"
        ) as client:
            assert (await client.get("/up")).json() == {"status": "ok"}
            assert (await client.get("/")).json()["name"] == "Recipe Extractor API"
            for path in ("enrollment", "profile", "library", "programs", "sessions", "export"):
                response = await client.get("/api/v1/workouts/" + path)
                assert response.status_code == 404
                assert response.headers["Cache-Control"] == "no-store"
            response = await client.post("/api/v1/workouts/enrollment", content="invalid-json")
            assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


@pytest.mark.asyncio
async def test_browser_preview_can_read_profile_revision_headers():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://api.example"
    ) as client:
        response = await client.get("/up", headers={"Origin": "http://localhost:5190"})
        exposed = response.headers.get("access-control-expose-headers", "")
        assert "ETag" in exposed
        assert "X-Workouts-Revision" in exposed

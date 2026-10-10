"""The first Håfa product surface must not change installed Recipes contracts."""

import httpx
import pytest
from fastapi import FastAPI

from app.config import Settings
from app.routers import platform


def settings(**values):
    return Settings(
        database_url="postgresql://test:test@localhost/hafa_test",
        openai_api_key="test",
        environment="test",
        **values,
    )


@pytest.mark.parametrize(
    "flag",
    [
        "workouts_public_access_enabled",
        "workouts_imports_enabled",
        "workouts_ai_enabled",
        "workouts_health_sync_enabled",
    ],
)
def test_master_off_makes_stale_capability_switches_dormant_without_breaking_recipes(flag):
    configured = settings(**{flag: True})
    assert not getattr(configured, flag)
    assert (
        configured.api_title == "Håfa API"
    )  # OpenAPI metadata; legacy root contract remains separately frozen.


def test_all_workouts_capabilities_are_dormant_by_default():
    configured = settings()
    assert not any(
        (
            configured.workouts_api_enabled,
            configured.workouts_public_access_enabled,
            configured.workouts_imports_enabled,
            configured.workouts_ai_enabled,
            configured.workouts_health_sync_enabled,
        )
    )
    assert configured.workouts_testers == frozenset()


def test_environment_false_is_not_a_truthy_feature_switch(monkeypatch):
    monkeypatch.setenv("WORKOUTS_API_ENABLED", "false")
    monkeypatch.setenv("WORKOUTS_PUBLIC_ACCESS_ENABLED", "false")
    assert not settings().workouts_api_enabled
    assert not settings().workouts_public_access_enabled


@pytest.mark.parametrize(
    "api,public,expected",
    [(False, False, False), (False, True, False), (True, False, False), (True, True, True)],
)
async def test_discovery_exposes_only_public_availability_without_private_configuration(
    monkeypatch, api, public, expected
):
    monkeypatch.setattr(
        platform,
        "get_settings",
        lambda: settings(
            workouts_api_enabled=api,
            workouts_public_access_enabled=public,
            workouts_tester_user_ids="private-stable-owner-id",
        ),
    )
    app = FastAPI()
    app.include_router(platform.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/platform")
    assert response.status_code == 200
    result = response.json()
    assert result["schema_version"] == 1
    assert result["products"][0]["id"] == "recipes"
    assert result["products"][0]["available"] is True
    assert result["products"][1]["available"] is expected
    assert result["products"][1]["ios_store_url"] is None
    assert "private-stable-owner-id" not in response.text


async def test_legacy_root_and_liveness_remain_unchanged():
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        root = await client.get("/")
        up = await client.get("/up")
    assert root.json() == {
        "name": "Recipe Extractor API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/up",
    }
    assert up.json() == {"status": "ok"}


async def test_master_disable_preserves_recipes_surfaces_with_stale_enabled_children(monkeypatch):
    import app.main as main

    configured = settings(
        workouts_api_enabled=False,
        workouts_public_access_enabled=True,
        workouts_imports_enabled=True,
        workouts_ai_enabled=True,
        workouts_health_sync_enabled=True,
    )
    monkeypatch.setattr(main, "settings", configured)
    monkeypatch.setattr(platform, "get_settings", lambda: configured)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://test"
    ) as client:
        root = await client.get("/")
        up = await client.get("/up")
        discovery = await client.get("/api/v1/platform")
    assert root.status_code == up.status_code == discovery.status_code == 200
    assert root.json()["name"] == "Recipe Extractor API"
    assert up.json() == {"status": "ok"}
    assert discovery.json()["products"][0]["available"] is True
    assert discovery.json()["products"][1]["available"] is False

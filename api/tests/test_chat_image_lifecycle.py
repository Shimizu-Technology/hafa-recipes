from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import ClerkUser, get_current_user
from app.routers import chat


def _client() -> TestClient:
    user = ClerkUser(
        id="stable-user",
        clerk_user_id="clerk-user",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )
    app = FastAPI()
    app.include_router(chat.router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_delete_chat_images_uses_stable_authenticated_owner(monkeypatch):
    delete = AsyncMock(return_value=2)
    monkeypatch.setattr(chat.storage_service, "delete_chat_images", delete)

    with _client() as client:
        response = client.post(
            "/api/recipes/ai/delete-chat-images",
            json={"image_urls": ["https://example.test/one", "https://example.test/two"]},
        )

    assert response.status_code == 200
    assert response.json() == {"deleted": 2}
    delete.assert_awaited_once_with(
        ["https://example.test/one", "https://example.test/two"],
        "stable-user",
    )


def test_delete_chat_images_requires_authentication():
    app = FastAPI()
    app.include_router(chat.router)
    with TestClient(app) as client:
        response = client.post(
            "/api/recipes/ai/delete-chat-images",
            json={"image_urls": ["https://example.test/one"]},
        )
    assert response.status_code == 401


def test_delete_chat_images_bounds_batch_size():
    with _client() as client:
        response = client.post(
            "/api/recipes/ai/delete-chat-images",
            json={"image_urls": [f"https://example.test/{index}" for index in range(51)]},
        )
    assert response.status_code == 422

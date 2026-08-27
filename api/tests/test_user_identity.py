from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import ClerkUser, get_current_user
from app.routers import users


def test_current_identity_returns_stable_application_user_id():
    user = ClerkUser(
        id="stable-application-user",
        clerk_user_id="clerk-subject",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )
    app = FastAPI()
    app.include_router(users.router)
    app.dependency_overrides[get_current_user] = lambda: user

    with TestClient(app) as client:
        response = client.get("/api/users/me/identity")

    assert response.status_code == 200
    assert response.json() == {"id": "stable-application-user"}
    assert "clerk-subject" not in response.text


def test_current_identity_requires_authentication():
    app = FastAPI()
    app.include_router(users.router)

    with TestClient(app) as client:
        response = client.get("/api/users/me/identity")

    assert response.status_code == 401

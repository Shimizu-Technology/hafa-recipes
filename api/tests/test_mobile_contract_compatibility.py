"""Offline regression harness for the Recipes clients preceding Håfa API.

No production requests, source-derived runtime expectations, lifespan startup,
database connections, provider calls, or customer data are needed here.
"""

import copy
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import ClerkUser, get_current_user, get_optional_user
from app.db import get_db
from app.models.deletion import DeletionCleanupJob
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob, Recipe
from app.publishing import PUBLISHING_DISCLOSURE_VERSION
from app.routers import chat, extract, grocery, grocery_widget, recipes, share_import, users
from tests.compatibility.consumers import (
    Job264,
    Job2611,
    Page264,
    Recipe264,
    Recipe2611,
    WidgetSnapshot264,
)

FIXTURES = Path(__file__).parent / "compatibility"
ROUTE_MANIFEST = json.loads((FIXTURES / "mobile_routes.json").read_text())
RECIPE_INPUTS = json.loads((FIXTURES / "recipe_inputs.json").read_text())
RECIPE_ID = UUID("11111111-1111-4111-8111-111111111111")
JOB_ID = UUID("22222222-2222-4222-8222-222222222222")
NOW = datetime(2026, 10, 10, tzinfo=UTC)
OWNER = "synthetic-stable-owner"
USER = ClerkUser(
    id=OWNER,
    clerk_user_id="user_synthetic_distinct_subject",
    clerk_issuer="https://example.test",
    clerk_environment="test",
)


@pytest.fixture(scope="module")
def contract_app():
    # Inspect actual application registration. Calling openapi() does not enter
    # lifespan or start main's workers/database preflight.
    from app.main import app

    return app


def _normalized_path(path):
    return re.sub(r"\{[^}]+\}", "{}", path)


@pytest.mark.parametrize(
    "contract",
    ROUTE_MANIFEST["routes"],
    ids=lambda contract: f"{contract['method']} {contract['path']}",
)
def test_frozen_mobile_route_remains_registered(contract_app, contract):
    matches = [
        operation
        for path, methods in contract_app.openapi()["paths"].items()
        for method, operation in methods.items()
        if _normalized_path(path) == _normalized_path(contract["path"])
        and contract["method"].lower() == method
    ]
    assert len(matches) == 1, (
        f"Missing or ambiguous client route: {contract}; use an additive endpoint "
        "rather than move a released Recipes endpoint"
    )
    operation = matches[0]
    declared_success = {code for code in operation["responses"] if code.startswith("2")}
    assert declared_success == set(contract["success_statuses"])
    required_parameters = {
        (parameter["in"], parameter["name"])
        for parameter in operation.get("parameters", [])
        if parameter.get("required") and parameter["in"] != "path"
    }
    assert required_parameters <= {
        (parameter["in"], parameter["name"]) for parameter in contract["required_parameters"]
    }, "Existing clients cannot supply newly required query/header parameters"
    if not contract["body_required"]:
        assert not operation.get("requestBody", {}).get("required", False), (
            "An existing body-free operation cannot acquire a mandatory request body"
        )


def _recipe(input_name="component_recipe", *, public=False):
    return Recipe(
        id=RECIPE_ID,
        source_url="https://example.test/recipe",
        source_type="website",
        extracted=copy.deepcopy(RECIPE_INPUTS[input_name]),
        raw_text="synthetic owner-only source context",
        created_at=NOW,
        user_id=OWNER,
        is_public=public,
        has_audio_transcript=None,  # Historical rows can contain NULL.
        moderation_status="active",
        content_revision=1,
    )


@pytest.mark.parametrize("input_name", RECIPE_INPUTS)
@pytest.mark.parametrize("consumer", [Recipe264, Recipe2611])
def test_recipe_response_decodes_with_independent_old_and_new_consumers(input_name, consumer):
    recipe = _recipe(input_name)
    before = copy.deepcopy(recipe.extracted)
    wire = recipes.recipe_to_detail_response(recipe, OWNER).model_dump(mode="json")
    decoded = consumer.model_validate(wire)
    assert decoded.id == str(RECIPE_ID)
    assert decoded.user_id == OWNER
    assert decoded.has_audio_transcript is False
    assert decoded.extracted.ingredients[0].quantity == "2"
    assert recipe.extracted == before, "Response normalization must not rewrite stored data"


def test_paginated_library_keeps_flat_client_contract():
    recipe = _recipe()
    item = recipes.recipe_to_list_item(recipe, OWNER, is_saved=True)
    wire = recipes.PaginatedRecipes(
        items=[item],
        total=2,
        limit=1,
        offset=0,
        has_more=True,
    ).model_dump(mode="json")
    decoded = Page264.model_validate(wire)
    assert decoded.items[0].title == "Synthetic rice fixture"
    assert decoded.total == 2 and decoded.has_more is True


def test_library_projection_retains_saved_status():
    item = recipes.recipe_to_list_item(_recipe(), OWNER, is_saved=True)
    assert item.model_dump(mode="json")["is_saved"] is True


@pytest.mark.parametrize("viewer", [None, "synthetic-other-account"])
def test_public_recipe_contract_redacts_private_identity_and_source_context(viewer):
    wire = recipes.recipe_to_detail_response(_recipe(public=True), viewer).model_dump(mode="json")
    Recipe264.model_validate(wire)
    assert wire["raw_text"] is None
    assert wire["extraction_evidence"] is None
    assert wire["moderation_status"] is None
    assert wire["is_owner"] is False
    assert wire["user_id"].startswith("chef_")
    assert wire["user_id"] == wire["contributor_id"]
    assert OWNER not in json.dumps(wire)
    assert USER.clerk_user_id not in json.dumps(wire)


@pytest.mark.parametrize(
    "status", ["queued", "claimed", "processing", "completed", "failed", "cancelled", "expired"]
)
@pytest.mark.parametrize("consumer", [Job264, Job2611])
def test_every_existing_job_state_remains_decodable(status, consumer):
    job = ExtractionJob(
        id=JOB_ID,
        user_id=OWNER,
        url="https://example.test/recipe",
        job_kind="extract",
        location="Guam",
        notes="",
        requested_is_public=False,
        status=status,
        progress=100 if status == "completed" else 0,
        current_step="complete" if status == "completed" else "queued",
        message="Synthetic status",
        recipe_id=RECIPE_ID if status == "completed" else None,
        attempt_count=1,
        max_attempts=3,
        created_at=NOW,
        updated_at=NOW,
    )
    wire = extract._job_status_response(job).model_dump(mode="json")
    decoded = consumer.model_validate(wire)
    assert decoded.status == status
    assert wire["can_save_draft"] is (status in {"failed", "expired"})
    assert decoded.recipe_id == (str(RECIPE_ID) if status == "completed" else None)


class Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class RecipeSession:
    def __init__(self, recipe):
        self.recipe = recipe
        self.commits = 0

    async def execute(self, statement):
        entity = statement.column_descriptions[0].get("entity")
        if entity is AppUser:
            return Result(
                AppUser(id=OWNER, publishing_disclosure_version=PUBLISHING_DISCLOSURE_VERSION)
            )
        return Result(self.recipe)

    async def commit(self):
        self.commits += 1


def _http_app(router, session):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_optional_user] = lambda: USER
    app.dependency_overrides[get_db] = lambda: session
    return app


def test_owner_detail_runs_through_http_response_validation():
    with TestClient(_http_app(recipes.router, RecipeSession(_recipe()))) as client:
        response = client.get(f"/api/recipes/{RECIPE_ID}")
    assert response.status_code == 200
    decoded = Recipe264.model_validate(response.json())
    assert decoded.user_id == OWNER
    assert response.json()["raw_text"] == "synthetic owner-only source context"


@pytest.mark.parametrize("body", [None, {"is_public": True}])
def test_legacy_no_body_and_explicit_share_requests_remain_accepted(body):
    session = RecipeSession(_recipe())
    with TestClient(_http_app(recipes.router, session)) as client:
        response = client.post(f"/api/recipes/{RECIPE_ID}/share", json=body)
    assert response.status_code == 200
    assert response.json() == {"is_public": True, "message": "Recipe shared to library"}
    assert session.commits == 1


def test_identity_http_uses_stable_application_id_not_auth_provider_subject():
    with TestClient(_http_app(users.router, None)) as client:
        response = client.get("/api/users/me/identity")
    assert response.status_code == 200
    assert response.json() == {"id": OWNER}


@pytest.mark.parametrize("path", ["/api/users/me/identity", "/api/jobs", f"/api/jobs/{JOB_ID}"])
def test_identity_and_jobs_still_require_authentication(path):
    app = FastAPI()
    app.include_router(users.router)
    app.include_router(extract.router)
    app.dependency_overrides[get_db] = lambda: None
    with TestClient(app) as client:
        response = client.get(path)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_known_job_owner_cannot_be_replaced_by_another_app_account():
    class NoQuery:
        async def execute(self, statement):
            raise AssertionError("A known owner must not be claimed or reassigned")

    job = SimpleNamespace(user_id=OWNER, recipe_id=None)
    assert await extract._user_can_access_job(NoQuery(), job, USER) is True
    other = USER.model_copy(update={"id": "synthetic-other-account"})
    assert await extract._user_can_access_job(NoQuery(), job, other) is False


def test_account_delete_remains_202_with_retryable_cleanup_response():
    # Replay after local deletion: freeze HTTP behavior without exercising a
    # destructive database mutation or provider cleanup in this offline suite.
    cleanup = DeletionCleanupJob(
        id=JOB_ID,
        kind="account",
        app_user_id=OWNER,
        status="queued",
        clerk_target_count=1,
        storage_prefix_count=2,
    )

    class ReplaySession:
        async def execute(self, statement):
            entity = statement.column_descriptions[0].get("entity")
            return Result(None if entity is AppUser else cleanup)

        async def rollback(self):
            pass

    with TestClient(_http_app(users.router, ReplaySession())) as client:
        first = client.delete("/api/users/me")
        second = client.delete("/api/users/me")
    assert first.status_code == second.status_code == 202
    assert (
        first.json()
        == second.json()
        == {
            "message": "Account data deleted; external cleanup is being finalized",
            "deleted": {"recipes": 0},
            "cleanup": {
                "id": str(JOB_ID),
                "status": "queued",
                "clerk_accounts": 1,
                "storage_prefixes": 2,
            },
        }
    )


@pytest.mark.parametrize(
    "model,payload",
    [
        (extract.ExtractRequest, {"url": "https://example.test/recipe"}),
        (
            recipes.ManualRecipeCreate,
            {"title": "Synthetic", "ingredients": [{"name": "Rice"}], "steps": ["Cook."]},
        ),
        (recipes.OCRRecipeCreate, {"extracted": RECIPE_INPUTS["component_recipe"]}),
        (share_import.CredentialRequest, {"installation_id": str(JOB_ID)}),
    ],
)
def test_old_capture_requests_do_not_gain_required_fields_or_public_defaults(model, payload):
    parsed = model.model_validate(payload)
    assert parsed.is_public is False


def test_old_native_share_request_omitting_new_intent_fields_remains_valid():
    request = share_import.ImportRequest.model_validate(
        {"capture_id": str(JOB_ID), "url": "https://example.test/recipe"}
    )
    assert request.is_public is None and request.location is None
    assert {"is_public", "location"}.isdisjoint(request.model_fields_set)


def test_chat_accepts_old_text_and_history_request_without_workout_context():
    parsed = chat.ChatRequest.model_validate(
        {
            "message": "How long does this cook?",
            "history": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hello"},
            ],
        }
    )
    assert parsed.message == "How long does this cook?"
    assert len(parsed.history) == 2


def test_widget_snapshot_decodes_without_exposing_member_identifiers():
    snapshot = grocery.GrocerySnapshotResponse.model_validate(
        {
            "account_scope_id": "gacct_synthetic",
            "list": {
                "id": str(RECIPE_ID),
                "name": "Groceries",
                "is_shared": True,
                "revision": 3,
                "members": [{"user_id": OWNER, "display_name": "Fixture", "joined_at": NOW}],
                "created_at": NOW,
                "updated_at": NOW,
            },
            "items": [
                {
                    "id": str(JOB_ID),
                    "name": "Rice",
                    "checked": False,
                    "created_at": NOW,
                    "updated_at": NOW,
                }
            ],
            "total": 1,
            "unchecked": 1,
            "checked": 0,
            "server_time": NOW,
        }
    )
    wire = grocery_widget._widget_snapshot(snapshot).model_dump(mode="json")
    decoded = WidgetSnapshot264.model_validate(wire)
    assert decoded.items[0].checked is False
    assert "members" not in wire["list"]
    assert OWNER not in json.dumps(wire)


def test_widget_set_checked_keeps_explicit_state_and_mutation_identity():
    request = grocery_widget.WidgetSetCheckedRequest.model_validate(
        {
            "mutation_id": str(JOB_ID),
            "list_id": str(RECIPE_ID),
            "item_id": str(JOB_ID),
            "checked": False,
        }
    )
    assert request.checked is False and request.mutation_id == JOB_ID


@pytest.mark.parametrize("mutation", ["missing_field", "changed_type", "new_job_state"])
def test_frozen_consumers_detect_breaking_contract_mutations(mutation):
    if mutation == "new_job_state":
        wire = {
            "id": str(JOB_ID),
            "url": "https://example.test/recipe",
            "status": "waiting_for_workouts",
            "progress": 0,
            "current_step": "queued",
            "message": "Queued",
            "recipe_id": None,
            "error_message": None,
        }
        consumer = Job264
    else:
        wire = recipes.recipe_to_detail_response(_recipe(), OWNER).model_dump(mode="json")
        consumer = Recipe264
        if mutation == "missing_field":
            del wire["source_url"]
        else:
            wire["has_audio_transcript"] = "false"
    with pytest.raises(ValidationError):
        consumer.model_validate(wire)

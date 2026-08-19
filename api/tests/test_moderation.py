from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.auth import ClerkUser
from app.models.moderation import AdminAuditEvent
from app.models.recipe import ExtractionJob, Recipe
from app.moderation import is_publicly_viewable, public_recipe_conditions, require_admin
from app.routers.admin import (
    RecipeModerationUpdate,
    _add_audit,
    _job_response,
    _recipe_preview,
)
from app.routers.community_safety import AppealCreate
from app.routers.recipes import get_recipe


def _user(*, role: str | None = None) -> ClerkUser:
    return ClerkUser(
        id="stable_user",
        clerk_user_id="clerk_user",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
        role=role,
    )


def _recipe(**overrides) -> Recipe:
    values = {
        "id": uuid4(),
        "source_url": "https://example.com/recipe",
        "source_type": "website",
        "extracted": {"title": "Red Rice"},
        "user_id": "contributor_user",
        "extractor_display_name": "Test Cook",
        "is_public": True,
        "moderation_status": "active",
        "is_featured": False,
        "featured_order": None,
        "created_at": datetime.now(UTC),
    }
    values.update(overrides)
    return Recipe(**values)


def test_public_recipe_policy_contains_moderation_owner_and_block_boundaries():
    statement = postgresql.dialect().statement_compiler(
        postgresql.dialect(),
        select(Recipe).where(*public_recipe_conditions("viewer_user")),
    ).string

    assert "recipes.is_public IS true" in statement
    assert "recipes.moderation_status" in statement
    assert "app_users.moderation_status" in statement
    assert "user_blocks.blocker_user_id" in statement
    assert "user_blocks.blocked_user_id" in statement


@pytest.mark.asyncio
async def test_loaded_recipe_policy_rejects_hidden_contributor_and_user_block():
    recipe = _recipe()
    hidden_owner_db = SimpleNamespace(scalar=AsyncSequence(["hidden"]))
    assert not await is_publicly_viewable(hidden_owner_db, recipe, "viewer")

    blocked_db = SimpleNamespace(scalar=AsyncSequence(["active", uuid4()]))
    assert not await is_publicly_viewable(blocked_db, recipe, "viewer")

    visible_db = SimpleNamespace(scalar=AsyncSequence(["active", None]))
    assert await is_publicly_viewable(visible_db, recipe, "viewer")


class AsyncSequence:
    def __init__(self, values):
        self.values = iter(values)

    async def __call__(self, _statement):
        return next(self.values)


class ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


@pytest.mark.asyncio
async def test_anonymous_request_is_not_owner_of_unowned_private_legacy_recipe():
    legacy_private = _recipe(user_id=None, is_public=False)

    class Database:
        async def execute(self, _statement):
            return ScalarResult(legacy_private)

    with pytest.raises(HTTPException) as denied:
        await get_recipe(legacy_private.id, Database(), None)
    assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_require_admin_denies_non_admin_and_accepts_admin():
    request = SimpleNamespace(
        method="PUT",
        url=SimpleNamespace(path="/api/admin/recipes/example/moderation"),
    )
    with pytest.raises(HTTPException) as denied:
        await require_admin(request, _user(), SimpleNamespace())
    assert denied.value.status_code == 403

    admin = _user(role="admin")
    assert await require_admin(request, admin, SimpleNamespace()) is admin


def test_featured_recipe_validation_requires_safe_consistent_state():
    valid = RecipeModerationUpdate(
        moderation_status="active",
        is_featured=True,
        featured_order=4,
        reason="Curated for the seasonal collection",
    )
    assert valid.featured_order == 4

    with pytest.raises(ValueError):
        RecipeModerationUpdate(
            moderation_status="hidden",
            is_featured=True,
            featured_order=4,
            reason="Reported content",
        )


def test_appeal_requires_meaningful_context():
    appeal = AppealCreate(
        target_type="contributor",
        details="  I corrected the attribution and would like another review.  ",
    )
    assert appeal.details.startswith("I corrected")

    with pytest.raises(ValueError):
        AppealCreate(target_type="recipe", details="too short")
    with pytest.raises(ValueError):
        RecipeModerationUpdate(
            moderation_status="active",
            is_featured=True,
            featured_order=None,
            reason="Missing order",
        )


def test_admin_preview_never_exposes_private_recipe_metadata():
    preview = _recipe_preview(_recipe(is_public=False))

    assert preview.title == "Private recipe"
    assert preview.display_name == "Private contributor"
    assert preview.contributor_id is None


def test_admin_job_preview_uses_only_source_host():
    job = ExtractionJob(
        id=uuid4(),
        url="https://example.com/private/path?token=secret",
        user_id="stable_user",
        location="Guam",
        notes="private notes",
        status="failed",
        job_kind="extract",
        progress=0,
        current_step="error",
        message="failed",
        estimated_duration=60,
        error_message="private provider output",
        error_code="TIMEOUT",
        attempt_count=3,
        max_attempts=3,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    response = _job_response(job)

    assert response.source_host == "example.com"
    assert "private" not in response.model_dump_json()
    assert "secret" not in response.model_dump_json()


def test_audit_helper_records_only_bounded_before_and_after_summaries():
    added = []
    db = SimpleNamespace(add=added.append)

    _add_audit(
        db,
        actor=_user(role="admin"),
        action="recipe_moderation_updated",
        target_type="recipe",
        target_id=str(uuid4()),
        reason="Confirmed policy violation",
        before={"moderation_status": "active"},
        after={"moderation_status": "hidden"},
    )

    assert len(added) == 1
    event = added[0]
    assert isinstance(event, AdminAuditEvent)
    assert event.before_summary == {"moderation_status": "active"}
    assert event.after_summary == {"moderation_status": "hidden"}

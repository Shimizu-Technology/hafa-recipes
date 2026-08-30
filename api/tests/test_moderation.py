from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.auth import ClerkUser
from app.models.deletion import DeletionCleanupJob
from app.models.moderation import AdminAuditEvent
from app.models.recipe import ExtractionJob, Recipe
from app.moderation import is_publicly_viewable, public_recipe_conditions, require_admin
from app.routers.admin import (
    AdminReason,
    RecipeModerationUpdate,
    _add_audit,
    _cleanup_job_response,
    _job_response,
    _recipe_preview,
    retry_cleanup_job,
)
from app.routers.community_safety import AppealCreate, get_safety_status
from app.routers.recipes import get_recipe, recipe_to_detail_response, recipe_to_list_item


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
        "extracted": {"title": "Red Rice", "sourceUrl": "https://example.com/recipe"},
        "user_id": "contributor_user",
        "extractor_display_name": "Test Cook",
        "is_public": True,
        "moderation_status": "active",
        "is_featured": False,
        "featured_order": None,
        "has_audio_transcript": False,
        "created_at": datetime.now(UTC),
    }
    values.update(overrides)
    return Recipe(**values)


def test_public_recipe_policy_contains_moderation_owner_and_block_boundaries():
    compiler = postgresql.dialect().statement_compiler(
        postgresql.dialect(),
        select(Recipe).where(*public_recipe_conditions("viewer_user")),
    )
    statement = compiler.string

    assert "recipes.is_public IS true" in statement
    assert "recipes.moderation_status" in statement
    assert "recipes.review_state IS NULL" in statement
    assert "recipes.review_state = " in statement
    assert "ready" in compiler.params.values()
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("review_state", "expected"),
    [(None, True), ("ready", True), ("needs_review", False), ("source_incomplete", False)],
)
async def test_loaded_public_policy_enforces_recipe_review_state(review_state, expected):
    """Only legacy and ready recipes are visible to a non-owner."""

    recipe = _recipe(review_state=review_state)
    db = SimpleNamespace(scalar=AsyncSequence(["active", None]))

    assert await is_publicly_viewable(db, recipe, "viewer") is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("review_state", ["needs_review", "source_incomplete"])
async def test_owner_can_open_private_review_drafts(review_state):
    """The public-review boundary never removes an owner's draft access."""

    recipe = _recipe(
        user_id="stable_user",
        is_public=False,
        review_state=review_state,
    )

    class Database:
        async def execute(self, _statement):
            return ScalarResult(recipe)

    response = await get_recipe(recipe.id, Database(), _user())

    assert response.is_owner is True
    assert response.review_state == review_state


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


def test_recipe_moderation_status_is_visible_only_to_owner():
    recipe = _recipe(moderation_status="hidden")

    owner_list_item = recipe_to_list_item(recipe, recipe.user_id)
    public_list_item = recipe_to_list_item(recipe, "another_user")
    owner_detail = recipe_to_detail_response(recipe, recipe.user_id)
    public_detail = recipe_to_detail_response(recipe, "another_user")

    assert owner_list_item.moderation_status == "hidden"
    assert owner_detail.moderation_status == "hidden"
    assert public_list_item.moderation_status is None
    assert public_detail.moderation_status is None


@pytest.mark.asyncio
async def test_safety_status_returns_only_callers_account_state():
    hidden_account = SimpleNamespace(moderation_status="hidden")

    class Database:
        async def get(self, model, user_id):
            assert model.__name__ == "AppUser"
            assert user_id == "stable_user"
            return hidden_account

    response = await get_safety_status(Database(), _user())

    assert response.model_dump() == {"account_moderation_status": "hidden"}


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


def test_admin_cleanup_preview_exposes_counts_but_never_external_targets():
    now = datetime.now(UTC)
    job = DeletionCleanupJob(
        id=uuid4(),
        kind="account",
        app_user_id="private_stable_user",
        status="failed",
        clerk_identities=[
            {"issuer": "https://clerk.example.test", "subject": "user_private"}
        ],
        storage_prefixes=["chat-images/private_stable_user/"],
        clerk_target_count=1,
        storage_prefix_count=1,
        attempt_count=20,
        max_attempts=20,
        last_error="StorageCleanupError",
        created_at=now,
        updated_at=now,
        completed_at=now,
    )

    response = _cleanup_job_response(job)
    serialized = response.model_dump_json()

    assert response.target_count == 2
    assert response.error_code == "StorageCleanupError"
    assert "private_stable_user" not in serialized
    assert "user_private" not in serialized
    assert "chat-images" not in serialized
    assert "clerk.example.test" not in serialized


@pytest.mark.asyncio
async def test_admin_cleanup_retry_resets_failure_and_records_bounded_audit(monkeypatch):
    now = datetime.now(UTC)
    job = DeletionCleanupJob(
        id=uuid4(),
        kind="account",
        app_user_id="private_stable_user",
        status="failed",
        clerk_identities=[{"issuer": "issuer-secret", "subject": "subject-secret"}],
        storage_prefixes=["private/storage/path/"],
        clerk_target_count=1,
        storage_prefix_count=1,
        attempt_count=20,
        max_attempts=20,
        last_error="StorageCleanupError",
        lease_token="private-lease",
        leased_until=now,
        created_at=now,
        updated_at=now,
        completed_at=now,
    )

    class Database:
        def __init__(self):
            self.added = []
            self.committed = False

        async def scalar(self, _statement):
            return job

        def add(self, value):
            self.added.append(value)

        async def commit(self):
            self.committed = True

        async def refresh(self, _value):
            return None

    db = Database()
    wakes = []
    monkeypatch.setattr(
        "app.routers.admin.deletion_cleanup_worker.wake", lambda: wakes.append(True)
    )

    response = await retry_cleanup_job(
        job.id,
        AdminReason(reason="Provider credentials restored"),
        db,
        _user(role="admin"),
    )

    assert db.committed
    assert wakes == [True]
    assert response.status == "queued"
    assert response.attempt_count == 0
    assert response.error_code is None
    assert job.lease_token is None
    assert job.completed_at is None
    assert job.clerk_identities[0]["subject"] == "subject-secret"
    audit = db.added[0]
    assert audit.action == "deletion_cleanup_retried"
    assert "subject-secret" not in str(audit.before_summary)
    assert "private/storage/path" not in str(audit.after_summary)


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

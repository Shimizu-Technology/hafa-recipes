from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.dialects import postgresql

import app.auth as auth
import app.contributor_attribution as attribution
from app.config import Settings
from app.services.clerk import ClerkProfile


def environment(issuer="https://clerk.hafa-recipes.com"):
    return SimpleNamespace(issuer=issuer, secret_key="test")


def profile(name="Leon", subject="prod_subject"):
    return ClerkProfile(subject, "private@example.test", True, name, "Shimizu", "stable_owner")


def database(previous_name=None):
    return SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: previous_name))
    )


@pytest.fixture(autouse=True)
def reset_cache():
    attribution._name_cache.clear()
    yield
    attribution._name_cache.clear()


@pytest.mark.asyncio
async def test_missing_jwt_profile_uses_clerk_name_and_preserves_stable_owner(monkeypatch):
    settings = Settings(
        database_url="postgresql://test:test@localhost/test",
        openai_api_key="test",
        clerk_production_issuer="https://clerk.hafa-recipes.com",
        clerk_production_secret_key="test",
    )
    monkeypatch.setattr(auth, "settings", settings)
    token = auth.VerifiedClerkToken(
        subject="prod_subject",
        issuer=environment().issuer,
        environment_name="production",
        claims={},
    )
    monkeypatch.setattr(auth, "verify_clerk_token", lambda _: token)
    monkeypatch.setattr(
        auth,
        "_resolve_identity",
        AsyncMock(return_value=(SimpleNamespace(app_user_id="stable_owner"), None)),
    )
    get_user = AsyncMock(return_value=profile())
    monkeypatch.setattr(
        attribution,
        "ClerkBackendClient",
        lambda *_args, **_kwargs: SimpleNamespace(get_user=get_user),
    )
    db = database()
    user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="verified"), db
    )
    assert user.id == "stable_owner"
    assert user.clerk_user_id == "prod_subject"
    assert user.display_name == "Leon Shimizu"
    assert user.email is None  # Private profile email is not needed for attribution.
    db.execute.assert_not_awaited()
    assert user.role is None


@pytest.mark.asyncio
async def test_profile_cache_is_issuer_scoped_and_bounded(monkeypatch):
    get_user = AsyncMock(side_effect=[profile("Leon"), profile("Another")])
    monkeypatch.setattr(
        attribution,
        "ClerkBackendClient",
        lambda *_args, **_kwargs: SimpleNamespace(get_user=get_user),
    )
    monkeypatch.setattr(attribution, "_NAME_CACHE_LIMIT", 1)
    db = database()
    kwargs = dict(db=db, clerk_user_id="prod_subject", app_user_id="stable_owner")
    assert (
        await attribution.resolve_contributor_name(environment=environment(), **kwargs)
        == "Leon Shimizu"
    )
    assert (
        await attribution.resolve_contributor_name(environment=environment(), **kwargs)
        == "Leon Shimizu"
    )
    assert get_user.await_count == 1
    assert (
        await attribution.resolve_contributor_name(
            environment=environment("https://other.example"), **kwargs
        )
        == "Another Shimizu"
    )
    assert get_user.await_count == 2
    assert len(attribution._name_cache) == 1


@pytest.mark.asyncio
async def test_provider_outage_uses_same_owner_historical_name_and_does_not_block(monkeypatch):
    get_user = AsyncMock(side_effect=httpx.ConnectError("offline"))
    monkeypatch.setattr(
        attribution,
        "ClerkBackendClient",
        lambda *_args, **_kwargs: SimpleNamespace(get_user=get_user),
    )
    db = database("Leon Shimizu")
    for _ in range(2):
        assert (
            await attribution.resolve_contributor_name(
                db,
                environment=environment(),
                clerk_user_id="prod_subject",
                app_user_id="stable_owner",
            )
            == "Leon Shimizu"
        )
    assert get_user.await_count == 1  # Brief negative cache prevents repeated delays.
    query = db.execute.call_args.args[0].compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
    )
    assert "recipes.user_id = 'stable_owner'" in str(query)
    assert "'a chef', 'anonymous chef'" in str(query)
    assert "LIMIT 1" in str(query)


@pytest.mark.asyncio
async def test_wrong_profile_subject_is_never_used(monkeypatch):
    get_user = AsyncMock(return_value=profile("Wrong", subject="different_subject"))
    monkeypatch.setattr(
        attribution,
        "ClerkBackendClient",
        lambda *_args, **_kwargs: SimpleNamespace(get_user=get_user),
    )
    assert (
        await attribution.resolve_contributor_name(
            database(),
            environment=environment(),
            clerk_user_id="prod_subject",
            app_user_id="stable_owner",
        )
        is None
    )


@pytest.mark.asyncio
async def test_name_claims_do_not_fetch_profile_or_change_auth_role(monkeypatch):
    token = auth.VerifiedClerkToken(
        subject="prod_subject",
        issuer=environment().issuer,
        environment_name="production",
        claims={"first_name": "Leon", "last_name": "Shimizu", "public_metadata": {"role": "admin"}},
    )
    monkeypatch.setattr(auth, "verify_clerk_token", lambda _: token)
    monkeypatch.setattr(
        auth,
        "_resolve_identity",
        AsyncMock(return_value=(SimpleNamespace(app_user_id="stable_owner"), None)),
    )
    resolver = AsyncMock()
    monkeypatch.setattr(auth, "resolve_contributor_name", resolver)
    user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="verified"), database()
    )
    assert user.display_name == "Leon Shimizu"
    assert user.is_admin
    resolver.assert_not_awaited()


def repair_db(rows):
    return SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))
        ),
        commit=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_exact_repair_dry_run_apply_and_idempotency():
    from uuid import uuid4

    from app.repair_contributor_attribution import repair_attribution

    reference = SimpleNamespace(
        id=uuid4(), user_id="stable_owner", extractor_display_name="Leon Shimizu"
    )
    target = SimpleNamespace(id=uuid4(), user_id="stable_owner", extractor_display_name="A chef")
    db = repair_db([reference, target])
    kwargs = dict(
        db=db, reference_id=reference.id, recipe_ids=[target.id], expected_name="Leon Shimizu"
    )
    assert (await repair_attribution(**kwargs))[0]["action"] == "would_update"
    assert target.extractor_display_name == "A chef"
    db.commit.assert_not_awaited()
    assert (await repair_attribution(**kwargs, apply=True))[0]["action"] == "updated"
    assert target.extractor_display_name == "Leon Shimizu"
    assert target.user_id == reference.user_id == "stable_owner"
    assert (await repair_attribution(**kwargs, apply=True))[0]["action"] == "already_correct"


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict", ["owner", "name", "missing", "reference"])
async def test_repair_stops_before_any_change_on_conflict(conflict):
    from uuid import uuid4

    from app.repair_contributor_attribution import repair_attribution

    reference = SimpleNamespace(
        id=uuid4(), user_id="stable_owner", extractor_display_name="Leon Shimizu"
    )
    good = SimpleNamespace(id=uuid4(), user_id="stable_owner", extractor_display_name="A chef")
    target = SimpleNamespace(
        id=uuid4(),
        user_id="other_owner" if conflict == "owner" else "stable_owner",
        extractor_display_name="Different Name" if conflict == "name" else "A chef",
    )
    if conflict == "reference":
        reference.extractor_display_name = "Other"
    db = repair_db([reference, good] if conflict == "missing" else [reference, good, target])
    with pytest.raises(ValueError):
        await repair_attribution(
            db,
            reference_id=reference.id,
            recipe_ids=[good.id, target.id],
            expected_name="Leon Shimizu",
            apply=True,
        )
    assert good.extractor_display_name == "A chef"
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_cached_name_refreshes_after_profile_changes(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(attribution, "monotonic", lambda: clock[0])
    get_user = AsyncMock(side_effect=[profile("Leon"), profile("Updated")])
    monkeypatch.setattr(
        attribution,
        "ClerkBackendClient",
        lambda *_args, **_kwargs: SimpleNamespace(get_user=get_user),
    )
    kwargs = dict(
        db=database(),
        environment=environment(),
        clerk_user_id="prod_subject",
        app_user_id="stable_owner",
    )
    assert await attribution.resolve_contributor_name(**kwargs) == "Leon Shimizu"
    clock[0] += attribution._NAME_CACHE_TTL + 1
    assert await attribution.resolve_contributor_name(**kwargs) == "Updated Shimizu"
    assert get_user.await_count == 2

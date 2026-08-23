"""Versioned public-recipe disclosure behavior."""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.auth import ClerkUser
from app.models.identity import AppUser
from app.publishing import require_current_publishing_disclosure
from app.routers.users import (
    PUBLISHING_DISCLOSURE_VERSION,
    PublishingDisclosureAcceptance,
    accept_publishing_disclosure,
    get_publishing_disclosure,
)


def _user() -> ClerkUser:
    return ClerkUser(
        id="stable_user",
        clerk_user_id="clerk_user",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )


@pytest.mark.asyncio
async def test_disclosure_is_required_until_current_version_is_accepted():
    app_user = AppUser(id="stable_user", publishing_disclosure_version=0)
    db = AsyncMock()
    db.get.return_value = app_user

    status = await get_publishing_disclosure(db=db, user=_user())

    assert status.current_version == PUBLISHING_DISCLOSURE_VERSION
    assert status.accepted_version == 0
    assert status.requires_acceptance is True


@pytest.mark.asyncio
async def test_acceptance_is_persistent_and_idempotent():
    app_user = AppUser(id="stable_user", publishing_disclosure_version=0)
    result = Mock()
    result.scalar_one_or_none.return_value = app_user
    db = AsyncMock()
    db.execute.return_value = result

    status = await accept_publishing_disclosure(
        PublishingDisclosureAcceptance(version=PUBLISHING_DISCLOSURE_VERSION),
        db=db,
        user=_user(),
    )
    repeated_status = await accept_publishing_disclosure(
        PublishingDisclosureAcceptance(version=PUBLISHING_DISCLOSURE_VERSION),
        db=db,
        user=_user(),
    )

    assert app_user.publishing_disclosure_version == PUBLISHING_DISCLOSURE_VERSION
    assert status.requires_acceptance is False
    assert repeated_status.requires_acceptance is False
    assert db.commit.await_count == 2


@pytest.mark.asyncio
async def test_stale_or_future_disclosure_version_is_rejected():
    db = AsyncMock()

    with pytest.raises(HTTPException) as error:
        await accept_publishing_disclosure(
            PublishingDisclosureAcceptance(version=PUBLISHING_DISCLOSURE_VERSION + 1),
            db=db,
            user=_user(),
        )

    assert error.value.status_code == 409
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_public_write_rechecks_current_acceptance_under_account_lock():
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none.return_value = AppUser(
        id="stable_user", publishing_disclosure_version=PUBLISHING_DISCLOSURE_VERSION - 1
    )
    db.execute.return_value = result

    with pytest.raises(HTTPException) as error:
        await require_current_publishing_disclosure(db, "stable_user")

    assert error.value.status_code == 409
    db.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_public_write_accepts_current_version_under_account_lock():
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none.return_value = AppUser(
        id="stable_user", publishing_disclosure_version=PUBLISHING_DISCLOSURE_VERSION
    )
    db.execute.return_value = result

    await require_current_publishing_disclosure(db, "stable_user")

    db.execute.assert_awaited_once()

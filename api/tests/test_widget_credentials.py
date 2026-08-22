"""Unit coverage for opaque grocery-widget credential primitives."""

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.grocery import GroceryWidgetCredential
from app.widget_credentials import (
    WIDGET_CREDENTIAL_SCOPE,
    issue_widget_token,
    parse_widget_token,
    utc_now,
    validate_widget_credential,
    widget_installation_hash,
    widget_token_hash,
)


def _credential(*, token_hash: str) -> GroceryWidgetCredential:
    now = utc_now()
    return GroceryWidgetCredential(
        id=uuid4(),
        app_user_id="stable_user",
        list_id=uuid4(),
        installation_hash=widget_installation_hash(uuid4()),
        token_hash=token_hash,
        scope=WIDGET_CREDENTIAL_SCOPE,
        issued_at=now,
        expires_at=now + timedelta(days=1),
    )


def test_widget_token_round_trip_keeps_only_a_digest():
    credential_id = uuid4()
    token, digest = issue_widget_token(credential_id)

    assert parse_widget_token(token) == (credential_id, digest)
    assert token.startswith(f"hfw_v1.{credential_id}.")
    assert digest not in token
    assert len(digest) == 64


@pytest.mark.parametrize(
    "token",
    [
        "",
        "not-a-widget-token",
        "hfw_v1.not-a-uuid.secret",
        f"hfw_v1.{uuid4()}.bad.secret",
        f"hfw_v2.{uuid4()}.secret",
        f"hfw_v1.{uuid4()}.spaces are invalid",
        "x" * 257,
    ],
)
def test_widget_token_parser_rejects_malformed_or_unversioned_input(token: str):
    assert parse_widget_token(token) is None


def test_widget_credential_rejects_wrong_hash_expiry_revocation_and_scope():
    secret_hash = widget_token_hash("valid-secret")
    now = utc_now()

    validate_widget_credential(_credential(token_hash=secret_hash), secret_hash, now=now)

    invalid = [
        (_credential(token_hash=secret_hash), widget_token_hash("wrong-secret")),
        (_credential(token_hash=secret_hash), secret_hash),
        (_credential(token_hash=secret_hash), secret_hash),
    ]
    invalid[1][0].issued_at = now - timedelta(days=2)
    invalid[1][0].expires_at = now - timedelta(days=1)
    invalid[2][0].revoked_at = now

    wrong_scope = _credential(token_hash=secret_hash)
    wrong_scope.scope = "grocery:read"
    invalid.append((wrong_scope, secret_hash))

    for credential, presented_hash in invalid:
        with pytest.raises(HTTPException) as error:
            validate_widget_credential(credential, presented_hash, now=now)
        assert error.value.status_code == 401

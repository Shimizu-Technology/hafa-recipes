"""Baby private routes cannot leak journals through shared telemetry hooks."""

import logging
from uuid import uuid4

import pytest

from app.ai_governance import ai_request_context
from app.config import Settings
from app.domains.workouts.privacy import (
    WorkoutsAccessLogFilter,
    redact_workouts_event,
    redact_workouts_transaction,
)


def test_baby_request_and_background_failures_drop_private_content(capsys):
    from app.services.video import _media_log

    private = {
        "event_id": "safe-id",
        "level": "error",
        "request": {"url": "https://api.example/api/v1/baby/records?query=private"},
        "exception": {"values": [{"value": "journal text and SQL parameters"}]},
        "breadcrumbs": [{"message": "photo URL"}],
        "contexts": {"trace": "baby details"},
    }
    expected = {
        "event_id": "safe-id",
        "level": "error",
        "message": "Baby request failed",
        "tags": {"product": "baby"},
    }
    assert redact_workouts_event(private) == expected
    assert redact_workouts_transaction(private) is None
    with ai_request_context(route="/api/v1/baby/imports"):
        assert redact_workouts_event({"exception": private["exception"]}) == {
            "message": "Baby request failed", "tags": {"product": "baby"}
        }
        _media_log("private caption and provider error")
    assert capsys.readouterr().out == ""
    log = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s",
                            ("GET", "/api/v1/baby/attachments/private-id"), None)
    assert not WorkoutsAccessLogFilter().filter(log)


def test_baby_is_dormant_without_affecting_shared_products():
    settings = Settings(database_url="postgresql://test:test@localhost/hafa_test",
                        openai_api_key="test", environment="test")
    assert not settings.baby_api_enabled
    assert not settings.baby_worker_enabled
    assert not settings.baby_ai_enabled


@pytest.mark.parametrize("bad", ["../", "0", "-1", "01", "2147483648", "1/extra"])
def test_cleanup_cannot_expand_beyond_one_baby_attachment(bad):
    from app.deletion_cleanup import is_allowed_cleanup_prefix

    identifier = uuid4()
    owner = "a" * 64
    assert is_allowed_cleanup_prefix(f"baby-private/{owner}/1/{identifier}/")
    assert not is_allowed_cleanup_prefix(f"baby-private/{owner}/{bad}/{identifier}/")
    assert not is_allowed_cleanup_prefix(f"baby-private/{owner}/1/")
    assert not is_allowed_cleanup_prefix(f"baby-private/user-id/1/{identifier}/")

"""Test environment defaults required before application modules are imported."""

import os

from tests.database_safety import require_disposable_test_database

require_disposable_test_database(os.environ.get("TEST_DATABASE_URL"), allow_missing=True)

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://test:test@localhost:5432/hafa_recipes_test",
)
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ENVIRONMENT", "test")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_ai_rate_limiter():
    """Keep the process-wide AI budgets from leaking between tests."""
    from app.rate_limit import ai_rate_limiter

    ai_rate_limiter.reset()
    yield
    ai_rate_limiter.reset()


@pytest.fixture(autouse=True)
def _require_baby_mutation_stamp():
    """Observe real ORM writers after the family gate, including short worker transactions."""
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    def check(session, context, instances):
        if not session.info.get("baby_family_write"):
            return
        for row in session.new | session.dirty:
            table = getattr(row, "__table__", None)
            if table is not None and table.name.startswith("baby_") and "space_id" in table.c and "change_seq" in table.c:
                if session.is_modified(row):
                    stamped = session.info.setdefault("baby_touched_rows", {}).pop(id(row), None)
                    assert row.change_seq is not None and stamped is session.get_transaction(), (
                        "Baby mutation skipped touch", table.name, getattr(row, "id", None))

    event.listen(Session, "before_flush", check)
    try:
        yield
    finally:
        event.remove(Session, "before_flush", check)


@pytest.fixture
def baby_mutation_paths():
    return {
        "records": ("create", "patch", "delete", "feed_action", "feed_settlement"),
        "profile": ("bootstrap", "enroll", "consent", "auto_process"),
        "children": ("create", "patch", "delete", "detach_records", "detach_conversations", "detach_imports"),
        "attachments": ("admit", "publish", "replay", "release", "delete", "quota_pending", "quota_abandoned"),
        "imports": ("admit", "retry", "cancel", "capture_cancel"),
        "worker": ("claim", "ready", "edit", "removed", "expired_lease", "moved", "consent", "failure", "attempts"),
        "chat": ("admit", "ready", "retry", "failure", "context_changed"),
        "captures": ("submit", "defer", "permission_changed", "missing_source", "admit", "retry_later"),
    }

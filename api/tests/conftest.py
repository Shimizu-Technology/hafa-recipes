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

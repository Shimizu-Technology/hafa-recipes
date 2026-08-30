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

"""Test environment defaults required before application modules are imported."""

import os

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://test:test@localhost:5432/hafa_recipes_test",
)
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

"""Unit coverage for fail-closed destructive integration-test targeting."""

import pytest

from tests.database_safety import require_disposable_test_database


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+asyncpg://local:local@127.0.0.1:5432/hafa_recipes_test",
        "postgresql://ci:ci@postgres:5432/disposable_recipe_db",
    ],
)
def test_destructive_database_guard_accepts_explicit_test_targets(database_url):
    """Local and CI disposable database names are allowed."""

    require_disposable_test_database(database_url)


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+asyncpg://prod:secret@neon.example/hafa_recipes",
        "postgresql://prod:secret@db.example/postgres",
        "not a url",
        None,
    ],
)
def test_destructive_database_guard_rejects_prod_missing_and_malformed_targets(
    database_url,
):
    """Production-like, missing, and malformed targets fail closed."""

    with pytest.raises(RuntimeError):
        require_disposable_test_database(database_url)


def test_destructive_database_guard_can_allow_missing_for_skipped_integrations():
    """The suite can run unit tests when no integration database is configured."""

    require_disposable_test_database(None, allow_missing=True)

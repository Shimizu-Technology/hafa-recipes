"""Safety checks for tests that destructively reset a PostgreSQL schema."""

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


def require_disposable_test_database(
    database_url: str | None,
    *,
    allow_missing: bool = False,
) -> None:
    """Reject schema resets unless the target database is explicitly test-only."""

    if not database_url:
        if allow_missing:
            return
        raise RuntimeError("TEST_DATABASE_URL is required")
    try:
        database_name = make_url(database_url).database or ""
    except (ArgumentError, TypeError, ValueError) as exc:
        raise RuntimeError("TEST_DATABASE_URL must be a valid database URL") from exc
    normalized = database_name.lower()
    if "test" not in normalized and "disposable" not in normalized:
        raise RuntimeError(
            "Refusing destructive schema reset: database name must explicitly contain "
            "'test' or 'disposable'"
        )

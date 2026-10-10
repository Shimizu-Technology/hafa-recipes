"""Fail before application imports if the isolated fixture contract is absent."""

import os
from urllib.parse import urlsplit

DATABASE = "hafa_workouts_capacity_test"
DATABASE_URL = f"postgresql://postgres:capacity_local_only@127.0.0.1:5432/{DATABASE}"
FAKE_KEY = "capacity-not-a-provider-credential"
OWNERS = tuple(f"capacity-{index:02d}" for index in range(24))


def ensure(environment=None):
    env = os.environ if environment is None else environment
    if env.get("HAFACAPACITY_RUN") != "1" or env.get("ENVIRONMENT") != "test":
        raise RuntimeError("Capacity wrapper requires explicit isolated test mode")
    parsed = urlsplit(env.get("DATABASE_URL", ""))
    if env.get("DATABASE_URL") != DATABASE_URL or parsed.query or parsed.fragment:
        raise RuntimeError("Capacity database must be the owned loopback test database")
    if env.get("WORKOUTS_AI_BUDGET_DATABASE_URL") != DATABASE_URL:
        raise RuntimeError(
            "Budget authority must bind the exact same owned fixture URI"
        )
    if env.get("DATABASE_USE_SSL") != "false":
        raise RuntimeError("Expected isolated loopback database configuration")
    for key in ["OPENAI_API_KEY", "WORKOUTS_DEVELOPMENT_AI_API_KEY"]:
        if env.get(key) != FAKE_KEY:
            raise RuntimeError(
                "Real provider credentials are forbidden in capacity mode"
            )
    for key in [
        "SENTRY_DSN",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "CLERK_SECRET_KEY",
        "CLERK_DEVELOPMENT_SECRET_KEY",
        "CLERK_PRODUCTION_SECRET_KEY",
        "YOUTUBE_PROXY",
        "INSTAGRAM_COOKIES",
    ]:
        if env.get(key):
            raise RuntimeError(
                "External service configuration is forbidden in capacity mode"
            )
    return env

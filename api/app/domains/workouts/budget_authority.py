"""Explicit anonymous-ledger authority; never inherits the application database.

Operators must bind every paid environment to the same durable ledger. This
module cannot discover or validate other environments' deployment settings.
"""

import asyncio
import ssl
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.domains.workouts.budget import BudgetError

_engines = {}


def authority_sessions(secret):
    if not isinstance(secret, SecretStr) or not secret.get_secret_value():
        raise BudgetError("workouts_ai_budget_authority_unconfigured")
    try:
        raw = secret.get_secret_value()
        parsed = urlsplit(raw)
        if (
            parsed.scheme not in {"postgresql", "postgresql+asyncpg"}
            or not parsed.hostname
            or not parsed.username
            or not parsed.path.strip("/")
            or parsed.fragment
        ):
            raise ValueError()
        parameters = parse_qsl(parsed.query, keep_blank_values=True)
        if any(
            key not in {"application_name", "sslmode", "channel_binding"} for key, _ in parameters
        ):
            raise ValueError()
        normalized = urlunsplit(
            (
                "postgresql+asyncpg",
                parsed.netloc,
                parsed.path,
                urlencode([(key, value) for key, value in parameters if key == "application_name"]),
                "",
            )
        )
        # Local is for isolated synthetic tests. Remote authority always verifies TLS,
        # even when a supplied libpq sslmode asks for something less restrictive.
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        identifier = (asyncio.get_running_loop(), raw)
        if identifier not in _engines:
            _engines[identifier] = create_async_engine(
                normalized,
                echo=False,
                hide_parameters=True,
                pool_size=1,
                max_overflow=0,
                pool_timeout=2,
                pool_pre_ping=True,
                connect_args={
                    "ssl": False if local else ssl.create_default_context(),
                    "timeout": 5,
                    "command_timeout": 5,
                    "server_settings": {
                        "search_path": "public",
                        "lock_timeout": "2000",
                        "statement_timeout": "5000",
                    },
                },
            )
        return async_sessionmaker(_engines[identifier], expire_on_commit=False)
    except BudgetError:
        raise
    except Exception:
        # Never expose credential URLs, driver errors or parsing fragments.
        raise BudgetError("workouts_ai_budget_unavailable") from None


async def dispose_budget_authorities():
    loop = asyncio.get_running_loop()
    owned = [(key, engine) for key, engine in _engines.items() if key[0] is loop]
    for key, engine in owned:
        try:
            await engine.dispose()
        finally:
            _engines.pop(key, None)

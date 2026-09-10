"""Resolve public recipe attribution without changing authenticated ownership."""

from collections import OrderedDict
from time import monotonic

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ClerkEnvironment
from app.models.recipe import Recipe
from app.services.clerk import ClerkBackendClient

PLACEHOLDER_NAMES = ("a chef", "anonymous chef")
_NAME_CACHE_LIMIT = 1024
_NAME_CACHE_TTL = 300
_FAILURE_CACHE_TTL = 30
# Cache only presentation data, never identities or authorization decisions.
_name_cache: OrderedDict[tuple[str, str], tuple[float, str | None]] = OrderedDict()


async def resolve_contributor_name(
    db: AsyncSession,
    *,
    environment: ClerkEnvironment,
    clerk_user_id: str,
    app_user_id: str,
) -> str | None:
    """Use the issuer's profile, retaining prior attribution during outages.

    Standard Clerk session tokens need not include names. An existing identity
    therefore cannot rely on token profile claims to name a recipe's importer.
    Historical fallback is scoped strictly to the authenticated stable owner.
    """
    key = (environment.issuer, clerk_user_id)
    now = monotonic()
    cached = _name_cache.get(key)
    if cached is not None and cached[0] > now:
        name = cached[1]
        _name_cache.move_to_end(key)
    else:
        name = None
        try:
            profile = await ClerkBackendClient(environment, timeout=3.0).get_user(clerk_user_id)
            if profile is not None and profile.clerk_user_id == clerk_user_id:
                name = (
                    " ".join(
                        part for part in (profile.first_name, profile.last_name) if part
                    ).strip()
                    or None
                )
        except (httpx.HTTPError, ValueError):
            # Profile availability must not determine whether an existing
            # authenticated user can access their library.
            pass
        _name_cache[key] = (now + (_NAME_CACHE_TTL if name else _FAILURE_CACHE_TTL), name)
        _name_cache.move_to_end(key)
        while len(_name_cache) > _NAME_CACHE_LIMIT:
            _name_cache.popitem(last=False)
    if name:
        return name[:100]

    result = await db.execute(
        select(Recipe.extractor_display_name)
        .where(
            Recipe.user_id == app_user_id,
            Recipe.extractor_display_name.isnot(None),
            func.trim(Recipe.extractor_display_name) != "",
            func.lower(func.trim(Recipe.extractor_display_name)).notin_(PLACEHOLDER_NAMES),
        )
        .order_by(Recipe.created_at.desc(), Recipe.id.desc())
        .limit(1)
    )
    previous_name = result.scalar_one_or_none()
    return previous_name.strip() if previous_name else None

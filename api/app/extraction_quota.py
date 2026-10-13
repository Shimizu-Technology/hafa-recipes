"""Per-user budget for paid recipe extraction work.

Every route that sends user-supplied sources (links, pasted text, photos) to a
paid model shares one rolling budget per user. The limits sit well above normal
use: a heavy session of saving recipes is a handful of imports per hour, while
the budget only stops scripted or runaway clients from spending provider money
on one account.

* 30 extractions in any rolling hour
* 100 extractions in any rolling day

Replays that return an existing recipe or job never reach this budget, because
callers check for those before admitting new work. Administrators are exempt so
moderation and bulk repair work stays possible.

The budget lives in the API process (see ``app.rate_limit``), so it resets on
deploy. That is acceptable for an abuse guard; it is not a billing ledger.
"""

from fastapi import HTTPException

from app.auth import ClerkUser
from app.rate_limit import QuotaWindow, RateLimitExceeded, ai_rate_limiter

EXTRACTION_CAPABILITY = "recipe_extraction"
EXTRACTION_QUOTA_WINDOWS = (
    QuotaWindow(seconds=60 * 60, limit=30),
    QuotaWindow(seconds=24 * 60 * 60, limit=100),
)
EXTRACTION_QUOTA_MESSAGE = (
    "You've imported a lot of recipes recently. Please wait a little while and try again."
)


def _quota_http_exception(exc: RateLimitExceeded) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail=EXTRACTION_QUOTA_MESSAGE,
        headers={"Retry-After": str(exc.retry_after)},
    )


async def consume_extraction_quota(user: ClerkUser) -> float | None:
    """Admit one extraction for ``user`` or raise a friendly 429.

    Returns a refund token, or ``None`` when the user is exempt.
    """
    if user.is_admin:
        return None
    try:
        return await ai_rate_limiter.consume_quota(
            user_id=user.id,
            capability=EXTRACTION_CAPABILITY,
            windows=EXTRACTION_QUOTA_WINDOWS,
        )
    except RateLimitExceeded as exc:
        raise _quota_http_exception(exc) from exc


async def refund_extraction_quota(user: ClerkUser, token: float | None) -> None:
    """Return an admission when the request turned out to be a replay."""
    if token is None:
        return
    await ai_rate_limiter.refund_quota(
        user_id=user.id,
        capability=EXTRACTION_CAPABILITY,
        token=token,
    )

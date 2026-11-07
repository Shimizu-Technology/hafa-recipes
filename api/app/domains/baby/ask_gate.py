"""Who may use Ask V2: the flag, AI permission, and today's disclosure acknowledged."""

from app.config import get_settings

# What the current consent copy discloses: OpenAI, its web search, family sharing. A new
# provider or a new kind of sharing raises this, and nobody moves until they acknowledge it.
ASK_CONSENT_VERSION = 1
# Explicit operator acknowledgement of this exact agent-reviewed family wording; not clinician approval.
HEALTH_REVIEW_VERSION = "baby-health-2026-11-07-m1-m8"


def health_release_allowed():
    """The public/paid wording gate covers old Ask as well as V2; the urgent floor is separate."""
    settings = get_settings()
    audience = getattr(settings, "baby_health_release_audience", "public")
    if getattr(settings, "baby_health_reviewed_version", "") != HEALTH_REVIEW_VERSION:
        return False
    if audience == "private_family":
        return True
    return audience in {"public", "paid"} and all(
        (getattr(settings, field, "") or "").strip()
        for field in ("baby_ask_clinician_approval", "baby_who_chart_permission")
    )


def ask_v2_on():
    """Leon authorized agent review for private family use on 2026-11-07; never clinical approval.

    Public/paid use still needs clinician review and WHO chart permission. V2-off is
    not AI-off: the old organizer remains behind AI consent and input/output checks.
    """
    settings = get_settings()
    if not getattr(settings, "baby_ask_v2_enabled", False):
        return False
    return health_release_allowed()


def ask_v2_consented(profile):
    return bool(profile.get("ai_consent")) and profile.get("ai_consent_version") == ASK_CONSENT_VERSION


def ask_v2_allowed(profile):
    return ask_v2_on() and ask_v2_consented(profile)

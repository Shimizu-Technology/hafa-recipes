"""Who may use Ask V2: the flag, AI permission, and today's disclosure acknowledged."""

from app.config import get_settings

# What the current consent copy discloses: OpenAI, its web search, family sharing. A new
# provider or a new kind of sharing raises this, and nobody moves until they acknowledge it.
ASK_CONSENT_VERSION = 1


def ask_v2_on():
    """Off until a doctor has approved its medical wording. In production, the flag alone isn't enough."""
    settings = get_settings()
    if not getattr(settings, "baby_ask_v2_enabled", False):
        return False
    return getattr(settings, "environment", "test") != "production" or bool(
        (getattr(settings, "baby_ask_clinician_approval", "") or "").strip()
    )


def ask_v2_consented(profile):
    return bool(profile.get("ai_consent")) and profile.get("ai_consent_version") == ASK_CONSENT_VERSION


def ask_v2_allowed(profile):
    return ask_v2_on() and ask_v2_consented(profile)

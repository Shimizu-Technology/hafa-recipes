from app.clerk_transition import _production_candidate
from app.services.clerk import ClerkProfile, parse_clerk_profile


def _profile(
    clerk_user_id: str,
    email: str,
    *,
    verified: bool = True,
    external_id: str | None = None,
) -> ClerkProfile:
    return ClerkProfile(
        clerk_user_id=clerk_user_id,
        email=email,
        email_verified=verified,
        first_name=None,
        last_name=None,
        external_id=external_id,
    )


def test_parse_clerk_profile_requires_verified_primary_record_to_report_verified():
    profile = parse_clerk_profile(
        {
            "id": "user_prod",
            "primary_email_address_id": "email_primary",
            "email_addresses": [
                {
                    "id": "email_other",
                    "email_address": "other@example.com",
                    "verification": {"status": "verified"},
                },
                {
                    "id": "email_primary",
                    "email_address": "CHEF@example.com",
                    "verification": {"status": "unverified"},
                },
            ],
            "external_id": "user_dev",
        }
    )

    assert profile is not None
    assert profile.email == "chef@example.com"
    assert profile.email_verified is False
    assert profile.external_id == "user_dev"


def test_production_candidate_accepts_one_exact_verified_email_match():
    development = _profile("user_dev", "chef@example.com")
    production = _profile("user_prod", "chef@example.com")

    candidate, conflict = _production_candidate(
        "user_dev", development, [production]
    )

    assert candidate == production
    assert conflict is None


def test_production_candidate_rejects_conflicting_external_id():
    development = _profile("user_dev", "chef@example.com")
    production = _profile(
        "user_prod",
        "chef@example.com",
        external_id="somebody_else",
    )

    candidate, conflict = _production_candidate(
        "user_dev", development, [production]
    )

    assert candidate is None
    assert conflict == "production external ID belongs to another stable user"


def test_production_candidate_rejects_ambiguous_matches():
    development = _profile("user_dev", "chef@example.com")
    by_email = _profile("user_prod_1", "chef@example.com")
    by_external_id = _profile(
        "user_prod_2",
        "different@example.com",
        external_id="user_dev",
    )

    candidate, conflict = _production_candidate(
        "user_dev", development, [by_email, by_external_id]
    )

    assert candidate is None
    assert conflict == "multiple production users match stable ID or verified email"

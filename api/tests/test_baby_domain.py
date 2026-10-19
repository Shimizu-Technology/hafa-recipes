"""Typed wire boundaries and grounded retrieval/presentation without providers."""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.domains.baby.attachments import attachment_prefix
from app.domains.baby.chat import excerpt_for, query_terms, reviewed_proposal
from app.domains.baby.lifecycle import digest
from app.domains.baby.provider import BabyProvider
from app.domains.baby.schemas import ImportCreate, Profile, RecordCreate


def record(kind, data, **changes):
    return RecordCreate(
        kind=kind, data=data, title="Fixture", occurred_at=datetime.now(UTC), **changes
    )


def test_typed_data_rejects_wrong_kind_and_unknown_fields():
    with pytest.raises(ValidationError):
        record("diaper", {"type": "breast"})
    with pytest.raises(ValidationError):
        record("feeding", {"method": "bottle", "amount": 3})
    with pytest.raises(ValidationError):
        record("journal", {"diagnosis": "unsupported"})
    with pytest.raises(ValidationError):
        record("sleep", {"end_at": "2020-01-01T00:00:00Z"})
    with pytest.raises(ValidationError):
        record("routine", {"routine_type": "schedule", "enabled": True})


def test_dates_consent_urls_and_finite_numbers_are_strict():
    with pytest.raises(ValidationError):
        Profile(ai_consent="true")
    with pytest.raises(ValidationError):
        Profile(timezone="Unknown/City")
    with pytest.raises(ValidationError):
        record("feeding", {"method": "bottle", "amount": float("nan"), "unit": "ml"})
    with pytest.raises(ValidationError):
        ImportCreate(id=uuid4(), url="file:///etc/passwd")
    with pytest.raises(ValidationError):
        ImportCreate(id=uuid4())
    with pytest.raises(ValidationError):
        RecordCreate(kind="journal", title="a", occurred_at="2026-10-20T12:00:00")


def test_proposals_require_review_and_cannot_enable_reminders_or_attach_files():
    assert record("journal", {"provenance": "clinician_instruction"}).data["provenance"] == "clinician_instruction"
    with pytest.raises(ValueError):
        reviewed_proposal({"kind": "journal", "title": "Advice", "data": {"provenance": "clinician_instruction"}})
    proposal = reviewed_proposal(
        {
            "kind": "routine",
            "title": "Hospital bag",
            "body": "Review first",
            "data": {
                "routine_type": "checklist",
                "items": [{"id": "one", "label": "Documents", "done": False}],
            },
        }
    )
    assert proposal["data"]["enabled"] is False
    with pytest.raises(ValueError):
        reviewed_proposal(
            {"kind": "feeding", "title": "Prescription", "data": {"method": "bottle"}}
        )
    with pytest.raises(ValueError):
        reviewed_proposal(
            {
                "kind": "routine",
                "title": "Timing",
                "data": {
                    "routine_type": "schedule",
                    "reminder_at": "2026-10-20T12:00:00Z",
                    "timezone": "Pacific/Guam",
                    "enabled": True,
                },
            }
        )
    with pytest.raises(ValueError):
        reviewed_proposal(
            {"kind": "journal", "title": "Attach", "data": {"attachment_ids": [str(uuid4())]}}
        )


def test_retrieval_keeps_old_deep_source_passages_and_hash_is_canonical():
    item = SimpleNamespace(
        title="Advice",
        body="",
        kind="source",
        data={"source_text": "intro " * 10000 + "Hospital packing passports for labor"},
    )
    excerpt = excerpt_for(item, query_terms("Find my saved hospital packing advice"))
    assert "passports" in excerpt
    assert len(excerpt) <= 7000
    assert digest({"b": 2, "a": 1}) == digest({"a": 1, "b": 2})


def test_asset_prefix_contains_no_account_id_and_provider_is_disabled_in_tests():
    prefix = attachment_prefix(uuid4(), "private-user", 2)
    assert prefix.startswith("baby-private/")
    assert "private-user" not in prefix
    assert "/2/" in prefix
    assert BabyProvider().enabled is False


def test_development_provider_requires_deliberate_key_and_paid_flag(monkeypatch):
    from pydantic import SecretStr

    from app.domains.baby import provider

    configured = SimpleNamespace(
        environment="development",
        allow_paid_ai_in_development=False,
        baby_development_ai_api_key=None,
        openai_api_key="production-key-placeholder",
        baby_api_enabled=True,
        baby_ai_enabled=True,
        is_ai_capability_enabled=lambda capability: True,
    )
    monkeypatch.setattr(provider, "get_settings", lambda: configured)
    adapter = BabyProvider()
    assert adapter.enabled is False and adapter._key(configured) is None
    configured.allow_paid_ai_in_development = True
    assert adapter.enabled is False and adapter._key(configured) is None
    configured.baby_development_ai_api_key = SecretStr("deliberate-qa-key-placeholder")
    assert adapter.enabled is True
    assert adapter._key(configured) == "deliberate-qa-key-placeholder"
    configured.environment = "test"
    assert adapter.enabled is False and adapter._key(configured) is None

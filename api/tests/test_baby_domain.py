"""Typed wire boundaries and grounded retrieval/presentation without providers."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.domains.baby.attachments import attachment_prefix
from app.domains.baby.chat import display_excerpt, excerpt_for, query_terms, reviewed_proposal
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


STARTED = datetime(2026, 10, 20, 2, 0, tzinfo=UTC)


def shown(kind, data, *, title="Fixture", body="", **extra):
    item = SimpleNamespace(
        kind=kind, title=title, body=body, data=data, occurred_at=STARTED, **extra
    )
    return display_excerpt(item, [])


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (
            {"method": "breast", "side": "left", "unit": None, "amount": None, "duration_minutes": 15.0},
            "Breastfeeding · Left side · 15 min",
        ),
        ({"method": "breast", "side": "both", "duration_minutes": 75}, "Breastfeeding · Both sides · 1 h 15 min"),
        ({"method": "bottle", "amount": 4.0, "unit": "oz", "side": None}, "Bottle · 4 oz"),
        ({"method": "bottle", "amount": 120, "unit": "ml", "duration_minutes": 0.5}, "Bottle · 120 mL · under 1 min"),
        ({"method": "bottle", "amount": 4, "unit": None}, "Bottle · 4 mL"),
        ({"method": "other", "duration_minutes": None}, "Feeding"),
        ({}, "Feeding"),
    ],
)
def test_feeding_citations_are_readable(data, expected):
    assert shown("feeding", data) == expected


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"end_at": (STARTED + timedelta(minutes=80)).isoformat()}, "Sleep · 1 h 20 min"),
        ({"end_at": (STARTED + timedelta(hours=2)).isoformat()}, "Sleep · 2 h"),
        ({"end_at": None}, "Sleep in progress"),
        ({}, "Sleep in progress"),
        ({"end_at": (STARTED - timedelta(minutes=5)).isoformat()}, "Sleep"),
        ({"end_at": "not a time"}, "Sleep"),
        ({"end_at": "2026-10-20T03:00:00"}, "Sleep"),  # Naive timestamps are not guessed.
    ],
)
def test_sleep_citations_show_duration_or_progress(data, expected):
    assert shown("sleep", data) == expected


@pytest.mark.parametrize(
    ("kind", "expected"),
    [("wet", "Wet"), ("dirty", "Dirty"), ("both", "Wet and dirty"), ("dry", "Dry"), (None, "Diaper change")],
)
def test_diaper_citations_name_the_change(kind, expected):
    assert shown("diaper", {"type": kind}) == expected


def test_routine_citations_count_steps_and_list_labels():
    items = [
        {"id": "a", "label": "Documents", "done": True},
        {"id": "b", "label": "Snacks", "done": False},
        {"id": "c", "label": "Charger", "done": True},
    ]
    assert shown("routine", {"routine_type": "checklist", "items": items}) == (
        "2 of 3 steps done\nDocuments\nSnacks\nCharger"
    )
    assert shown("routine", {"routine_type": "schedule", "items": items[:1], "repeat": "daily"}) == (
        "Schedule · 1 step · Repeats daily\nDocuments"
    )
    assert shown("routine", {"routine_type": "checklist", "items": None}) == "Checklist"
    assert shown("routine", {}) == "Schedule"


def test_care_citations_add_notes_and_never_show_raw_data():
    excerpt = shown(
        "feeding",
        {"method": "breast", "side": None, "unit": None, "amount": None, "duration_minutes": None},
        title="Feeding",
        body="Latched well",
    )
    assert excerpt == "Breastfeeding\n\nLatched well"
    for kind, data in [
        ("feeding", {"method": "bottle", "amount": None, "unit": None}),
        ("sleep", {"end_at": None}),
        ("diaper", {"type": "wet"}),
        ("routine", {"routine_type": "checklist", "items": [], "reminder_at": None}),
    ]:
        excerpt = shown(kind, data, body="Note")
        assert "{" not in excerpt and "null" not in excerpt and "None" not in excerpt
        assert '"' not in excerpt and excerpt.endswith("Note")


def test_citation_excerpt_does_not_repeat_title_and_stays_bounded():
    assert shown("journal", {}, title="First smile", body="She smiled at grandma") == "She smiled at grandma"
    assert shown("journal", {}, title="First smile", body="First smile\nAt breakfast") == "At breakfast"
    assert shown("question", {}, title="Ask", body="Ask the nurse about vitamin D") == (
        "Ask the nurse about vitamin D"
    )
    source = shown(
        "source",
        {"summary": "Pack documents early", "topics": ["labor", "packing"]},
        title="Hospital bag",
    )
    assert source == "Pack documents early\n\nlabor, packing"
    assert shown("journal", {}, title="Long", body="x" * 5000) == "x" * 1000
    assert shown("collection", {"record_ids": []}, title="Saved") == ""


def test_model_context_still_receives_typed_care_data():
    item = SimpleNamespace(
        kind="feeding", title="Feeding", body="", data={"method": "breast", "side": "left"}
    )
    excerpt = excerpt_for(item, [])
    assert excerpt.startswith("Feeding\n") and '"side": "left"' in excerpt


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


def test_display_excerpt_is_safe_for_unusual_values():
    from app.domains.baby.chat import duration_label, without_title

    assert duration_label(float("inf")) is None
    assert duration_label(float("nan")) is None
    assert without_title("İstanbul trip\nPacked the bag", "İstanbul trip") == "Packed the bag"
    assert without_title("Notes about feeding", "Feeding") == "Notes about feeding"


def test_ai_context_uses_the_parents_local_clock():
    from zoneinfo import ZoneInfo

    from app.domains.baby.chat import local_data, parent_zone

    guam = ZoneInfo("Pacific/Guam")
    assert parent_zone("Pacific/Guam") == guam
    assert str(parent_zone("Not/AZone")) == "UTC"
    assert str(parent_zone(None)) == "UTC"
    shifted = local_data({"end_at": "2026-10-20T09:18:20+00:00", "type": "wet"}, guam)
    assert shifted["end_at"] == "2026-10-20T19:18:20+10:00"
    assert shifted["type"] == "wet"
    item = SimpleNamespace(
        kind="sleep", title="Sleep", body="", data={"end_at": "2026-10-20T09:18:20+00:00"}
    )
    assert "19:18:20+10:00" in excerpt_for(item, [], zone=guam)
    assert local_data({"end_at": "not a time"}, guam) == {"end_at": "not a time"}


def test_question_terms_find_singular_titles():
    terms = query_terms("How many diapers and feeds today? Any bottles or stretches? Glass bus")
    assert {"diaper", "feed", "bottle", "stretch", "glass", "bus"} <= set(terms)
    # -ies trims to a stem that still matches both forms; short stems keep the original word.
    assert query_terms("allergies onesies") == ["allerg", "ones"]
    assert query_terms("naps meds aches babies rabies") == ["naps", "meds", "aches", "babies", "rabies"]

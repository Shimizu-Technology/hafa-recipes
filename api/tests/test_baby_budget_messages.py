"""Budget failures describe missing AI evidence without inventing media errors."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.domains.baby import media, processing, provider
from app.domains.baby.provider import AI_UNAVAILABLE_MESSAGE, DAILY_LIMIT_MESSAGE, BabyProvider
from app.domains.workouts.budget import BudgetError
from app.domains.workouts.extraction import SourceBundle, SourceMetadata, SourcePart


@pytest.mark.parametrize(
    "code,message",
    [
        ("workouts_ai_budget_exceeded", DAILY_LIMIT_MESSAGE),
        ("workouts_ai_model_unpriced", AI_UNAVAILABLE_MESSAGE),
    ],
)
async def test_audio_admission_failure_is_not_reported_as_unreadable_speech(
    monkeypatch, code, message
):
    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(
        provider,
        "get_settings",
        lambda: SimpleNamespace(
            is_ai_capability_enabled=lambda _: True,
            transcription_model="whisper-1",
        ),
    )
    reserve = AsyncMock(side_effect=BudgetError(code))
    monkeypatch.setattr(provider, "reserve", reserve)
    monkeypatch.setattr(media, "probe", AsyncMock(return_value=10.0))
    import openai

    outbound = Mock(side_effect=AssertionError("No provider call after denied admission"))
    monkeypatch.setattr(openai, "AsyncOpenAI", outbound)
    gate = AsyncMock()
    baby = BabyProvider(gate=gate)
    source = await processing.local_media(
        b"audio fixture", "audio/mpeg", baby, may_use_ai=True, gate=gate
    )
    assert source.parts == [] and source.metadata.coverage_notes == [message]
    assert baby.budget_error.code == code
    reserve.assert_awaited_once()
    outbound.assert_not_called()


async def test_shared_acquisition_catching_audio_budget_still_exposes_safe_limit_note(monkeypatch):
    baby = BabyProvider()

    class PartialAcquirer:
        def __init__(self, **kwargs):
            pass

        async def acquire(self, url, provider, **kwargs):
            # Shared acquisition deliberately catches media exceptions so its
            # captions/frames remain usable. Provider keeps only safe provenance.
            provider.budget_error = BudgetError("workouts_ai_budget_exceeded")
            return SourceBundle(
                SourceMetadata(), parts=[SourcePart("caption", "Synthetic caption")]
            )

    monkeypatch.setattr(processing, "ProductionSourceAcquirer", PartialAcquirer)
    # Extraction may still preserve the caption without revisiting the provider.
    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: False))
    result = await processing.process_capture(
        {"url": "https://example.com/source"}, [], baby, may_use_ai=True, gate=AsyncMock()
    )
    assert result["status"] == "incomplete" and result["error"] == DAILY_LIMIT_MESSAGE
    assert result["data"]["source_text"] == "Synthetic caption"
    assert result["data"]["coverage_notes"] == [DAILY_LIMIT_MESSAGE]

"""A saved post is "incomplete" only when something a parent needs is missing."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.domains.baby import processing
from app.domains.baby.provider import IMAGE_READING_DISCLOSURE, ExtractionOutput
from app.domains.baby.runtime import keep_user_decisions
from app.domains.workouts.extraction import SourceBundle, SourceImage, SourceMetadata, SourcePart
from app.services.source_acquisition import AcquisitionFailure
from tests import test_baby_integration as shared

FRAME_TIMEOUT = "Frame processing reached the import time limit; available captions remain usable."
OUTSIDE = "AI returned text outside the supplied image locations; that text was left out."
CONDENSED = "AI condensed details in image batch 1; read the saved text and originals for full wording."
IMAGE = "data:image/webp;base64,aW1hZ2U="
baby_api = shared.baby_api


def capture(monkeypatch, bundle, summary="The creator lists what to pack."):
    monkeypatch.setattr(processing.ProductionSourceAcquirer, "acquire", AsyncMock(return_value=bundle))
    provider = SimpleNamespace(enabled=True, extract=AsyncMock(return_value=ExtractionOutput(
        title="Hospital bag", summary=summary, key_points=["The creator packs a long phone cable."],
        visual_text=[{"location": "image:0", "text": "Long phone cable"}] if bundle.images else [],
    )))
    return processing.process_capture({"url": "https://www.tiktok.com/@creator/video/1"}, [], provider,
                                      may_use_ai=True, gate=AsyncMock())


async def test_a_video_read_from_speech_with_a_frame_timeout_is_ready_with_its_note(monkeypatch):
    bundle = SourceBundle(SourceMetadata(platform="tiktok", coverage_notes=[FRAME_TIMEOUT]),
                          parts=[SourcePart("caption", "#hospitalbag"), SourcePart("transcript", "Pack a long cable.")],
                          acquisition_failures=[AcquisitionFailure("frames", "TIMEOUT")])
    result = await capture(monkeypatch, bundle)
    assert result["status"] == result["data"]["status"] == "ready"
    assert result["error"] is None
    assert FRAME_TIMEOUT in result["data"]["coverage_notes"]


async def test_slides_with_informational_ai_notes_are_ready(monkeypatch):
    bundle = SourceBundle(SourceMetadata(platform="tiktok", coverage_notes=[OUTSIDE, CONDENSED]),
                          parts=[SourcePart("caption", "What I packed")], images=[SourceImage("image:0", IMAGE, normalized=True)])
    result = await capture(monkeypatch, bundle)
    assert result["status"] == "ready" and result["error"] is None
    assert {OUTSIDE, CONDENSED} <= set(result["data"]["coverage_notes"])


async def test_no_summary_after_ai_ran_is_incomplete(monkeypatch):
    bundle = SourceBundle(SourceMetadata(platform="tiktok"), parts=[SourcePart("transcript", "Pack a long cable.")])
    result = await capture(monkeypatch, bundle, summary="")
    assert result["status"] == "incomplete"


async def test_a_video_post_read_only_from_its_caption_is_incomplete(monkeypatch):
    bundle = SourceBundle(SourceMetadata(platform="tiktok", coverage_notes=[
        "Audio unavailable; available captions/frames remain usable.",
        "Visual frames unavailable; visual-only instructions may be missing.",
    ]), parts=[SourcePart("caption", "#hospitalbag must haves")])
    result = await capture(monkeypatch, bundle)
    assert result["status"] == "incomplete"


async def test_a_limit_hit_after_thirty_notes_still_makes_it_incomplete(monkeypatch):
    from app.domains.workouts.budget import BudgetError
    many = [f"Slide {n} could not be read; its details may be missing." for n in range(40)]
    bundle = SourceBundle(SourceMetadata(platform="tiktok", coverage_notes=many),
                          parts=[SourcePart("transcript", "Pack a long cable.")])
    monkeypatch.setattr(processing.ProductionSourceAcquirer, "acquire", AsyncMock(return_value=bundle))
    provider = SimpleNamespace(enabled=True, budget_error=BudgetError("workouts_ai_budget_exceeded"),
                               extract=AsyncMock(return_value=ExtractionOutput(title="Bag", summary="Pack a cable.")))
    result = await processing.process_capture({"url": "https://www.tiktok.com/@c/video/1"}, [], provider,
                                              may_use_ai=True, gate=AsyncMock())
    assert len(result["data"]["coverage_notes"]) == 30
    assert result["status"] == "incomplete" and "Daily AI limit" in result["error"]


async def test_only_her_own_note_is_incomplete(monkeypatch):
    monkeypatch.setattr(processing.ProductionSourceAcquirer, "acquire", AsyncMock(side_effect=ValueError("gone")))
    provider = SimpleNamespace(enabled=True, extract=AsyncMock(return_value=ExtractionOutput(title="Note", summary="Her note.")))
    result = await processing.process_capture({"url": "https://www.tiktok.com/@c/video/1", "text": "Kami's note"}, [],
                                              provider, may_use_ai=True, gate=AsyncMock())
    assert result["status"] == "incomplete" and result["error"]


@pytest.mark.parametrize("data,ai_expected,missing", [
    # Leon's five: a summary and real text, with informational notes.
    ({"summary": "s", "platform": "tiktok", "url": "u", "coverage_notes": [IMAGE_READING_DISCLOSURE, CONDENSED, OUTSIDE],
      "evidence": [{"location": "caption", "text": "c"}, {"location": "image:0", "text": "t"}]}, True, False),
    ({"summary": "s", "platform": "tiktok", "url": "u", "coverage_notes": [FRAME_TIMEOUT],
      "evidence": [{"location": "caption", "text": "c"}, {"location": "transcript", "text": "t"}]}, True, False),
    ({"summary": "s", "platform": "web", "url": "u", "coverage_notes": ["Text exceeds the processing limit; the original is retained."],
      "evidence": [{"location": "page_text", "text": "t"}]}, True, False),
    # Frames were read even though none had words on them.
    ({"summary": "s", "platform": "instagram", "url": "u",
      "coverage_notes": ["image:0 sampled at 1.5s; samples do not cover every frame."],
      "evidence": [{"location": "caption", "text": "c"}]}, True, False),
    ({"summary": None, "platform": "tiktok", "url": "u", "evidence": [{"location": "transcript", "text": "t"}]}, True, True),
    ({"summary": "s", "platform": "tiktok", "url": "u", "evidence": [{"location": "caption", "text": "c"}]}, True, True),
    ({"summary": "s", "evidence": [{"location": "user_note", "text": "mine"}]}, True, True),
    ({"summary": "s", "evidence": [{"location": "caption", "text": "   "}]}, True, True),
    ({"summary": "s", "platform": "upload", "evidence": [{"location": "attachment:1:page:1", "text": "t"}],
      "coverage_notes": ["An attachment could not be read. The original attachment remains saved."]}, True, True),
    ({"summary": "s", "platform": "tiktok", "url": "u", "evidence": [{"location": "transcript", "text": "t"}],
      "coverage_notes": ["Daily AI limit reached. Your originals and available text are saved. Try again later."]}, True, True),
    ({"summary": "s", "platform": "tiktok", "url": "u", "evidence": [{"location": "transcript", "text": "t"}],
      "coverage_notes": ["Image attachment:0 could not be read; its details may be missing."]}, True, True),
    ({"summary": "s", "platform": "upload", "url": "u", "evidence": [{"location": "attachment:0", "text": "t"}],
      "coverage_notes": ["The linked source could not be read. The original link remains saved."]}, True, True),
    # Without AI there is no summary to expect, and only a caption is ever read.
    ({"platform": "tiktok", "url": "u", "evidence": [{"location": "caption", "text": "c"}]}, False, False),
])
def test_missing_content_reads_stored_sources(data, ai_expected, missing):
    assert processing.missing_content(data, ai_expected=ai_expected) is missing


def test_a_weaker_reread_with_notes_keeps_the_earlier_reading():
    current = {"url": "u", "summary": "Earlier summary", "source_text": "caption\n\nslide text",
               "evidence": [{"location": "caption", "text": "caption"}, {"location": "image:0", "text": "slide text"}]}
    organized = {"status": "ready", "summary": "Caption only", "source_text": "caption",
                 "coverage_notes": [FRAME_TIMEOUT], "evidence": [{"location": "caption", "text": "caption"}]}
    kept = keep_user_decisions(current, organized)
    assert "summary" not in kept and "evidence" not in kept
    assert kept["coverage_notes"][0].startswith("Previously saved text is shown.")


def test_a_fully_read_reread_replaces_the_earlier_reading():
    current = {"url": "u", "summary": "Earlier", "evidence": [{"location": "image:0", "text": "slide"}]}
    organized = {"status": "ready", "summary": "New", "coverage_notes": ["Video frames are samples."],
                 "evidence": [{"location": "transcript", "text": "speech"}]}
    assert keep_user_decisions(current, organized)["summary"] == "New"


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("family_enabled", [False, True])
async def test_recompute_is_dry_run_first_and_promotes_only_readable_posts(baby_api, family_enabled, capsys):
    from uuid import uuid4

    from sqlalchemy import select

    from app.domains.baby.models import BabyImport
    from app.domains.baby.recompute_source_status import recompute
    from app.domains.baby.runtime import BabyWorker

    baby_api.settings.baby_family_enabled = family_enabled
    c = baby_api.client
    readable = {"url": "https://www.tiktok.com/@c/video/1", "platform": "tiktok", "status": "incomplete",
                "summary": "The creator lists what to pack.", "source_text": "Caption\n\nPack a long cable.",
                "coverage_notes": [FRAME_TIMEOUT],
                "evidence": [{"location": "caption", "text": "Caption"}, {"location": "transcript", "text": "Pack a long cable."}]}
    unread = {**readable, "summary": None, "evidence": [{"location": "user_note", "text": "Mine"}]}
    ids = {}
    for name, data in (("readable", readable), ("unread", unread), ("edited", readable)):
        made = await c.post("/api/v1/baby/imports", headers=shared.GEN, json={"id": str(uuid4()), "url": data["url"]})
        ids[name] = made.json()["record_id"]
        error = ("You edited this source while it processed. Your edits were kept; retry to organize it again."
                 if name == "edited" else "Some linked source content could not be read.")
        processor = AsyncMock(return_value={"status": "incomplete", "title": name, "data": data, "error": error})
        assert await BabyWorker(baby_api.sessions, processor=processor).tick()
    before = {name: (await c.get(f"/api/v1/baby/records/{rid}")).json() for name, rid in ids.items()}

    report = await recompute(migration_engine=baby_api.engine)
    assert report == {"mode": "dry_run", "incomplete": 3, "promote": 1, "promoted": 0, "skipped_changed": 0, "stay_incomplete": 2}
    printed = capsys.readouterr().out
    assert "nothing_read_from_post" in printed and "edited_while_processing" in printed and "Pack a long cable" not in printed
    async with baby_api.sessions() as db:
        stamped = {str(job.record_id): job.updated_at for job in await db.scalars(select(BabyImport))}
    for name, rid in ids.items():
        assert (await c.get(f"/api/v1/baby/records/{rid}")).json() == before[name]

    report = await recompute(apply=True, migration_engine=baby_api.engine)
    assert report["promoted"] == 1 and report["stay_incomplete"] == 2
    after = (await c.get(f"/api/v1/baby/records/{ids['readable']}")).json()
    assert after["data"] == {**before["readable"]["data"], "status": "ready"}
    assert after["revision"] == before["readable"]["revision"] + 1
    assert (await c.get(f"/api/v1/baby/records/{ids['unread']}")).json() == before["unread"]
    async with baby_api.sessions() as db:
        jobs = {str(job.record_id): job for job in await db.scalars(select(BabyImport))}
    assert (jobs[ids["readable"]].status, jobs[ids["readable"]].error) == ("ready", None)
    # No fresh updated_at, so no days-late "is ready" push.
    assert jobs[ids["readable"]].updated_at == stamped[ids["readable"]]
    assert jobs[ids["unread"]].status == jobs[ids["edited"]].status == "incomplete"

    again = await recompute(apply=True, migration_engine=baby_api.engine)
    assert again["incomplete"] == 2 and again["promoted"] == 0

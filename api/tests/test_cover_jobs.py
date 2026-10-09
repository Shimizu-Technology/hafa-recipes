"""Cover enhancement boundaries independent from providers and storage."""

import base64
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app import cover_jobs
from app.models.recipe import Recipe
from app.routers.recipes import recipe_to_detail_response
from app.services.cover_selection import CoverCandidate
from app.services.video import VideoFrame


def recipe():
    return Recipe(
        id=uuid4(),
        source_url="https://www.youtube.com/watch?v=coverqa1234",
        source_type="youtube",
        user_id="cover_owner",
        content_revision=1,
        is_public=False,
        created_at=datetime.now(UTC),
        extracted={
            "title": "Rice",
            "sourceUrl": "https://www.youtube.com/watch?v=coverqa1234",
            "components": [
                {
                    "name": "Main",
                    "ingredients": [{"name": "rice", "quantity": "2", "unit": "cups"}],
                    "steps": ["Cook the rice."],
                }
            ],
            "media": {"thumbnail": None},
        },
    )


def test_cover_queue_requires_workers_storage_and_usable_owned_source(monkeypatch):
    item = recipe()
    monkeypatch.setattr(cover_jobs.settings, "recipe_cover_selection_enabled", True)
    monkeypatch.setattr(cover_jobs.settings, "job_worker_enabled", True)
    monkeypatch.setattr(type(cover_jobs.storage_service), "is_enabled", property(lambda _: True))
    assert cover_jobs.should_enhance_cover(item)
    monkeypatch.setattr(cover_jobs.settings, "job_worker_enabled", False)
    assert not cover_jobs.should_enhance_cover(item)
    monkeypatch.setattr(cover_jobs.settings, "job_worker_enabled", True)
    item.user_id = None
    assert not cover_jobs.should_enhance_cover(item)
    item.user_id = "cover_owner"
    item.extracted = {**item.extracted, "sourceIncomplete": True}
    assert not cover_jobs.should_enhance_cover(item)


def test_enqueue_keeps_source_bytes_transient_and_pending_public_contract_bounded(monkeypatch):
    monkeypatch.setattr(cover_jobs, "should_enhance_cover", lambda _: True)
    monkeypatch.setattr(cover_jobs, "candidate_cache", cover_jobs.CandidateCache())
    item = recipe()
    result = SimpleNamespace(
        thumbnail_url="https://example.test/photo?signature=private",
        cover_frames=[VideoFrame(12.5, base64.b64encode(b"source-frame").decode())],
        cover_images=None,
    )
    db = SimpleNamespace(add=Mock())
    job = cover_jobs.enqueue_cover_job(db, item, result)
    assert job.recipe_id == item.id and job.target_recipe_id == item.id
    assert job.user_id == item.user_id and job.job_kind == "cover"
    assert job.max_attempts == 2
    assert "source-frame" not in job.notes
    assert cover_jobs.candidate_cache.take(job.id)[0].image_data == b"source-frame"
    owner = recipe_to_detail_response(item, item.user_id)
    public = recipe_to_detail_response(item, None)
    assert owner.thumbnail_pending and public.thumbnail_pending
    assert public.thumbnail_pending_until is not None
    assert "coverSelection" not in public.extracted.model_dump()["media"]
    assert "signature" not in public.model_dump_json()


@pytest.mark.parametrize("changed", ["expired", "revision", "timezone", "malformed", "too_far"])
def test_pending_stops_on_expiry_edit_and_invalid_metadata(changed):
    item = recipe()
    now = datetime.now(UTC)
    item.extracted["media"]["coverSelection"] = {
        "status": "pending",
        "contentRevision": 1,
        "deadline": (now + timedelta(seconds=60)).isoformat(),
    }
    assert cover_jobs.cover_pending_until(item, now=now)
    if changed == "revision":
        item.content_revision = 2
    else:
        deadlines = {
            "expired": now - timedelta(seconds=1),
            "timezone": now.replace(tzinfo=None),
            "too_far": now + timedelta(hours=1),
        }
        item.extracted["media"]["coverSelection"]["deadline"] = (
            "garbage" if changed == "malformed" else deadlines[changed].isoformat()
        )
    assert cover_jobs.cover_pending_until(item, now=now) is None


def test_candidate_cache_eviction_expiry_and_single_consumption(monkeypatch):
    monkeypatch.setattr(cover_jobs, "MAX_CACHED_BYTES", 12)
    clock = [100.0]
    monkeypatch.setattr(cover_jobs.time, "monotonic", lambda: clock[0])
    cache = cover_jobs.CandidateCache()
    first, second = uuid4(), uuid4()
    candidate = CoverCandidate("frame", b"12345678", "video_frame")
    cache.remember(first, [candidate])
    cache.remember(second, [candidate])
    assert not cache.take(first)
    assert cache.take(second) == [candidate]
    assert not cache.take(second)
    cache.remember(first, [candidate])
    clock[0] += 301
    assert not cache.take(first)
